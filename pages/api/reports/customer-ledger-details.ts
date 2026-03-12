import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { parseDateRange } from '../../../lib/date-utils'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const {
      customer_id,
      dateFrom,
      dateTo,
      page = '1',
      limit = '50'
    } = req.query

    if (!customer_id) {
      return res.status(400).json({ message: 'Customer ID is required' })
    }

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum
    const customerId = parseInt(customer_id as string)

    // Build date filter - default to last 3 months if not provided
    let dateFilter: any = {}
    if (dateFrom && dateTo) {
      const { startTimestamp, endTimestamp } = parseDateRange(
        dateFrom as string,
        dateTo as string
      );
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

    // Fetch sales with their allocations
    const sales = await prisma.invoice.findMany({
      where: {
        select_customer: customerId,
        ...(dateFrom && dateTo ? { invoice_date: dateFilter } : {})
      },
      select: {
        id: true,
        invoice_no: true,
        invoice_date: true,
        total: true,
        payment_status: true,
        customer_payment_allocations: {
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

    // Fetch salex with their allocations
    const salex = await prisma.invoicex.findMany({
      where: {
        select_customer: customerId,
        ...(dateFrom && dateTo ? { invoice_date: dateFilter } : {})
      },
      select: {
        id: true,
        invoice_no: true,
        invoice_date: true,
        total: true,
        payment_status: true,
        customer_payment_allocations: {
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
    const returns = await prisma.sale_returns.findMany({
      where: {
        invoice: {
          select_customer: customerId
        },
        ...(dateFrom && dateTo ? { return_date: dateFilter } : {})
      },
      select: {
        id: true,
        return_date: true,
        refund_amount: true,
        payment_status: true,
        customer_refund_allocations: {
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

    // Fetch salex returns with their allocations
    const salexReturns = await prisma.salex_returns.findMany({
      where: {
        invoicex: {
          select_customer: customerId
        },
        ...(dateFrom && dateTo ? { return_date: dateFilter } : {})
      },
      select: {
        id: true,
        return_date: true,
        refund_amount: true,
        payment_status: true,
        customer_refund_allocations: {
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

    // Format sale entries with simplified structure
    const saleEntries = sales.flatMap(sale => {
      const entries: any[] = []
      
      // Add sale entry
      const totalAllocated = sale.customer_payment_allocations.reduce(
        (sum, alloc) => sum + Number(alloc.allocated_amount), 
        0
      )
      
      entries.push({
        date: sale.invoice_date,
        formattedDate: new Date(sale.invoice_date * 1000).toLocaleDateString('en-IN'),
        transactionType: 'Sale',
        reference: `SINV-${sale.invoice_no}`,
        billAmount: Number(sale.total),
        paymentAmount: null,
        outstanding: Number(sale.total) - totalAllocated,
        mode: null,
        status: sale.payment_status
      })

      // Add payment entries (one per payment, not per allocation)
      const paymentMap = new Map()
      sale.customer_payment_allocations.forEach(alloc => {
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

    // Format salex entries with simplified structure
    const salexEntries = salex.flatMap(salexItem => {
      const entries: any[] = []
      
      // Add salex entry
      const totalAllocated = salexItem.customer_payment_allocations.reduce(
        (sum, alloc) => sum + Number(alloc.allocated_amount), 
        0
      )
      
      entries.push({
        date: salexItem.invoice_date,
        formattedDate: new Date(salexItem.invoice_date * 1000).toLocaleDateString('en-IN'),
        transactionType: 'Salex',
        reference: `SINVX-${salexItem.invoice_no}`,
        billAmount: Number(salexItem.total),
        paymentAmount: null,
        outstanding: Number(salexItem.total) - totalAllocated,
        mode: null,
        status: salexItem.payment_status
      })

      // Add payment entries (one per payment, not per allocation)
      const paymentMap = new Map()
      salexItem.customer_payment_allocations.forEach(alloc => {
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
    const returnEntries = [...returns, ...salexReturns].flatMap(returnItem => {
      const entries: any[] = []
      
      // Add return entry
      const totalAllocated = returnItem.customer_refund_allocations.reduce(
        (sum, alloc) => sum + Number(alloc.allocated_amount), 
        0
      )
      
      entries.push({
        date: returnItem.return_date,
        formattedDate: new Date(returnItem.return_date * 1000).toLocaleDateString('en-IN'),
        transactionType: 'Return',
        reference: `CR-${returnItem.id}`,
        billAmount: Number(returnItem.refund_amount),
        paymentAmount: null,
        outstanding: Number(returnItem.refund_amount) - totalAllocated,
        mode: null,
        status: returnItem.payment_status
      })

      // Add refund entries (one per refund, not per allocation)
      const refundMap = new Map()
      returnItem.customer_refund_allocations.forEach(alloc => {
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
    const allEntries = [...saleEntries, ...salexEntries, ...returnEntries].sort((a, b) => a.date - b.date)
    
    // Calculate running outstanding balance
    let runningOutstanding = 0
    allEntries.forEach(entry => {
      if (entry.transactionType === 'Sale' || entry.transactionType === 'Salex') {
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
    console.error('Customer ledger details fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch customer ledger details',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
