import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const {
      vendor_id,
      dateFrom,
      dateTo,
      page = '1',
      limit = '50'
    } = req.query

    if (!vendor_id) {
      return res.status(400).json({ message: 'Vendor ID is required' })
    }

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum
    const vendorId = parseInt(vendor_id as string)

    // Build date filter - default to last 3 months if not provided
    let dateFilter: any = {}
    if (dateFrom && dateTo) {
      const startTimestamp = Math.floor(new Date(dateFrom as string).getTime() / 1000)
      const endTimestamp = Math.floor(new Date(dateTo as string).getTime() / 1000)
      dateFilter = {
        gte: startTimestamp,
        lte: endTimestamp
      }
    } else {
      // Default: Last 3 months
      const now = new Date()
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())
      dateFilter = {
        gte: Math.floor(threeMonthsAgo.getTime() / 1000),
        lte: Math.floor(now.getTime() / 1000)
      }
    }

    // Fetch purchases with their allocations
    const purchases = await prisma.purchase.findMany({
      where: {
        vendor_id: vendorId,
        ...(dateFrom && dateTo ? { invoice_date: dateFilter } : {})
      },
      select: {
        id: true,
        invoice_no: true,
        invoice_date: true,
        total: true,
        payment_status: true,
        payment_allocations: {
          select: {
            allocated_amount: true,
            allocation_date: true,
            payment: {
              select: {
                id: true,
                payment_date: true,
                payment_amount: true,
                payment_mode: true,
                payment_type: true
              }
            }
          }
        }
      },
      orderBy: { invoice_date: 'asc' }
    })

    // Fetch returns with their allocations
    const returns = await prisma.purchase_returns.findMany({
      where: {
        vendor_id: vendorId,
        ...(dateFrom && dateTo ? { return_date: dateFilter } : {})
      },
      select: {
        id: true,
        debit_note_no: true,
        return_date: true,
        refund_amount: true,
        payment_status: true,
        refund_allocations: {
          select: {
            allocated_amount: true,
            allocation_date: true,
            refund: {
              select: {
                id: true,
                refund_date: true,
                refund_amount: true,
                refund_mode: true,
                refund_type: true
              }
            }
          }
        }
      },
      orderBy: { return_date: 'asc' }
    })

    // Format purchase entries
    const purchaseEntries = purchases.flatMap(purchase => {
      const entries: any[] = []
      
      // Add purchase entry
      const totalAllocated = purchase.payment_allocations.reduce(
        (sum, alloc) => sum + Number(alloc.allocated_amount), 
        0
      )
      
      entries.push({
        date: purchase.invoice_date,
        formattedDate: new Date(purchase.invoice_date * 1000).toLocaleDateString('en-IN'),
        type: 'Purchase',
        refNo: `PUR-${purchase.invoice_no}`,
        billRef: '-',
        amount: Number(purchase.total),
        allocated: totalAllocated,
        balance: Number(purchase.total) - totalAllocated,
        paymentStatus: purchase.payment_status
      })

      // Add payment allocation entries
      purchase.payment_allocations.forEach(alloc => {
        entries.push({
          date: alloc.payment.payment_date,
          formattedDate: new Date(alloc.payment.payment_date * 1000).toLocaleDateString('en-IN'),
          type: 'Payment',
          refNo: `PAY-${alloc.payment.id}`,
          billRef: `PUR-${purchase.invoice_no}`,
          amount: Number(alloc.payment.payment_amount),
          allocated: Number(alloc.allocated_amount),
          balance: 0, // Will be calculated later
          paymentMode: alloc.payment.payment_mode,
          paymentType: alloc.payment.payment_type
        })
      })

      return entries
    })

    // Format return entries
    const returnEntries = returns.flatMap(returnItem => {
      const entries: any[] = []
      
      // Add return entry
      const totalAllocated = returnItem.refund_allocations.reduce(
        (sum, alloc) => sum + Number(alloc.allocated_amount), 
        0
      )
      
      entries.push({
        date: returnItem.return_date,
        formattedDate: new Date(returnItem.return_date * 1000).toLocaleDateString('en-IN'),
        type: 'Return',
        refNo: returnItem.debit_note_no || `RET-${returnItem.id}`,
        billRef: '-',
        amount: Number(returnItem.refund_amount),
        allocated: totalAllocated,
        balance: Number(returnItem.refund_amount) - totalAllocated,
        paymentStatus: returnItem.payment_status
      })

      // Add refund allocation entries
      returnItem.refund_allocations.forEach(alloc => {
        entries.push({
          date: alloc.refund.refund_date,
          formattedDate: new Date(alloc.refund.refund_date * 1000).toLocaleDateString('en-IN'),
          type: 'Refund',
          refNo: `REF-${alloc.refund.id}`,
          billRef: returnItem.debit_note_no || `RET-${returnItem.id}`,
          amount: Number(alloc.refund.refund_amount),
          allocated: Number(alloc.allocated_amount),
          balance: 0, // Will be calculated later
          refundMode: alloc.refund.refund_mode,
          refundType: alloc.refund.refund_type
        })
      })

      return entries
    })

    // Combine and sort all entries by date
    const allEntries = [...purchaseEntries, ...returnEntries].sort((a, b) => a.date - b.date)

    // Apply pagination
    const paginatedEntries = allEntries.slice(skip, skip + limitNum)
    const total = allEntries.length
    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      entries: paginatedEntries,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages
      }
    })
  } catch (error) {
    console.error('Vendor ledger details fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch vendor ledger details',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
