import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { fail } from '../../../lib/api/respond'

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
    const { page = 1, limit = 50, search = '', sortBy = 'fy', sortOrder = 'desc' } = req.query

    const pageNum = parseInt(page as string, 10)
    const limitNum = parseInt(limit as string, 10)
    const searchTerm = search as string
    const sortField = sortBy as string
    const sortDir = sortOrder === 'asc' ? 'asc' : 'desc'

    // Build where clause for search
    const where = searchTerm ? {
      fy: {
        contains: searchTerm
      }
    } : {}

    // Ordered explicitly. `settings` is a singleton the whole app reads with
    // findFirst(), and without an orderBy "first" is whatever the database feels
    // like returning - so a second row would make the current financial year
    // non-deterministic between calls. Same fix as F-52 for business_details (S-81).
    const settings = await prisma.settings.findFirst({ orderBy: { id: 'asc' } })
    const currentFyId = settings?.currentfy || null

    // Handle status sorting specially since it's derived from currentFyId
    let financialYears: any[]

    if (sortField === 'status') {
      // For status sorting, get all matching records first, then sort manually
      const allMatchingData = await prisma.financial_year.findMany({
        where,
        select: {
          id: true,
          fy: true,
          start_date: true,
          end_date: true
        }
      })

      // Sort by status: Current FY first (asc) or Current FY last (desc)
      if (sortDir === 'asc') {
        // Current FY first, then inactive FYS
        const currentFirst = allMatchingData.sort((a, b) => {
          if (a.id === currentFyId && b.id !== currentFyId) return -1
          if (a.id !== currentFyId && b.id === currentFyId) return 1
          // Sort by FY as secondary sort when both are current (unlikely) or both inactive
          return a.fy.localeCompare(b.fy)
        })
        // Apply pagination after manual sorting
        financialYears = currentFirst.slice((pageNum - 1) * limitNum, pageNum * limitNum)
      } else {
        // Current FY last, inactive FYS first
        const currentLast = allMatchingData.sort((a, b) => {
          if (a.id === currentFyId && b.id !== currentFyId) return 1
          if (a.id !== currentFyId && b.id === currentFyId) return -1
          // Sort by FY as secondary sort
          return b.fy.localeCompare(a.fy)
        })
        // Apply pagination after manual sorting
        financialYears = currentLast.slice((pageNum - 1) * limitNum, pageNum * limitNum)
      }
    } else {
      // Normal database sorting for other fields
      const orderBy: any = {}
      const validSortFields = ['id', 'fy', 'start_date', 'end_date']
      const field = validSortFields.includes(sortField) ? sortField : 'fy'
      orderBy[field] = sortDir

      financialYears = await prisma.financial_year.findMany({
        where,
        select: {
          id: true,
          fy: true,
          start_date: true,
          end_date: true
        },
        orderBy,
        skip: (pageNum - 1) * limitNum,
        take: limitNum
      })
    }

    // Get total count for pagination
    const total = await prisma.financial_year.count({ where })

    const totalPages = Math.ceil(total / limitNum)
    const hasMore = pageNum < totalPages

    res.status(200).json({
      financialYears,
      currentFyId,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore
      }
    })
  } catch (error) {
    return fail(res, error, 'fetch financial years')
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { start_date, end_date } = req.body

    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({
        message: 'Start date and end date are required'
      })
    }

    // Parse dates manually to avoid timezone issues
    const parseDate = (dateString: string): Date => {
      const [year, month, day] = dateString.split('-').map(Number);
      return new Date(year, month - 1, day); // month is 0-indexed in Date constructor
    };

    const startDate = parseDate(start_date);
    const endDate = parseDate(end_date);

    // Validate dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        message: 'Invalid date format'
      })
    }

    // Validate end date is after start date
    if (endDate <= startDate) {
      return res.status(400).json({
        message: 'End date must be after start date'
      })
    }

    // Validate Indian FY format: April 1 to March 31
    const startMonth = startDate.getMonth(); // 0-indexed
    const startDay = startDate.getDate();
    const endMonth = endDate.getMonth();
    const endDay = endDate.getDate();

    if (startMonth !== 3 || startDay !== 1) { // April 1 (month 3 is April in 0-indexed)
      return res.status(400).json({
        message: 'Financial year must start on April 1'
      })
    }

    if (endMonth !== 2 || endDay !== 31) { // March 31 (month 2 is March in 0-indexed)
      return res.status(400).json({
        message: 'Financial year must end on March 31'
      })
    }

    // Auto-generate FY string from dates (e.g., "2024-2025")
    const startYear = startDate.getFullYear()
    const endYear = endDate.getFullYear()
    const fy = `${startYear}-${endYear}`

    // Validate that end year is start year + 1
    if (endYear !== startYear + 1) {
      return res.status(400).json({
        message: 'Financial year must span exactly one year (e.g., 2024-2025)'
      })
    }

    // Check if financial year already exists
    const existingFy = await prisma.financial_year.findFirst({
      where: {
        fy: fy
      }
    })

    if (existingFy) {
      return res.status(409).json({
        message: `Financial year ${fy} already exists`
      })
    }

    // Check for date overlaps with existing financial years
    const overlappingFy = await prisma.financial_year.findFirst({
      where: {
        OR: [
          // New FY starts during an existing FY
          {
            AND: [
              { start_date: { lte: startDate } },
              { end_date: { gte: startDate } }
            ]
          },
          // New FY ends during an existing FY
          {
            AND: [
              { start_date: { lte: endDate } },
              { end_date: { gte: endDate } }
            ]
          },
          // New FY completely contains an existing FY
          {
            AND: [
              { start_date: { gte: startDate } },
              { end_date: { lte: endDate } }
            ]
          }
        ]
      }
    })

    if (overlappingFy) {
      return res.status(409).json({
        message: `Cannot create financial year. It overlaps with existing FY ${overlappingFy.fy}`
      })
    }

    // Check if there's a current FY that hasn't ended yet
    const currentDate = new Date()
    const activeFy = await prisma.financial_year.findFirst({
      where: {
        AND: [
          { start_date: { lte: currentDate } },
          { end_date: { gte: currentDate } }
        ]
      }
    })

    // If there's an active FY and user is trying to create a FY that starts before current FY ends
    if (activeFy && startDate < activeFy.end_date) {
      // Format end date in local timezone for error message
      const endYear = activeFy.end_date.getFullYear();
      const endMonth = String(activeFy.end_date.getMonth() + 1).padStart(2, '0');
      const endDay = String(activeFy.end_date.getDate()).padStart(2, '0');
      const endDateString = `${endYear}-${endMonth}-${endDay}`;
      
      return res.status(409).json({
        message: `Cannot create future financial year. Current FY ${activeFy.fy} is still active and ends on ${endDateString}`
      })
    }

    // Create new financial year
    const financialYear = await prisma.financial_year.create({
      data: {
        fy: fy,
        start_date: startDate,
        end_date: endDate
      },
      select: {
        id: true,
        fy: true,
        start_date: true,
        end_date: true
      }
    })

    res.status(201).json({
      status: "success",
      message: "Financial year created successfully",
      financialYear
    })
  } catch (error) {
    return fail(res, error, 'create the financial year')
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { fyId } = req.body

    if (!fyId) {
      return res.status(400).json({
        message: 'Financial year ID is required'
      })
    }

    // Validate that the financial year exists
    const financialYear = await prisma.financial_year.findUnique({
      where: { id: parseInt(fyId) }
    })

    if (!financialYear) {
      return res.status(404).json({
        message: 'Financial year not found'
      })
    }

    // S-87: this pair used to round-trip each date through a YYYY-MM-DD string
    // and parse it straight back. The only actual effect was dropping the time
    // component, which one helper does directly.
    const atMidnight = (date: Date): Date =>
      new Date(date.getFullYear(), date.getMonth(), date.getDate())

    // Validate that the current date falls within the FY being set as current
    const currentDate = new Date()
    const fyStart = atMidnight(financialYear.start_date)
    const fyEnd = atMidnight(financialYear.end_date)

    if (currentDate < fyStart) {
      return res.status(400).json({
        message: `Cannot set FY ${financialYear.fy} as current. This financial year hasn't started yet (starts ${fyStart.toLocaleDateString()})`
      })
    }

    if (currentDate > fyEnd) {
      return res.status(400).json({
        message: `Cannot set FY ${financialYear.fy} as current. This financial year has already ended (ended ${fyEnd.toLocaleDateString()})`
      })
    }

    // Ensure settings table has at least one row. Ordered, as above (S-81).
    let settings = await prisma.settings.findFirst({ orderBy: { id: 'asc' } })
    
    if (!settings) {
      // Create settings record if it doesn't exist
      settings = await prisma.settings.create({
        data: {
          currentfy: parseInt(fyId)
        }
      })
    } else {
      // Update the current financial year in settings
      settings = await prisma.settings.update({
        where: { id: settings.id },
        data: {
          currentfy: parseInt(fyId)
        }
      })
    }

    res.status(200).json({
      status: "success",
      message: `Financial year ${financialYear.fy} set as current`,
      currentFy: {
        id: financialYear.id,
        fy: financialYear.fy
      }
    })
  } catch (error) {
    return fail(res, error, 'set the current financial year')
  }
}


export default withObservability(handler)