import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { recordRefundPaidTransaction } from '../../../lib/customer-ledger-service'

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
      customer = '',
      status = '',
      dateFrom = '',
      dateTo = '',
      fy = '',
      sortBy = 'refund_date',
      sortOrder = 'desc'
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {}

    // Search filter
    if (search) {
      const searchStr = Array.isArray(search) ? search[0] : search;
      const searchNum = parseInt(searchStr);
      where.OR = [
        !isNaN(searchNum) ? { id: searchNum } : undefined,
        { notes: { contains: searchStr } },
      ].filter(Boolean)
    }

    // Financial year filter
    if (fy && fy !== '') {
      where.fy = parseInt(fy as string)
    }

    // Date range filters
    if (dateFrom && dateTo) {
      try {
        const startDateObj = new Date(dateFrom as string);
        const endDateObj = new Date(dateTo as string);

        if (!isNaN(startDateObj.getTime()) && !isNaN(endDateObj.getTime())) {
          const startTimestamp = Math.floor(startDateObj.getTime() / 1000);
          const endTimestamp = Math.floor(endDateObj.getTime() / 1000);

          where.refund_date = {
            gte: startTimestamp,
            lte: endTimestamp
          };
        }
      } catch (error) {
        console.warn('Error parsing filter dates:', error);
      }
    }

    // Validate and set sort parameters
    const validSortFields = ['id', 'refund_date', 'refund_amount', 'refund_mode', 'fy']
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'refund_date'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    let refunds: any[] = []
    let total: number = 0

    // Get refunds with database-level sorting
    const result = await Promise.all([
      prisma.customer_refunds.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { [sortField]: sortDirection },
        select: {
          id: true,
          customer_id: true,
          refund_date: true,
          refund_amount: true,
          refund_mode: true,
          refund_type: true,
          notes: true,
          fy: true,
          created_at: true,
          allocations: {
            select: {
              id: true,
              sale_return_id: true,
              salex_return_id: true,
              allocated_amount: true,
              allocation_date: true,
              notes: true
            }
          }
        }
      }),
      prisma.customer_refunds.count({ where })
    ])
    refunds = result[0]
    total = result[1]

    // Get customer names and return details in batch queries
    const customerIds = Array.from(new Set(refunds.map(r => r.customer_id).filter(Boolean)))
    const saleReturnIds = Array.from(new Set(refunds.flatMap(r => r.allocations.map(a => a.sale_return_id)).filter(Boolean)))
    const salexReturnIds = Array.from(new Set(refunds.flatMap(r => r.allocations.map(a => a.salex_return_id)).filter(Boolean)))

    const [customerData, saleReturnData, salexReturnData] = await Promise.all([
      customerIds.length > 0 ? prisma.customer_details.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, billing_name: true }
      }) : Promise.resolve([]),

      saleReturnIds.length > 0 ? prisma.sale_returns.findMany({
        where: { id: { in: saleReturnIds } },
        select: { id: true }
      }) : Promise.resolve([]),

      salexReturnIds.length > 0 ? prisma.salex_returns.findMany({
        where: { id: { in: salexReturnIds } },
        select: { id: true }
      }) : Promise.resolve([])
    ])

    // Create lookup maps
    const customerMap = new Map(customerData.map(c => [c.id, c.billing_name]))
    const saleReturnMap = new Map(saleReturnData.map(r => [r.id, `SR-${r.id}`]))
    const salexReturnMap = new Map(salexReturnData.map(r => [r.id, `SX-${r.id}`]))

    // Enhanced refunds with customer and return info
    const enhancedRefunds = refunds.map((refund) => {
      // Format date
      let formattedDate: string | null = null
      try {
        if (refund.refund_date) {
          const dateObj = new Date(refund.refund_date * 1000)
          if (!isNaN(dateObj.getTime())) {
            formattedDate = dateObj.toLocaleDateString('en-IN')
          }
        }
      } catch (error) {
        console.warn('Invalid date format for refund:', refund.refund_date, error)
      }

      // Enhance allocations with return details
      const enhancedAllocations = refund.allocations.map(allocation => ({
        ...allocation,
        return_no: allocation.sale_return_id ? saleReturnMap.get(allocation.sale_return_id) :
                   allocation.salex_return_id ? salexReturnMap.get(allocation.salex_return_id) : null,
        type: allocation.sale_return_id ? 'sale' : 'salex'
      }))

      return {
        id: refund.id,
        customer_id: refund.customer_id,
        customer_name: customerMap.get(refund.customer_id) || 'Unknown Customer',
        refund_date: refund.refund_date,
        formattedDate: formattedDate,
        refund_amount: refund.refund_amount,
        refund_mode: refund.refund_mode,
        refund_type: refund.refund_type,
        notes: refund.notes,
        fy: refund.fy,
        allocations: enhancedAllocations,
        total_allocated: enhancedAllocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0),
        created_at: refund.created_at
      }
    })

    // Apply customer filter (after data enhancement)
    if (customer && customer !== '') {
      const customerStr = Array.isArray(customer) ? customer[0] : customer;
      const customerNum = parseInt(customerStr);

      if (!isNaN(customerNum)) {
        // Filter by customer ID
        enhancedRefunds.filter(r => r.customer_id === customerNum);
      } else {
        // Filter by customer name
        enhancedRefunds.filter(r =>
          r.customer_name.toLowerCase().includes(customerStr.toLowerCase())
        );
      }
    }

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      refunds: enhancedRefunds,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    console.error('Customer refunds fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch customer refunds data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      customer_id,
      refund_date,
      refund_amount,
      refund_mode,
      refund_type = 'REFUND',
      notes,
      allocations // Array of { return_id?, allocated_amount, notes? }
    } = req.body

    // Validation
    if (!customer_id || !refund_amount || !allocations || allocations.length === 0) {
      return res.status(400).json({
        message: 'Customer ID, refund amount, and allocations are required'
      })
    }

    // Validate customer exists
    const customer = await prisma.customer_details.findUnique({
      where: { id: parseInt(customer_id) },
      select: { id: true, billing_name: true }
    })

    if (!customer) {
      return res.status(400).json({
        message: 'Invalid customer selected - customer does not exist'
      })
    }

    // Get current financial year
    const currentDate = new Date()
    const currentYear = currentDate.getFullYear()
    const financialYear = currentDate.getMonth() >= 3 ? currentYear : currentYear - 1

    // Convert refund date to Unix timestamp
    const refundDateTimestamp = refund_date ? Math.floor(new Date(refund_date).getTime() / 1000) : Math.floor(Date.now() / 1000)

    // Validate allocations
    let totalAllocated = 0
    const validatedAllocations = []

    for (const allocation of allocations) {
      const allocatedAmount = parseFloat(allocation.allocated_amount)
      if (allocatedAmount <= 0) {
        return res.status(400).json({
          message: 'Allocation amounts must be greater than 0'
        })
      }

      // Check if return exists and get outstanding refund amount
      let outstandingRefund = 0
      let returnType = ''
      let returnNo = ''

      // Determine if it's sale or salex return
      const saleReturn = await prisma.sale_returns.findUnique({
        where: { id: parseInt(allocation.return_id) },
        select: { id: true, refund_amount: true, payment_status: true }
      })

      const salexReturn = !saleReturn ? await prisma.salex_returns.findUnique({
        where: { id: parseInt(allocation.return_id) },
        select: { id: true, refund_amount: true, payment_status: true }
      }) : null

      const returnRecord = saleReturn || salexReturn

      if (!returnRecord) {
        return res.status(400).json({
          message: `Return ${allocation.return_id} not found`
        })
      }

      // Check if return belongs to customer
      if (saleReturn) {
        // Get the invoice_id from the return, then check customer
        const returnWithInvoice = await prisma.sale_returns.findUnique({
          where: { id: parseInt(allocation.return_id) },
          select: { invoice_id: true }
        })
        
        const invoice = await prisma.invoice.findUnique({
          where: { id: returnWithInvoice.invoice_id },
          select: { select_customer: true }
        })
        
        if (invoice?.select_customer !== parseInt(customer_id)) {
          return res.status(400).json({
            message: `Sale return ${allocation.return_id} does not belong to selected customer`
          })
        }
        returnType = 'sale'
        returnNo = `SR-${returnRecord.id}`
      } else if (salexReturn) {
        // Get the invoicex_id from the return, then check customer
        const returnWithInvoice = await prisma.salex_returns.findUnique({
          where: { id: parseInt(allocation.return_id) },
          select: { invoicex_id: true }
        })
        
        const invoicex = await prisma.invoicex.findUnique({
          where: { id: returnWithInvoice.invoicex_id },
          select: { select_customer: true }
        })
        
        if (invoicex?.select_customer !== parseInt(customer_id)) {
          return res.status(400).json({
            message: `Salex return ${allocation.return_id} does not belong to selected customer`
          })
        }
        returnType = 'salex'
        returnNo = `SX-${returnRecord.id}`
      }

      // Calculate outstanding refund amount
      const existingAllocations = saleReturn
        ? await prisma.customer_refund_allocations.aggregate({
            where: { sale_return_id: parseInt(allocation.return_id) },
            _sum: { allocated_amount: true }
          })
        : await prisma.customer_refund_allocations.aggregate({
            where: { salex_return_id: parseInt(allocation.return_id) },
            _sum: { allocated_amount: true }
          })

      const alreadyRefunded = Number(existingAllocations._sum.allocated_amount || 0)
      outstandingRefund = Number(returnRecord.refund_amount) - alreadyRefunded

      if (allocatedAmount > outstandingRefund) {
        return res.status(400).json({
          message: `Allocation amount ₹${allocatedAmount} exceeds outstanding refund amount ₹${outstandingRefund} for return ${returnNo}`
        })
      }

      totalAllocated += allocatedAmount
      validatedAllocations.push({
        return_id: parseInt(allocation.return_id),
        sale_return_id: saleReturn ? parseInt(allocation.return_id) : null,
        salex_return_id: salexReturn ? parseInt(allocation.return_id) : null,
        allocated_amount: allocatedAmount,
        allocation_date: refundDateTimestamp,
        notes: allocation.notes || ''
      })
    }

    if (totalAllocated > parseFloat(refund_amount)) {
      return res.status(400).json({
        message: `Total allocated amount ₹${totalAllocated} exceeds refund amount ₹${refund_amount}`
      })
    }

    // Use database transaction for refund creation and allocations
    const result = await prisma.$transaction(async (tx) => {
      // Create the refund record
      const refund = await tx.customer_refunds.create({
        data: {
          customer_id: parseInt(customer_id),
          refund_date: refundDateTimestamp,
          refund_amount: parseFloat(refund_amount),
          refund_mode: parseInt(refund_mode) || 1,
          refund_type: refund_type,
          notes: notes || '',
          fy: financialYear
        }
      })

      // Create allocation records
      for (const allocation of validatedAllocations) {
        await tx.customer_refund_allocations.create({
          data: {
            refund_id: refund.id,
            sale_return_id: allocation.sale_return_id,
            salex_return_id: allocation.salex_return_id,
            allocated_amount: allocation.allocated_amount,
            allocation_date: allocation.allocation_date,
            notes: allocation.notes
          }
        })
      }

      // Update payment status for allocated returns
      for (const allocation of validatedAllocations) {
        if (allocation.sale_return_id) {
          await updateReturnRefundStatus(tx, allocation.sale_return_id, 'sale')
        } else if (allocation.salex_return_id) {
          await updateReturnRefundStatus(tx, allocation.salex_return_id, 'salex')
        }
      }

      return refund
    })

    // Create customer ledger entry for refund (outside transaction)
    try {
      await recordRefundPaidTransaction(
        parseInt(customer_id),
        result.id,
        `REF-${String(result.id).padStart(3, '0')}`,
        parseFloat(refund_amount),
        refundDateTimestamp,
        parseInt(refund_mode) || 1,
        financialYear,
        notes || `Customer refund payment`
      )
    } catch (ledgerError) {
      console.error('Failed to create customer ledger entry:', ledgerError)
      // Don't fail the refund if ledger entry fails
    }

    res.status(201).json({
      success: true,
      message: 'Customer refund recorded successfully',
      data: {
        refund: {
          id: result.id,
          refund_no: `REF-${String(result.id).padStart(3, '0')}`,
          customer_name: customer.billing_name,
          refund_amount: result.refund_amount,
          refund_mode: result.refund_mode,
          total_allocated: totalAllocated,
          allocations_count: validatedAllocations.length,
          notes: result.notes
        }
      }
    })

  } catch (error) {
    console.error('Customer refund creation error:', error)
    res.status(500).json({
      message: 'Failed to record customer refund',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

// Helper function to update return refund status
async function updateReturnRefundStatus(tx: any, returnId: number, type: 'sale' | 'salex') {
  // Get total return refund amount and total allocated refunds
  let refundAmount = 0
  let totalAllocated = 0

  if (type === 'sale') {
    const returnRecord = await tx.sale_returns.findUnique({
      where: { id: returnId },
      select: { refund_amount: true }
    })
    refundAmount = returnRecord?.refund_amount || 0

    const allocations = await tx.customer_refund_allocations.findMany({
      where: { sale_return_id: returnId },
      select: { allocated_amount: true }
    })
    totalAllocated = allocations.reduce((sum: number, a: any) => sum + Number(a.allocated_amount), 0)
  } else {
    const returnRecord = await tx.salex_returns.findUnique({
      where: { id: returnId },
      select: { refund_amount: true }
    })
    refundAmount = returnRecord?.refund_amount || 0

    const allocations = await tx.customer_refund_allocations.findMany({
      where: { salex_return_id: returnId },
      select: { allocated_amount: true }
    })
    totalAllocated = allocations.reduce((sum: number, a: any) => sum + Number(a.allocated_amount), 0)
  }

  // Calculate refund status: 0=unpaid, 1=partial, 2=refunded
  const refundStatus = totalAllocated === 0 ? 0 :
    (totalAllocated >= refundAmount ? 1 : 2)  // Fixed: 1=Refunded, 2=Partial

  // Update the return
  if (type === 'sale') {
    await tx.sale_returns.update({
      where: { id: returnId },
      data: { payment_status: refundStatus }
    })
  } else {
    await tx.salex_returns.update({
      where: { id: returnId },
      data: { payment_status: refundStatus }
    })
  }
}

export default withObservability(handler)
