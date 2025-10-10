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
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { page = 1, limit = 50, search = '' } = req.query

    const pageNum = parseInt(page as string, 10)
    const limitNum = parseInt(limit as string, 10)
    const searchTerm = search as string

    // Build where clause for search
    const where = searchTerm ? {
      bank_name: {
        contains: searchTerm
      }
    } : {}

    // Get total count for pagination
    const total = await prisma.bank_details.count({ where })

    // Get bank accounts with pagination
    const bankDetails = await prisma.bank_details.findMany({
      where,
      select: {
        id: true,
        bank_name: true,
        account_number: true,
        bank_address: true,
        ifsc: true
      },
      orderBy: { bank_name: 'asc' },
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
      message: 'Bank account created successfully',
      bankAccount: {
        id: bankAccount.id.toString(),
        bank_name: bankAccount.bank_name,
        account_number: bankAccount.account_number,
        bank_address: bankAccount.bank_address,
        ifsc: bankAccount.ifsc
      }
    })
  } catch (error) {
    console.error('Bank account creation error:', error)
    res.status(500).json({
      message: 'Failed to create bank account',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
