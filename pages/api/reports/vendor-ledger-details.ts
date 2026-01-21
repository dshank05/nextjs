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

    // Format purchase entries with simplified structure
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
        transactionType: 'Purchase',
        reference: `PUR-${purchase.invoice_no}`,
        billAmount: Number(purchase.total),
        paymentAmount: null,
        outstanding: Number(purchase.total) - totalAllocated,
        mode: null,
        status: purchase.payment_status
      })

      // Add payment entries (one per payment, not per allocation)
      const paymentMap = new Map()
      purchase.payment_allocations.forEach(alloc => {
        const paymentId = alloc.payment.id
        if (!paymentMap.has(paymentId)) {
          paymentMap.set(paymentId, {
            date: alloc.payment.payment_date,
            formattedDate: new Date(alloc.payment.payment_date * 1000).toLocaleDateString('en-IN'),
            transactionType: 'Payment',
            reference: `PAY-${paymentId}`,
            billAmount: null,
            paymentAmount: Number(alloc.payment.payment_amount),
            outstanding: null, // Will be calculated later
            mode: alloc.payment.payment_mode,
            status: null
          })
        }
      })
      
      entries.push(...Array.from(paymentMap.values()))
      return entries
    })

    // Format return entries with simplified structure
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
        transactionType: 'Return',
        reference: returnItem.debit_note_no || `RET-${returnItem.id}`,
        billAmount: Number(returnItem.refund_amount),
        paymentAmount: null,
        outstanding: Number(returnItem.refund_amount) - totalAllocated,
        mode: null,
        status: returnItem.payment_status
      })

      // Add refund entries (one per refund, not per allocation)
      const refundMap = new Map()
      returnItem.refund_allocations.forEach(alloc => {
        const refundId = alloc.refund.id
        if (!refundMap.has(refundId)) {
          refundMap.set(refundId, {
            date: alloc.refund.refund_date,
            formattedDate: new Date(alloc.refund.refund_date * 1000).toLocaleDateString('en-IN'),
            transactionType: 'Refund',
            reference: `REF-${refundId}`,
            billAmount: null,
            paymentAmount: Number(alloc.refund.refund_amount),
            outstanding: null, // Will be calculated later
            mode: alloc.refund.refund_mode,
            status: null
          })
        }
      })
      
      entries.push(...Array.from(refundMap.values()))
      return entries
    })

    // Combine and sort all entries by date
    const allEntries = [...purchaseEntries, ...returnEntries].sort((a, b) => a.date - b.date)
    
    // Calculate running outstanding balance
    let runningOutstanding = 0
    allEntries.forEach(entry => {
      if (entry.transactionType === 'Purchase') {
        runningOutstanding += entry.billAmount
        entry.outstanding = runningOutstanding
      } else if (entry.transactionType === 'Payment') {
        runningOutstanding -= entry.paymentAmount
        entry.outstanding = runningOutstanding
      } else if (entry.transactionType === 'Return') {
        runningOutstanding -= entry.billAmount
        entry.outstanding = runningOutstanding
      } else if (entry.transactionType === 'Refund') {
        runningOutstanding += entry.paymentAmount
        entry.outstanding = runningOutstanding
      }
    })

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
