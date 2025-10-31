import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
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
    console.error('Bank details fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch bank details data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
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

    // Check if bank account already exists (case insensitive)
    const trimmedName = bank_name.trim()
    const trimmedAccount = account_number.trim()
    const existingAccount = await prisma.bank_details.findFirst({
      where: {
        OR: [
          { bank_name: trimmedName },
          { bank_name: trimmedName.toLowerCase() },
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
        ifsc: ifsc?.trim() || null
      },
      select: {
        id: true,
        bank_name: true,
        account_number: true,
        bank_address: true,
        ifsc: true
      }
    })

    res.status(201).json({
      status: "success",
      message: "Bank account created successfully"
    })
  } catch (error) {
    console.error('Bank account creation error:', error)
    res.status(500).json({
      message: 'Failed to create bank account',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id, bank_name, account_number, bank_address, ifsc } = req.body

    // Validation
    if (!id) {
      return res.status(400).json({
        message: 'ID is required'
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

    // Check if bank account exists
    const existingAccount = await prisma.bank_details.findUnique({
      where: { id: parseInt(id) }
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
          { id: { not: parseInt(id) } },
          {
            OR: [
              { bank_name: trimmedName },
              { bank_name: trimmedName.toLowerCase() },
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
    const updatedAccount = await prisma.bank_details.update({
      where: { id: parseInt(id) },
      data: {
        bank_name: trimmedName,
        account_number: trimmedAccount,
        bank_address: bank_address?.trim() || null,
        ifsc: ifsc?.trim() || null
      }
    })

    res.status(200).json({
      status: "success",
      message: "Bank account updated successfully",
      data: updatedAccount
    })
  } catch (error) {
    console.error('Bank account update error:', error)
    res.status(500).json({
      message: 'Failed to update bank account',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
