import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { created, fail, parseId } from '../../../lib/api/respond'

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
    const {
      page = '1',
      limit = '50',
      search = '',
      includeInactive = 'false',
      sortBy = 'description',
      sortOrder = 'asc',
      dropdown = 'false'
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // `dropdown=true` returns every active row, unpaginated. A picker that
    // silently shows only the first page is worse than one that is slow: the
    // entry is simply absent, with nothing to indicate it was cut off (F-58/F-64).
    const isDropdown = dropdown === 'true'
    const sortField = sortBy as string
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    // Build where clause
    const where: any = {}

    if (search) {
      const searchTerm = search as string
      const searchConditions: any[] = [
        { description: { contains: searchTerm } },
        { hsn_code: { contains: searchTerm } },
        { applicable_for: { contains: searchTerm } }
      ]

      // If search term is numeric, also search by rate
      const rateValue = parseFloat(searchTerm)
      if (!isNaN(rateValue)) {
        searchConditions.push({ rate: { equals: rateValue } })
      }

      where.OR = searchConditions
    }

    // Filter for active records by default, unless includeInactive is true
    if (includeInactive !== 'true') {
      where.status = 'Active'
    }

    // Validate sortBy to prevent SQL injection
    const validSortFields = ['id', 'description', 'rate', 'hsn_code', 'applicable_for', 'status']
    const field = validSortFields.includes(sortField) ? sortField : 'description'

    const [gstRates, total] = await Promise.all([
      prisma.gst_tax_rate.findMany({
        where,
        ...(isDropdown ? {} : { skip, take: limitNum }),
        orderBy: { [field]: sortDirection }
      }),
      prisma.gst_tax_rate.count({ where })
    ])

    // Never 0: an empty list is page 1 of 1.
    const totalPages = Math.max(1, Math.ceil(total / limitNum))

    res.status(200).json({
      gstRates,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    return fail(res, error, 'fetch GST rates')
  }
}

/** The rate rule POST and PUT share (PUT used to skip it: -5 or "abc" saved). */
function rateProblem(rate: unknown): string | null {
  const parsed = parseFloat(String(rate))
  if (!Number.isFinite(parsed) || parsed < 0) return 'Rate must be a number of 0 or more'
  if (parsed > 100) return 'Rate cannot be more than 100'
  return null
}
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v)

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const description = text(req.body.description) as string
    const hsn_code = text(req.body.hsn_code) as string
    const { rate, applicable_for, status } = req.body

    // Validation (trimmed: a description of only spaces is none).
    //
    // `!rate` rejected a rate of 0, so a nil-rated slab could not be created by
    // any caller that sends rate as a number (F-31). The settings form happened
    // to be unaffected because it posts the string "0", which is truthy - which
    // is exactly why this survived: it only failed for non-browser callers.
    // handlePut below already used the `=== undefined` form; this matches it.
    if (!description || rate === undefined || rate === null || rate === '' || !hsn_code) {
      return res.status(400).json({
        message: 'Description, rate, and HSN code are required'
      })
    }

    const rateError = rateProblem(rate)
    if (rateError) return res.status(400).json({ message: rateError })
    const parsedRate = parseFloat(rate)
    if (status !== undefined && status !== null && status !== '' && status !== 'Active' && status !== 'Inactive') {
      return res.status(400).json({ message: 'Status must be Active or Inactive' })
    }

    // Check if GST rate with same description already exists
    const existingRate = await prisma.gst_tax_rate.findFirst({
      where: { description }
    })

    if (existingRate) {
      return res.status(400).json({
        message: 'GST rate with this description already exists'
      })
    }

    const gstRate = await prisma.gst_tax_rate.create({
      data: {
        description,
        rate: parsedRate,
        hsn_code,
        applicable_for: (text(applicable_for) as string) || '',
        status: status || 'Active'
      }
    })

    return created(res, gstRate, 'GST rate created successfully')
  } catch (error) {
    return fail(res, error, 'create the GST rate')
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id, rate, applicable_for, status } = req.body
    const description = text(req.body.description) as string | undefined
    const hsn_code = text(req.body.hsn_code) as string | undefined

    if (status !== undefined && status !== null && status !== '' && status !== 'Active' && status !== 'Inactive') {
      return res.status(400).json({ message: 'Status must be Active or Inactive' })
    }

    // S-73: this went straight to parseInt(id). A missing id became
    // `where: { id: NaN }`, which Prisma throws on, so the caller got a 500
    // where every sibling endpoint answers 400.
    const rateId = parseId(id)
    if (rateId === null) {
      return res.status(400).json({ message: 'A valid GST rate ID is required' })
    }

    // Check if GST rate exists
    const existingRate = await prisma.gst_tax_rate.findUnique({
      where: { id: rateId }
    })

    if (!existingRate) {
      return res.status(404).json({
        message: 'GST rate not found'
      })
    }

    // Handle status-only update (for toggle functionality)
    if (description === undefined && rate === undefined && hsn_code === undefined && applicable_for === undefined && status) {
      const updatedRate = await prisma.gst_tax_rate.update({
        where: { id: rateId },
        data: { status }
      })
      return res.status(200).json({
        status: "success",
        message: "GST rate updated successfully"
      })
    }

    // Full update validation - accept snake_case field names like the frontend sends
    if (!description || rate === undefined || !hsn_code) {
      return res.status(400).json({
        message: 'Description, rate, and HSN code are required'
      })
    }
    const rateError = rateProblem(rate)
    if (rateError) return res.status(400).json({ message: rateError })

    // Check if another GST rate with same description exists (excluding current one)
    const duplicateRate = await prisma.gst_tax_rate.findFirst({
      where: {
        description,
        id: { not: rateId }
      }
    })

    if (duplicateRate) {
      return res.status(400).json({
        message: 'Another GST rate with this description already exists'
      })
    }

    const updateData: any = {
      description,
      rate: parseFloat(rate),
      hsn_code, // Frontend sends snake_case, store as snake_case
      applicable_for: (text(applicable_for) as string) || '' // Frontend sends snake_case, store as snake_case
    }

    // Include status if provided
    if (status) {
      updateData.status = status
    }

    const updatedRate = await prisma.gst_tax_rate.update({
      where: { id: rateId },
      data: updateData
    })

    res.status(200).json({
      status: "success",
      message: "GST rate updated successfully",
      data: updatedRate
    })
  } catch (error) {
    return fail(res, error, 'update the GST rate')
  }
}


export default withObservability(handler)