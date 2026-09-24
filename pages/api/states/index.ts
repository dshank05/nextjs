import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { isValidGstStateCode, MIN_GST_STATE_CODE, MAX_GST_STATE_CODE } from '../../../lib/gst'
import { created, fail } from '../../../lib/api/respond'

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
    const { page = 1, limit = 50, search = '', sortBy = 'state_name', sortOrder = 'asc', dropdown = 'false' } = req.query
    const isDropdown = dropdown === 'true'

    const pageNum = parseInt(page as string, 10)
    const limitNum = parseInt(limit as string, 10)
    const searchTerm = search as string

    // Search the GST code too - it is a displayed, sortable column, and looking
    // up "09" was previously impossible.
    const where: any = searchTerm ? {
      OR: [
        { state_name: { contains: searchTerm } },
        ...(Number.isInteger(Number(searchTerm)) ? [{ code: Number(searchTerm) }] : [])
      ]
    } : {}

    // Build orderBy based on sortBy and sortOrder
    const orderBy: any = {}
    // S-32: `id` was not on this list, so `sortBy=id` silently fell back to
    // state_name and returned data that looked sorted and was not.
    const validSortFields = ['id', 'state_name', 'code']
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
      ...(isDropdown ? {} : { skip: (pageNum - 1) * limitNum, take: limitNum })
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
    return fail(res, error, 'fetch states')
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

    // One comparison: MySQL's collation is already case-insensitive here. The
    // `.toLowerCase()` clause that used to sit beside it only caught an
    // all-lowercase duplicate, which is not what "case insensitive" means (S-84).
    const trimmedName = state_name.trim()
    const existingState = await prisma.states.findFirst({
      where: { state_name: trimmedName }
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

    return created(res, state, 'State created successfully')
  } catch (error) {
    return fail(res, error, 'create the state')
  }
}


export default withObservability(handler)