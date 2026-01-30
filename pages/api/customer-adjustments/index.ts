import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import {
  recordReceiptReversalTransaction,
  recordSaleAdjustmentTransaction,
  recordReceiptAdjustmentTransaction,
  recordRefundPaidTransaction
} from '../../../lib/customer-ledger-service'
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
    const adjustmentDateTimestamp = adjustment_date ? Math.floor(new Date(adjustment_date).getTime() / 1000) : Math.floor(Date.now() / 1000)

    // Generate adjustment reference number
    const adjustmentId = Date.now() // Simple ID generation
    const adjustmentNo = `ADJ-${String(adjustmentId).slice(-6)}`

    // Process different adjustment types
    switch (adjustment_type) {
      case 'SALE_ADJUSTMENT':
        if (!reference_id) {
          return res.status(400).json({
            message: 'Invoice ID is required for sale adjustments'
          })
        }

        // Validate invoice exists and belongs to customer
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

        await recordSaleAdjustmentTransaction(
          parseInt(customer_id),
          invoice.id,
          invoice.invoice_no.toString(),
          parseFloat(adjustment_amount),
          adjustmentDateTimestamp,
          financialYear,
          notes
        )
        break

      case 'RECEIPT_ADJUSTMENT':
        if (!reference_id) {
          return res.status(400).json({
            message: 'Original receipt ID is required for receipt adjustments'
          })
        }

        await recordReceiptAdjustmentTransaction(
          parseInt(customer_id),
          parseInt(reference_id),
          adjustmentId,
          adjustmentNo,
          parseFloat(adjustment_amount),
          adjustmentDateTimestamp,
          financialYear,
          notes
        )
        break

      case 'RECEIPT_REVERSAL':
        if (!reference_id) {
          return res.status(400).json({
            message: 'Original receipt ID is required for receipt reversals'
          })
        }

        await recordReceiptReversalTransaction(
          parseInt(customer_id),
          parseInt(reference_id),
          adjustmentId,
          adjustmentNo,
          Math.abs(parseFloat(adjustment_amount)), // Always positive for reversals
          adjustmentDateTimestamp,
          financialYear,
          notes
        )
        break

      case 'REFUND_PAID':
        if (!payment_mode) {
          return res.status(400).json({
            message: 'Payment mode is required for refunds'
          })
        }

        await recordRefundPaidTransaction(
          parseInt(customer_id),
          adjustmentId,
          adjustmentNo,
          Math.abs(parseFloat(adjustment_amount)), // Always positive for refunds
          adjustmentDateTimestamp,
          parseInt(payment_mode),
          financialYear,
          notes
        )
        break

      default:
        return res.status(400).json({
          message: 'Invalid adjustment type. Must be SALE_ADJUSTMENT, RECEIPT_ADJUSTMENT, RECEIPT_REVERSAL, or REFUND_PAID'
        })
    }

    res.status(201).json({
      success: true,
      message: 'Customer adjustment recorded successfully',
      data: {
        adjustment: {
          id: adjustmentId,
          adjustment_no: adjustmentNo,
          adjustment_type: adjustment_type,
          customer_name: customer.billing_name,
          amount: Math.abs(parseFloat(adjustment_amount)),
          adjustment_type_desc: adjustment_amount > 0 ? 'increase' : 'decrease',
          notes: notes
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
