import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { isValidIfsc, normaliseIfsc } from '../../../lib/bank'
import { created, updated, fail, parseId } from '../../../lib/api/respond'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res)
    case 'POST':
      return handlePost(req, res)
    case 'PUT':
      return handlePut(req, res)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { page = 1, limit = 50, search = '', sortBy = 'bank_name', sortOrder = 'asc' } = req.query

    const pageNum = parseInt(page as string, 10)
    const limitNum = parseInt(limit as string, 10)
    const searchTerm = search as string
    const sortField = sortBy as string
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    // Build where clause for search
    const where = searchTerm ? {
      OR: [
        { bank_name: { contains: searchTerm } },
        { account_number: { contains: searchTerm } },
        { bank_address: { contains: searchTerm } },
        { ifsc: { contains: searchTerm } }
      ]
    } : {}

    // Validate sortBy to prevent SQL injection
    const validSortFields = ['id', 'bank_name', 'account_number', 'bank_address', 'ifsc']
    const field = validSortFields.includes(sortField) ? sortField : 'bank_name'

    // Get total count for pagination
    const total = await prisma.bank_details.count({ where })

    // Get bank accounts with pagination and sorting
    const bankDetails = await prisma.bank_details.findMany({
      where,
      select: {
        id: true,
        bank_name: true,
        account_number: true,
        bank_address: true,
        ifsc: true
      },
      orderBy: { [field]: sortDirection },
      skip: (pageNum - 1) * limitNum,
      take: limitNum
    })

    const totalPages = Math.ceil(total / limitNum)
    const hasMore = pageNum < totalPages

    res.status(200).json({
      bankAccounts: bankDetails,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore
      }
    })
  } catch (error) {
    return fail(res, error, 'fetch bank details')
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { bank_name, account_number, bank_address, ifsc } = req.body

    if (!bank_name || typeof bank_name !== 'string' || !bank_name.trim()) {
      return res.status(400).json({
        message: 'Bank name is required and must be a non-empty string'
      })
    }

    if (!account_number || typeof account_number !== 'string' || !account_number.trim()) {
      return res.status(400).json({
        message: 'Account number is required and must be a non-empty string'
      })
    }

    // IFSC is optional, but if given it must be well formed: a 4-letter bank
    // code, a literal 0 reserved by RBI, then a 6-character branch code.
    // A wrong IFSC is invisible until someone's payment fails.
    if (ifsc && !isValidIfsc(ifsc)) {
      return res.status(400).json({
        message: 'IFSC is not valid. Expected 11 characters, e.g. HDFC0001234.'
      })
    }

    // Check if bank account already exists (case insensitive)
    const trimmedName = bank_name.trim()
    const trimmedAccount = account_number.trim()
    // MySQL's default collation is already case-insensitive, so one comparison
    // does the job. The extra `.toLowerCase()` clause that used to sit here
    // caught an all-lowercase duplicate and nothing else - "HdFc" still passed -
    // while the comment above it claimed the check was case-insensitive (S-84).
    const existingAccount = await prisma.bank_details.findFirst({
      where: {
        OR: [
          { bank_name: trimmedName },
          { account_number: trimmedAccount }
        ]
      }
    })

    if (existingAccount) {
      return res.status(409).json({
        message: existingAccount.account_number === trimmedAccount
          ? 'Account number already exists'
          : 'Bank with this name already exists'
      })
    }

    // Create new bank account
    const bankAccount = await prisma.bank_details.create({
      data: {
        bank_name: trimmedName,
        account_number: trimmedAccount,
        bank_address: bank_address?.trim() || null,
        ifsc: normaliseIfsc(ifsc)
      },
      select: {
        id: true,
        bank_name: true,
        account_number: true,
        bank_address: true,
        ifsc: true
      }
    })

    return created(res, bankAccount, 'Bank account created successfully')
  } catch (error) {
    return fail(res, error, 'create the bank account')
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id, bank_name, account_number, bank_address, ifsc } = req.body

    // S-88: a bare `parseInt` reached Prisma as `where: { id: NaN }` for a junk
    // id, surfacing as a 500 rather than a 400.
    const accountId = parseId(id)
    if (accountId === null) {
      return res.status(400).json({
        message: 'A valid bank account ID is required'
      })
    }

    if (!bank_name || typeof bank_name !== 'string' || !bank_name.trim()) {
      return res.status(400).json({
        message: 'Bank name is required and must be a non-empty string'
      })
    }

    if (!account_number || typeof account_number !== 'string' || !account_number.trim()) {
      return res.status(400).json({
        message: 'Account number is required and must be a non-empty string'
      })
    }

    // IFSC is optional, but if given it must be well formed: a 4-letter bank
    // code, a literal 0 reserved by RBI, then a 6-character branch code.
    // A wrong IFSC is invisible until someone's payment fails.
    if (ifsc && !isValidIfsc(ifsc)) {
      return res.status(400).json({
        message: 'IFSC is not valid. Expected 11 characters, e.g. HDFC0001234.'
      })
    }

    // Check if bank account exists
    const existingAccount = await prisma.bank_details.findUnique({
      where: { id: accountId }
    })

    if (!existingAccount) {
      return res.status(404).json({
        message: 'Bank account not found'
      })
    }

    // Check for duplicates (excluding current record)
    const trimmedName = bank_name.trim()
    const trimmedAccount = account_number.trim()
    const duplicate = await prisma.bank_details.findFirst({
      where: {
        AND: [
          { id: { not: accountId } },
          {
            OR: [
              { bank_name: trimmedName },
              { account_number: trimmedAccount }
            ]
          }
        ]
      }
    })

    if (duplicate) {
      return res.status(409).json({
        message: duplicate.account_number === trimmedAccount
          ? 'Account number already exists'
          : 'Bank with this name already exists'
      })
    }

    // Update bank account
    // A partial update: write what was supplied, leave the rest alone.
    //
    // This used to write all four columns unconditionally, so a caller that
    // omitted `bank_address` or `ifsc` had them **nulled** - the F-78 shape
    // (S-76). It was latent only because the settings form always sends every
    // field, and the form is not the only possible caller.
    const updateData: any = {
      bank_name: trimmedName,
      account_number: trimmedAccount
    }
    if (bank_address !== undefined) updateData.bank_address = bank_address?.trim() || null
    if (ifsc !== undefined) updateData.ifsc = normaliseIfsc(ifsc)

    const updatedAccount = await prisma.bank_details.update({
      where: { id: accountId },
      data: updateData
    })

    return updated(res, updatedAccount, 'Bank account updated successfully')
  } catch (error) {
    return fail(res, error, 'update the bank account')
  }
}

export default withObservability(handler)
