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
      fy: {
        contains: searchTerm
      }
    } : {}

    // Get total count for pagination
    const total = await prisma.financial_year.count({ where })

    // Get financial years with pagination
    const financialYears = await prisma.financial_year.findMany({
      where,
      select: {
        id: true,
        fy: true
      },
      orderBy: { fy: 'desc' }, // Most recent first
      skip: (pageNum - 1) * limitNum,
      take: limitNum
    })

    const totalPages = Math.ceil(total / limitNum)
    const hasMore = pageNum < totalPages

    res.status(200).json({
      financialYears,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore
      }
    })
  } catch (error) {
    console.error('Financial years fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch financial years data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { fy } = req.body

    if (!fy || typeof fy !== 'string' || !fy.trim()) {
      return res.status(400).json({
        message: 'Financial year is required and must be a non-empty string'
      })
    }

    // Validate financial year format (YYYY-YYYY)
    const fyRegex = /^\d{4}-\d{4}$/
    if (!fyRegex.test(fy.trim())) {
      return res.status(400).json({
        message: 'Financial year must be in the format YYYY-YYYY (e.g., 2024-2025)'
      })
    }

    // Check if financial year already exists
    const trimmedFy = fy.trim()
    const existingFy = await prisma.financial_year.findFirst({
      where: {
        fy: trimmedFy
      }
    })

    if (existingFy) {
      return res.status(409).json({
        message: 'Financial year already exists'
      })
    }

    // Create new financial year
    const financialYear = await prisma.financial_year.create({
      data: {
        fy: trimmedFy
      },
      select: {
        id: true,
        fy: true
      }
    })

    res.status(201).json({
      status: "success",
      message: "Financial year created successfully"
    })
  } catch (error) {
    console.error('Financial year creation error:', error)
    res.status(500).json({
      message: 'Failed to create financial year',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
