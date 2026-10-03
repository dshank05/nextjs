import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { convertDateToTimestamp } from '../../../lib/date-utils'
import { parseDateRange } from '../../../lib/date-utils'
import { getCurrentFinancialYear } from '../../../lib/financial-year'
import { checkPaymentAllocations, allocationRow } from '../../../lib/payment-allocations'
import { recalculateSaleStatus } from '../../../lib/payment-allocation-service'
import { answerError } from '../../../lib/api/sale-routes'

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
      sortBy = 'payment_date',
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
        const { startTimestamp, endTimestamp } = parseDateRange(
          dateFrom as string,
          dateTo as string
        );

        where.payment_date = {
          gte: startTimestamp,
          lte: endTimestamp
        };
      } catch (error) {
        console.warn('Error parsing filter dates:', error);
      }
    }

    // Validate and set sort parameters
    const validSortFields = ['id', 'payment_date', 'payment_amount', 'payment_mode', 'fy']
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'payment_date'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    let payments: any[] = []
    let total: number = 0

    // Get payments with database-level sorting
    const result = await Promise.all([
      prisma.customer_payments.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { [sortField]: sortDirection },
        select: {
          id: true,
          customer_id: true,
          payment_date: true,
          payment_amount: true,
          payment_mode: true,
          payment_type: true,
          notes: true,
          fy: true,
          created_at: true,
          allocations: {
            select: {
              id: true,
              invoice_id: true,
              invoicex_id: true,
              allocated_amount: true,
              allocation_date: true,
              notes: true
            }
          }
        }
      }),
      prisma.customer_payments.count({ where })
    ])
    payments = result[0]
    total = result[1]

    // Get customer names and invoice details in batch queries
    const customerIds = Array.from(new Set(payments.map(p => p.customer_id).filter(Boolean)))
    const invoiceIds = Array.from(new Set(payments.flatMap(p => p.allocations.map(a => a.invoice_id)).filter(Boolean)))
    const invoicexIds = Array.from(new Set(payments.flatMap(p => p.allocations.map(a => a.invoicex_id)).filter(Boolean)))

    const [customerData, invoiceData, invoicexData] = await Promise.all([
      customerIds.length > 0 ? prisma.customer_details.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, billing_name: true }
      }) : Promise.resolve([]),

      invoiceIds.length > 0 ? prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: { id: true, invoice_no: true }
      }) : Promise.resolve([]),

      invoicexIds.length > 0 ? prisma.invoicex.findMany({
        where: { id: { in: invoicexIds } },
        select: { id: true, invoice_no: true }
      }) : Promise.resolve([])
    ])

    // Create lookup maps
    const customerMap = new Map(customerData.map(c => [c.id, c.billing_name]))
    const invoiceMap = new Map(invoiceData.map(i => [i.id, i.invoice_no]))
    const invoicexMap = new Map(invoicexData.map(i => [i.id, i.invoice_no]))

    // Enhanced payments with customer and invoice info
    const enhancedPayments = payments.map((payment) => {
      // Format date
      let formattedDate: string | null = null
      try {
        if (payment.payment_date) {
          const dateObj = new Date(payment.payment_date * 1000)
          if (!isNaN(dateObj.getTime())) {
            formattedDate = dateObj.toLocaleDateString('en-IN')
          }
        }
      } catch (error) {
        console.warn('Invalid date format for payment:', payment.payment_date, error)
      }

      // Enhance allocations with invoice details
      const enhancedAllocations = payment.allocations.map(allocation => ({
        ...allocation,
        invoice_no: allocation.invoice_id ? invoiceMap.get(allocation.invoice_id) :
          allocation.invoicex_id ? invoicexMap.get(allocation.invoicex_id) : null,
        type: allocation.invoice_id ? 'sale' : 'salex'
      }))

      return {
        id: payment.id,
        customer_id: payment.customer_id,
        customer_name: customerMap.get(payment.customer_id) || 'Unknown Customer',
        payment_date: payment.payment_date,
        formattedDate: formattedDate,
        payment_amount: payment.payment_amount,
        payment_mode: payment.payment_mode,
        payment_type: payment.payment_type,
        notes: payment.notes,
        fy: payment.fy,
        allocations: enhancedAllocations,
        total_allocated: enhancedAllocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0),
        created_at: payment.created_at
      }
    })

    // Apply customer filter (after data enhancement)
    if (customer && customer !== '') {
      const customerStr = Array.isArray(customer) ? customer[0] : customer;
      const customerNum = parseInt(customerStr);

      if (!isNaN(customerNum)) {
        // Filter by customer ID
        enhancedPayments.filter(p => p.customer_id === customerNum);
      } else {
        // Filter by customer name
        enhancedPayments.filter(p =>
          p.customer_name.toLowerCase().includes(customerStr.toLowerCase())
        );
      }
    }

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      payments: enhancedPayments,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    console.error('Customer payments fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch customer payments data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      customer_id,
      payment_date,
      payment_amount,
      payment_mode,
      payment_type = 'RECEIPT',
      notes,
      allocations // Array of { invoice_id?, invoicex_id?, allocated_amount, notes? }
    } = req.body

    // Validation
    if (!customer_id || !payment_amount || !allocations) {
      return res.status(400).json({
        message: 'Customer ID, payment amount, and allocations are required'
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

    // F-01: financial year comes from Settings, never from the calendar.
    const financialYear = await getCurrentFinancialYear()

    // Convert payment date to Unix timestamp
    const paymentDateTimestamp = payment_date ? convertDateToTimestamp(payment_date) : Math.floor(Date.now() / 1000)

    // Allocations checked against what is left on each bill (other payments
    // counted), the bill's owner and kind; the type follows from them.
    const checked = await checkPaymentAllocations(prisma, 'customer', customer.id, payment_amount, allocations, { requestedType: payment_type })
    const totalAllocated = checked.allocated
    const amount = checked.amount

    // Use database transaction for payment creation and allocations
    const result = await prisma.$transaction(async (tx) => {
      // Create the payment record
      const payment = await tx.customer_payments.create({
        data: {
          customer_id: parseInt(customer_id),
          payment_date: paymentDateTimestamp,
          payment_amount: amount,
          payment_mode: Number.isInteger(parseInt(payment_mode)) ? parseInt(payment_mode) : 1,
          payment_type: checked.paymentType,
          notes: notes || '',
          fy: financialYear
        }
      })

      if (checked.allocations.length > 0) {
        await tx.customer_payment_allocations.createMany({
          data: checked.allocations.map(a => allocationRow(payment.id, a, paymentDateTimestamp))
        })
      }

      // Each bill's payment status, by kind and id
      for (const a of checked.allocations) {
        await recalculateSaleStatus(a.kind as 'sale' | 'salex', a.id, tx)
      }

      // Create customer ledger entry for receipt (inside transaction)
      await require('../../../lib/customer-ledger-service').customerLedgerService.createEntry({
        customer_id: parseInt(customer_id),
        transaction_date: paymentDateTimestamp,
        transaction_type: 'PAYMENT_RECEIVED',
        reference_type: 'payment',
        reference_id: payment.id,
        reference_no: `PAY-${String(payment.id).padStart(3, '0')}`,
        debit: 0,
        credit: amount,
        payment_mode: Number.isInteger(parseInt(payment_mode)) ? parseInt(payment_mode) : 1, // 0 is cash: `|| 1` made it bank
        payment_status: 1,
        payment_date: paymentDateTimestamp,
        notes: notes || `Customer payment receipt`,
        fy: financialYear,
        transaction_id: payment.id
      }, tx);

      // Update customer balance using handler (with logging)
      await require('../../../lib/customer-balance-handler').customerBalanceHandler.incrementBalanceInTransaction(
        tx,
        parseInt(customer_id),
        {
          total_paid: amount,
          total_allocated: totalAllocated
        },
        {
          type: 'payment_received_create',
          id: payment.id,
          reference_no: `PAY-${String(payment.id).padStart(3, '0')}`,
          notes: notes || `Customer payment receipt`
        }
      );

      return payment
    }, { timeout: 30000 })

    res.status(201).json({
      success: true,
      message: 'Customer payment recorded successfully',
      data: {
        payment: {
          id: result.id,
          payment_no: `PAY-${String(result.id).padStart(3, '0')}`,
          customer_name: customer.billing_name,
          payment_amount: result.payment_amount,
          payment_mode: result.payment_mode,
          total_allocated: totalAllocated,
          allocations_count: checked.allocations.length,
          payment_type: checked.paymentType,
          notes: result.notes
        }
      }
    })

  } catch (error) {
    return answerError(res, error, 'record the customer payment')
  }
}

export default withObservability(handler)
