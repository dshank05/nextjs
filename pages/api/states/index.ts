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
      state_name: {
        contains: searchTerm
      }
    } : {}

    // Get total count for pagination
    const total = await prisma.states.count({ where })

    // Get states with pagination
    const states = await prisma.states.findMany({
      where,
      select: {
        id: true,
        state_name: true
      },
      orderBy: { state_name: 'asc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum
    })

    const totalPages = Math.ceil(total / limitNum)
    const hasMore = pageNum < totalPages

    res.status(200).json({
      states,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore
      }
    })
  } catch (error) {
    console.error('States fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch states data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { state_name } = req.body

    if (!state_name || typeof state_name !== 'string' || !state_name.trim()) {
      return res.status(400).json({
        message: 'State name is required and must be a non-empty string'
      })
    }

    // Check if state already exists (case insensitive)
    const trimmedName = state_name.trim()
    const existingState = await prisma.states.findFirst({
      where: {
        OR: [
          { state_name: trimmedName },
          { state_name: trimmedName.toLowerCase() }
        ]
      }
    })

    if (existingState) {
      return res.status(409).json({
        message: 'State with this name already exists'
      })
    }

    // Create new state (provide default code value since it's required in schema)
    const state = await prisma.states.create({
      data: {
        state_name: trimmedName,
        code: 0 // Default code, can be updated later if needed
      },
      select: {
        id: true,
        state_name: true
      }
    })

    res.status(201).json({
      message: 'State created successfully',
      state: {
        id: state.id.toString(),
        state_name: state.state_name
      }
    })
  } catch (error) {
    console.error('State creation error:', error)
    res.status(500).json({
      message: 'Failed to create state',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
