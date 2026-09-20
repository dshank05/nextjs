import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { isValidGstStateCode, MIN_GST_STATE_CODE, MAX_GST_STATE_CODE } from '../../../lib/gst'

async function handler(
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
    const { page = 1, limit = 50, search = '', sortBy = 'state_name', sortOrder = 'asc' } = req.query

    const pageNum = parseInt(page as string, 10)
    const limitNum = parseInt(limit as string, 10)
    const searchTerm = search as string

    // Build where clause for search
    const where = searchTerm ? {
      state_name: {
        contains: searchTerm
      }
    } : {}

    // Build orderBy based on sortBy and sortOrder
    const orderBy: any = {}
    const validSortFields = ['state_name', 'code']
    const field = validSortFields.includes(sortBy as string) ? sortBy as string : 'state_name'
    const order = sortOrder === 'desc' ? 'desc' : 'asc'
    orderBy[field] = order

    // Get total count for pagination
    const total = await prisma.states.count({ where })

    // Get states with pagination
    const states = await prisma.states.findMany({
      where,
      select: {
        id: true,
        state_name: true,
        code: true
      },
      orderBy,
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
    const { state_name, code } = req.body

    if (!state_name || typeof state_name !== 'string' || !state_name.trim()) {
      return res.status(400).json({
        message: 'State name is required and must be a non-empty string'
      })
    }

    // F-29: the GST state code is what decides CGST+SGST vs IGST on every
    // invoice to this state. It used to be hardcoded to 0, which made every
    // state created here unusable for billing. It is required.
    const stateCode = typeof code === 'number' ? code : parseInt(code, 10)

    if (!isValidGstStateCode(stateCode)) {
      return res.status(400).json({
        message: `GST state code is required and must be between ${MIN_GST_STATE_CODE} and ${MAX_GST_STATE_CODE}`
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

    // Two states cannot share a GST state code. The schema has no unique
    // constraint on `code` yet, so enforce it here as well.
    const codeConflict = await prisma.states.findFirst({
      where: { code: stateCode }
    })

    if (codeConflict) {
      return res.status(409).json({
        message: `GST state code ${stateCode} is already used by "${codeConflict.state_name}"`
      })
    }

    const state = await prisma.states.create({
      data: {
        state_name: trimmedName,
        code: stateCode
      },
      select: {
        id: true,
        state_name: true,
        code: true
      }
    })

    res.status(201).json({
      status: "success",
      message: "State created successfully"
    })
  } catch (error) {
    console.error('State creation error:', error)
    res.status(500).json({
      message: 'Failed to create state',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}


export default withObservability(handler)