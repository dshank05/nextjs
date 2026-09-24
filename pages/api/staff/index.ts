import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { isTenDigitPhone, isValidEmail } from '../../../lib/validators'
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

// GET /api/staff - List all active staff
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { 
      includeInactive = 'false',
      dropdown = 'false',
      page = '1',
      limit = '50',
      search = '',
      sortBy = 'name',
      sortOrder = 'asc'
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Validate sortBy to prevent SQL injection
    const validSortFields = ['id', 'name', 'email', 'phone', 'status']
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'name'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    const where: any = {}
    
    // Search filter
    if (search) {
      const searchTerm = search as string
      where.OR = [
        { name: { contains: searchTerm } },
        { phone: { contains: searchTerm } },
        { email: { contains: searchTerm } }
      ]
    }

    // Status filter
    if (includeInactive !== 'true') {
      where.status = 'Active'
    }

    // A dropdown needs every active row, not the first page of them.
    // `dropdown=true` used to only filter by status while still paginating, so
    // any list longer than the default 50 was silently truncated and the
    // missing entry simply could not be selected - no error, just absent
    // (F-58). Pagination is skipped entirely in dropdown mode.
    const isDropdown = dropdown === 'true'

    const [staff, total] = await Promise.all([
      prisma.staff.findMany({
        where,
        orderBy: { [sortField]: sortDirection },
        ...(isDropdown ? {} : { skip, take: limitNum })
      }),
      prisma.staff.count({ where })
    ])

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      staff,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages
      }
    })
  } catch (error) {
    return fail(res, error, 'fetch staff')
  }
}

// POST /api/staff - Create new staff member
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      name,
      email,
      phone,
      status = 'Active'
    } = req.body

    // Validation
    if (!name || !phone) {
      return res.status(400).json({
        message: 'Name and phone are required'
      })
    }

    if (!isTenDigitPhone(phone)) {
      return res.status(400).json({
        message: 'Phone number must be exactly 10 digits'
      })
    }

    if (email && !isValidEmail(email)) {
      return res.status(400).json({
        message: 'Email address is not valid'
      })
    }

    // Check if phone already exists
    const existingStaff = await prisma.staff.findFirst({
      where: { phone }
    })

    if (existingStaff) {
      return res.status(400).json({
        message: 'Staff member with this phone number already exists'
      })
    }

    const staffData = {
      name: name.trim(),
      email: email?.trim() || null,
      phone: phone.trim(),
      status
    }

    const staff = await prisma.staff.create({
      data: staffData,
    })

    // Return the row. Every create in Settings but one answered with a bare
    // message, so a caller could not navigate to or highlight what it had just
    // made - and the record was already being fetched (S-53, S-79).
    return created(res, staff, 'Staff member created successfully')
  } catch (error) {
    return fail(res, error, 'create the staff member')
  }
}


export default withObservability(handler)