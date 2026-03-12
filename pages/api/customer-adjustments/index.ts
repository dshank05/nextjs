import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { convertDateToTimestamp } from '../../../lib/date-utils'
import { parseDateRange } from '../../../lib/date-utils'

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
      type = '', // SALE_ADJUSTMENT, RECEIPT_ADJUSTMENT, RECEIPT_REVERSAL, REFUND_PAID
      dateFrom = '',
      dateTo = '',
      fy = '',
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause for customer_ledger table
    const where: any = {}

    // Filter by adjustment types
    const adjustmentTypes = ['SALE_ADJUSTMENT', 'RECEIPT_ADJUSTMENT', 'RECEIPT_REVERSAL', 'REFUND_PAID']
    if (type && adjustmentTypes.includes(type as string)) {
      where.transaction_type = type
    } else {
      // Default to all adjustment types
      where.transaction_type = { in: adjustmentTypes }
    }

    // Search filter
    if (search) {
      const searchStr = Array.isArray(search) ? search[0] : search;
      where.OR = [
        { reference_no: { contains: searchStr } },
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
        const { startTimestamp, endTimestamp } = parseDateRange(
          dateFrom as string,
          dateTo as string
        );

        where.transaction_date = {
          gte: startTimestamp,
          lte: endTimestamp
        };
      } catch (error) {
        console.warn('Error parsing filter dates:', error);
      }
    }

    // Validate and set sort parameters
    const validSortFields = ['id', 'transaction_date', 'transaction_type', 'debit', 'credit', 'created_at']
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'created_at'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    let adjustments: any[] = []
    let total: number = 0

    // Get adjustments from customer_ledger table
    const result = await Promise.all([
      prisma.customer_ledger.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { [sortField]: sortDirection },
        select: {
          id: true,
          customer_id: true,
          transaction_date: true,
          transaction_type: true,
          reference_type: true,
          reference_id: true,
          reference_no: true,
          debit: true,
          credit: true,
          balance: true,
          notes: true,
          fy: true,
          created_at: true
        }
      }),
      prisma.customer_ledger.count({ where })
    ])
    adjustments = result[0]
    total = result[1]

    // Get customer names in batch
    const customerIds = Array.from(new Set(adjustments.map(a => a.customer_id).filter(Boolean)))
    const customerData = customerIds.length > 0 ? await prisma.customer_details.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, billing_name: true }
    }) : []

    const customerMap = new Map(customerData.map(c => [c.id, c.billing_name]))

    // Enhanced adjustments with customer info
    const enhancedAdjustments = adjustments.map((adjustment) => {
      // Format date
      let formattedDate: string | null = null
      try {
        if (adjustment.transaction_date) {
          const dateObj = new Date(adjustment.transaction_date * 1000)
          if (!isNaN(dateObj.getTime())) {
            formattedDate = dateObj.toLocaleDateString('en-IN')
          }
        }
      } catch (error) {
        console.warn('Invalid date format for adjustment:', adjustment.transaction_date, error)
      }

      return {
        id: adjustment.id,
        customer_id: adjustment.customer_id,
        customer_name: customerMap.get(adjustment.customer_id) || 'Unknown Customer',
        transaction_date: adjustment.transaction_date,
        formattedDate: formattedDate,
        transaction_type: adjustment.transaction_type,
        reference_type: adjustment.reference_type,
        reference_id: adjustment.reference_id,
        reference_no: adjustment.reference_no,
        amount: adjustment.debit > 0 ? adjustment.debit : adjustment.credit,
        adjustment_type: adjustment.debit > 0 ? 'increase' : 'decrease',
        debit: adjustment.debit,
        credit: adjustment.credit,
        balance: adjustment.balance,
        notes: adjustment.notes,
        fy: adjustment.fy,
        created_at: adjustment.created_at
      }
    })

    // Apply customer filter (after data enhancement)
    if (customer && customer !== '') {
      const customerStr = Array.isArray(customer) ? customer[0] : customer;
      const customerNum = parseInt(customerStr);

      if (!isNaN(customerNum)) {
        enhancedAdjustments.filter(a => a.customer_id === customerNum);
      } else {
        enhancedAdjustments.filter(a =>
          a.customer_name.toLowerCase().includes(customerStr.toLowerCase())
        );
      }
    }

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      adjustments: enhancedAdjustments,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    console.error('Customer adjustments fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch customer adjustments data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      adjustment_type, // 'SALE_ADJUSTMENT', 'RECEIPT_ADJUSTMENT', 'RECEIPT_REVERSAL', 'REFUND_PAID'
      customer_id,
      reference_id, // invoice_id for sale adjustments, receipt_id for others
      adjustment_amount,
      adjustment_date,
      payment_mode, // For refunds/reversals
      notes
    } = req.body

    // Validation
    if (!adjustment_type || !customer_id || adjustment_amount === undefined) {
      return res.status(400).json({
        message: 'Adjustment type, customer ID, and adjustment amount are required'
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

    // Convert adjustment date to Unix timestamp
    const adjustmentDateTimestamp = adjustment_date ? convertDateToTimestamp(adjustment_date) : Math.floor(Date.now() / 1000)

    // Validate adjustment type
    const validAdjustmentTypes = ['SALE_ADJUSTMENT', 'RECEIPT_ADJUSTMENT', 'RECEIPT_REVERSAL', 'REFUND_PAID']
    if (!validAdjustmentTypes.includes(adjustment_type)) {
      return res.status(400).json({
        message: 'Invalid adjustment type. Must be SALE_ADJUSTMENT, RECEIPT_ADJUSTMENT, RECEIPT_REVERSAL, or REFUND_PAID'
      })
    }

    // Validate reference_id for types that require it
    if (['SALE_ADJUSTMENT', 'RECEIPT_ADJUSTMENT', 'RECEIPT_REVERSAL'].includes(adjustment_type) && !reference_id) {
      return res.status(400).json({
        message: `Reference ID is required for ${adjustment_type}`
      })
    }

    // For SALE_ADJUSTMENT, validate invoice exists and belongs to customer
    if (adjustment_type === 'SALE_ADJUSTMENT') {
      const invoice = await prisma.invoice.findUnique({
        where: { id: parseInt(reference_id) },
        select: { id: true, invoice_no: true, select_customer: true }
      })

      if (!invoice) {
        return res.status(400).json({
          message: `Invoice ${reference_id} not found`
        })
      }

      if (invoice.select_customer !== parseInt(customer_id)) {
        return res.status(400).json({
          message: `Invoice ${reference_id} does not belong to selected customer`
        })
      }
    }

    // For REFUND_PAID, validate payment_mode
    if (adjustment_type === 'REFUND_PAID' && payment_mode === undefined) {
      return res.status(400).json({
        message: 'Payment mode is required for refunds'
      })
    }

    // ✅ Use database transaction for adjustment creation
    const result = await prisma.$transaction(async (tx) => {
      // Determine debit/credit based on adjustment type and amount
      let debit = 0
      let credit = 0
      let balanceUpdate: any = {}
      let referenceType = 'adjustment'
      let referenceNo = ''

      const parsedAmount = Math.abs(parseFloat(adjustment_amount))

      switch (adjustment_type) {
        case 'SALE_ADJUSTMENT':
          // Sale adjustment increases customer balance (they owe more)
          debit = parsedAmount
          credit = 0
          balanceUpdate = { total_allocated: parsedAmount }
          referenceType = 'invoice'
          referenceNo = reference_id ? `INV-${reference_id}` : 'ADJ'
          break

        case 'RECEIPT_ADJUSTMENT':
          // Receipt adjustment (correction) - can increase or decrease
          if (adjustment_amount > 0) {
            // Increase payment received
            debit = 0
            credit = parsedAmount
            balanceUpdate = { total_paid: parsedAmount, total_allocated: parsedAmount }
          } else {
            // Decrease payment received
            debit = parsedAmount
            credit = 0
            balanceUpdate = { total_paid: -parsedAmount, total_allocated: -parsedAmount }
          }
          referenceType = 'payment'
          referenceNo = reference_id ? `PAY-${reference_id}` : 'ADJ'
          break

        case 'RECEIPT_REVERSAL':
          // Receipt reversal - reverse a payment (increase balance owed)
          debit = parsedAmount
          credit = 0
          balanceUpdate = { total_paid: -parsedAmount, total_allocated: -parsedAmount }
          referenceType = 'payment'
          referenceNo = reference_id ? `PAY-${reference_id}` : 'REV'
          break

        case 'REFUND_PAID':
          // Refund paid - decrease balance (customer owes less)
          debit = parsedAmount
          credit = 0
          balanceUpdate = { total_refunded: parsedAmount }
          referenceType = 'refund'
          referenceNo = 'REF-ADJ'
          break
      }

      // Create ledger entry inside transaction
      const ledgerEntry = await require('../../../lib/customer-ledger-service').customerLedgerService.createEntry({
        customer_id: parseInt(customer_id),
        transaction_date: adjustmentDateTimestamp,
        transaction_type: adjustment_type,
        reference_type: referenceType,
        reference_id: reference_id ? parseInt(reference_id) : null,
        reference_no: referenceNo,
        debit: debit,
        credit: credit,
        payment_mode: payment_mode !== undefined ? parseInt(payment_mode) : null,
        payment_status: null,
        payment_date: adjustment_type === 'REFUND_PAID' ? adjustmentDateTimestamp : null,
        notes: notes || `${adjustment_type} adjustment`,
        fy: financialYear
      }, tx)

      // Update customer balance using handler (with logging) inside transaction
      await require('../../../lib/customer-balance-handler').customerBalanceHandler.incrementBalanceInTransaction(
        tx,
        parseInt(customer_id),
        balanceUpdate,
        {
          type: 'adjustment_create',
          id: ledgerEntry.id,
          reference_no: referenceNo,
          notes: notes || `${adjustment_type}: ₹${parsedAmount}`
        }
      )

      return ledgerEntry
    }, {
      timeout: 30000
    })

    res.status(201).json({
      success: true,
      message: 'Customer adjustment recorded successfully',
      data: {
        adjustment: {
          id: result.id,
          adjustment_type: adjustment_type,
          customer_name: customer.billing_name,
          amount: Math.abs(parseFloat(adjustment_amount)),
          debit: result.debit,
          credit: result.credit,
          notes: result.notes
        }
      }
    })

  } catch (error) {
    console.error('Customer adjustment creation error:', error)
    res.status(500).json({
      message: 'Failed to record customer adjustment',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
