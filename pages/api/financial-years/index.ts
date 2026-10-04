import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { fail } from '../../../lib/api/respond'
import { validateFinancialYear, toDateColumn } from '../../../lib/financial-year-rules'

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

    // Never 0: an empty list is page 1 of 1.
    const totalPages = Math.max(1, Math.ceil(total / limitNum))
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

    // S-74: the April-1 / March-31 / one-year rules used to be written out
    // here AND again in the settings page, each with its own date parser. One
    // home now - and this is the copy that matters, because the browser's can
    // be skipped by any other caller.
    const checked = validateFinancialYear(start_date, end_date)
    if (checked.ok === false) {
      return res.status(400).json({ message: checked.message })
    }
    // E-04: the DATE columns get the calendar day typed (UTC midnight of it),
    // not local midnight - which Prisma stored as the day before.
    const startDate = toDateColumn(checked.value.startDate)
    const endDate = toDateColumn(checked.value.endDate)
    const { fy } = checked.value

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

    // A past year that overlaps nothing may be added for back-entry (owner,
    // 2026-10-03). The rule here refused any year starting before the open
    // year's end - every past year - with a "Cannot create future financial
    // year" message. Overlaps are refused above; that is the rule that matters.

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

    // The last day of the year is still the year: compare with the next midnight.
    if (currentDate >= new Date(fyEnd.getFullYear(), fyEnd.getMonth(), fyEnd.getDate() + 1)) {
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