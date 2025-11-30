import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'

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
    const {
      page = '1',
      limit = '50',
      search = '',
      vendor = '',
      status = '',
      dateFrom = '',
      dateTo = '',
      amountMin = '',
      amountMax = '',
      fy = '',
      sortBy = 'return_date',
      sortOrder = 'desc'
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {}

    // Search filter - search across return_no, vendor_name, notes
    if (search) {
      const searchStr = Array.isArray(search) ? search[0] : search;
      const searchNum = parseInt(searchStr);
      where.OR = [
        !isNaN(searchNum) ? { id: searchNum } : undefined,
        { notes: { contains: searchStr } },
      ].filter(Boolean) // Remove undefined values
    }

    // Financial year filter
    if (fy && fy !== '') {
      where.fy = parseInt(fy as string)
    }

    // Status filter
    if (status && status !== '') {
      where.status = status as string
    }

    // Amount range filters
    if (amountMin && amountMin !== '') {
      where.total_amount = { gte: parseFloat(amountMin as string) }
    }
    if (amountMax && amountMax !== '') {
      where.total_amount = where.total_amount
        ? { ...where.total_amount, lte: parseFloat(amountMax as string) }
        : { lte: parseFloat(amountMax as string) }
    }

    // Date range filters
    if (dateFrom && dateTo) {
      try {
        const startDateObj = new Date(dateFrom as string);
        const endDateObj = new Date(dateTo as string);

        if (!isNaN(startDateObj.getTime()) && !isNaN(endDateObj.getTime())) {
          const startTimestamp = Math.floor(startDateObj.getTime() / 1000);
          const endTimestamp = Math.floor(endDateObj.getTime() / 1000);

          where.return_date = {
            gte: startTimestamp,
            lte: endTimestamp
          };
        }
      } catch (error) {
        console.warn('Error parsing filter dates:', error);
      }
    }

    // Validate and set sort parameters
    const validSortFields = ['id', 'return_date', 'total_amount', 'total_tax', 'status', 'fy', 'vendor_name']
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'return_date'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    // For vendor_name sorting, we need to fetch all data first and sort in JavaScript
    const needsPostSorting = sortField === 'vendor_name'

    let returns: any[] = []
    let total: number = 0

    if (needsPostSorting) {
      // Get all returns without sorting (we'll sort after fetching vendor names)
      const result = await Promise.all([
        prisma.purchase_returns.findMany({
          where,
          select: {
            id: true,
            vendor_id: true,
            purchase_id: true,
            return_date: true,
            total_amount: true,
            total_tax: true,
            status: true,
            notes: true,
            fy: true,
            created_at: true,
            updated_at: true
          }
        }),
        prisma.purchase_returns.count({ where })
      ])
      returns = result[0]
      total = result[1]
    } else {
      // Get returns with database-level sorting
      const result = await Promise.all([
        prisma.purchase_returns.findMany({
          where,
          skip,
          take: limitNum,
          orderBy: { [sortField]: sortDirection },
          select: {
            id: true,
            vendor_id: true,
            purchase_id: true,
            return_date: true,
            total_amount: true,
            total_tax: true,
            status: true,
            notes: true,
            fy: true,
            created_at: true,
            updated_at: true
          }
        }),
        prisma.purchase_returns.count({ where })
      ])
      returns = result[0]
      total = result[1]
    }

    // Get vendor info and item counts in batch queries
    const vendorIds = Array.from(new Set(returns.map(r => r.vendor_id).filter(Boolean)))
    const returnIds = returns.map(r => r.id)

    // Get vendor details directly from returns
    const [vendorData, itemCounts] = await Promise.all([
      // Get vendor details using vendor_ids from returns
      vendorIds.length > 0 ? prisma.vendor_details.findMany({
        where: { id: { in: vendorIds } },
        select: { id: true, vendor_name: true, tax_id: true, address: true }
      }) : Promise.resolve([]),

      // Get item counts for each return
      returnIds.length > 0 ? prisma.purchase_return_items.groupBy({
        by: ['purchase_return_id'],
        where: { purchase_return_id: { in: returnIds } },
        _count: { id: true }
      }) : Promise.resolve([])
    ])

    // Create lookup maps
    const vendorMap = new Map(vendorData.map(v => [v.id, v]))
    const itemCountMap = new Map(itemCounts.map(ic => [ic.purchase_return_id, ic._count.id]))

    // Enhanced returns with vendor info (direct relationship)
    let enhancedReturns = returns.map((returnRecord) => {
      const vendor = vendorMap.get(returnRecord.vendor_id)

      // Format date
      let formattedDate: string | null = null
      try {
        if (returnRecord.return_date) {
          const dateObj = new Date(returnRecord.return_date * 1000)
          if (!isNaN(dateObj.getTime())) {
            formattedDate = dateObj.toLocaleDateString('en-IN')
          }
        }
      } catch (error) {
        console.warn('Invalid date format for return:', returnRecord.return_date, error)
      }

      return {
        id: returnRecord.id,
        return_no: `PR-${String(returnRecord.id).padStart(3, '0')}`, // Generate return number
        vendor_name: vendor?.vendor_name || 'Unknown Vendor',
        vendor_gstin: vendor?.tax_id || '',
        vendor_address: vendor?.address || '',
        total_amount: returnRecord.total_amount || 0,
        total_tax: returnRecord.total_tax || 0,
        status: returnRecord.status || 'Completed',
        return_date: returnRecord.return_date,
        formattedDate: formattedDate,
        item_count: itemCountMap.get(returnRecord.id) || 0,
        notes: returnRecord.notes || '',
        fy: returnRecord.fy,
        created_at: returnRecord.created_at,
        updated_at: returnRecord.updated_at
      }
    })

    // Apply vendor filter (after data enhancement)
    if (vendor && vendor !== '') {
      const vendorStr = Array.isArray(vendor) ? vendor[0] : vendor;
      enhancedReturns = enhancedReturns.filter(ret =>
        ret.vendor_name.toLowerCase().includes(vendorStr.toLowerCase())
      )
    }

    // Apply post-sorting for vendor_name if needed
    if (needsPostSorting) {
      enhancedReturns.sort((a, b) => {
        const aValue = (a.vendor_name || '').toString().toLowerCase()
        const bValue = (b.vendor_name || '').toString().toLowerCase()

        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
        return 0
      })

      // Apply pagination after sorting
      enhancedReturns = enhancedReturns.slice(skip, skip + limitNum)
    }

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      returns: enhancedReturns,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    console.error('Purchase returns fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch purchase returns data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    // TODO: Implement return creation logic
    // This will handle creating new purchase returns
    res.status(501).json({ message: 'Return creation not implemented yet' })
  } catch (error) {
    console.error('Purchase return creation error:', error)
    res.status(500).json({
      message: 'Failed to create purchase return',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
