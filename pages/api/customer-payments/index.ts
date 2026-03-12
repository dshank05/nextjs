import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { convertDateToTimestamp } from '../../../lib/date-utils'
import { recordReceiptTransaction } from '../../../lib/customer-ledger-service'
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
    if (!customer_id || !payment_amount || !allocations || allocations.length === 0) {
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

    // Get current financial year
    const currentDate = new Date()
    const currentYear = currentDate.getFullYear()
    const financialYear = currentDate.getMonth() >= 3 ? currentYear : currentYear - 1

    // Convert payment date to Unix timestamp
    const paymentDateTimestamp = payment_date ? convertDateToTimestamp(payment_date) : Math.floor(Date.now() / 1000)

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

      // Check if invoice exists and get outstanding amount
      let outstandingAmount = 0
      let invoiceType = ''
      let invoiceNo = ''

      if (allocation.invoice_id) {
        const invoice = await prisma.invoice.findUnique({
          where: { id: parseInt(allocation.invoice_id) },
          select: {
            id: true,
            invoice_no: true,
            total: true,
            payment_status: true,
            select_customer: true
          }
        })

        if (!invoice) {
          return res.status(400).json({
            message: `Invoice ${allocation.invoice_id} not found`
          })
        }

        if (invoice.select_customer !== parseInt(customer_id)) {
          return res.status(400).json({
            message: `Invoice ${allocation.invoice_id} does not belong to selected customer`
          })
        }

        // Calculate outstanding amount (simplified - would need payment allocation logic)
        outstandingAmount = invoice.total || 0
        invoiceType = 'sale'
        invoiceNo = invoice.invoice_no.toString()
      } else if (allocation.invoicex_id) {
        const invoicex = await prisma.invoicex.findUnique({
          where: { id: parseInt(allocation.invoicex_id) },
          select: {
            id: true,
            invoice_no: true,
            total: true,
            payment_status: true,
            select_customer: true
          }
        })

        if (!invoicex) {
          return res.status(400).json({
            message: `Invoicex ${allocation.invoicex_id} not found`
          })
        }

        if (invoicex.select_customer !== parseInt(customer_id)) {
          return res.status(400).json({
            message: `Invoicex ${allocation.invoicex_id} does not belong to selected customer`
          })
        }

        // Calculate outstanding amount (simplified - would need payment allocation logic)
        outstandingAmount = invoicex.total || 0
        invoiceType = 'salex'
        invoiceNo = invoicex.invoice_no.toString()
      } else {
        return res.status(400).json({
          message: 'Each allocation must specify either invoice_id or invoicex_id'
        })
      }

      if (allocatedAmount > outstandingAmount) {
        return res.status(400).json({
          message: `Allocation amount ₹${allocatedAmount} exceeds outstanding amount ₹${outstandingAmount} for ${invoiceType} invoice ${invoiceNo}`
        })
      }

      totalAllocated += allocatedAmount
      validatedAllocations.push({
        invoice_id: allocation.invoice_id ? parseInt(allocation.invoice_id) : null,
        invoicex_id: allocation.invoicex_id ? parseInt(allocation.invoicex_id) : null,
        allocated_amount: allocatedAmount,
        allocation_date: paymentDateTimestamp,
        notes: allocation.notes || ''
      })
    }

    if (totalAllocated > parseFloat(payment_amount)) {
      return res.status(400).json({
        message: `Total allocated amount ₹${totalAllocated} exceeds payment amount ₹${payment_amount}`
      })
    }

    // Use database transaction for payment creation and allocations
    const result = await prisma.$transaction(async (tx) => {
      // Create the payment record
      const payment = await tx.customer_payments.create({
        data: {
          customer_id: parseInt(customer_id),
          payment_date: paymentDateTimestamp,
          payment_amount: parseFloat(payment_amount),
          payment_mode: parseInt(payment_mode) || 1,
          payment_type: payment_type,
          notes: notes || '',
          fy: financialYear
        }
      })

      // Create allocation records
      for (const allocation of validatedAllocations) {
        await tx.customer_payment_allocations.create({
          data: {
            payment_id: payment.id,
            invoice_id: allocation.invoice_id,
            invoicex_id: allocation.invoicex_id,
            allocated_amount: allocation.allocated_amount,
            allocation_date: allocation.allocation_date,
            notes: allocation.notes
          }
        })
      }

      // Update payment status for allocated invoices
      for (const allocation of validatedAllocations) {
        if (allocation.invoice_id) {
          // Update sale invoice payment status
          await updateInvoicePaymentStatus(tx, allocation.invoice_id, 'sale')
        } else if (allocation.invoicex_id) {
          // Update salex invoice payment status
          await updateInvoicePaymentStatus(tx, allocation.invoicex_id, 'salex')
        }
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
        credit: parseFloat(payment_amount),
        payment_mode: parseInt(payment_mode) || 1,
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
          total_paid: parseFloat(payment_amount),
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
    })

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
          allocations_count: validatedAllocations.length,
          notes: result.notes
        }
      }
    })

  } catch (error) {
    console.error('Customer payment creation error:', error)
    res.status(500).json({
      message: 'Failed to record customer payment',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

// Helper function to update invoice payment status
async function updateInvoicePaymentStatus(tx: any, invoiceId: number, type: 'sale' | 'salex') {
  // Get total invoice amount and total allocated payments
  let invoiceTotal = 0
  let totalAllocated = 0

  if (type === 'sale') {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { total: true }
    })
    invoiceTotal = invoice?.total || 0

    const allocations = await tx.customer_payment_allocations.findMany({
      where: { invoice_id: invoiceId },
      select: { allocated_amount: true }
    })
    totalAllocated = allocations.reduce((sum: number, a: any) => sum + Number(a.allocated_amount), 0)
  } else {
    const invoicex = await tx.invoicex.findUnique({
      where: { id: invoiceId },
      select: { total: true }
    })
    invoiceTotal = invoicex?.total || 0

    const allocations = await tx.customer_payment_allocations.findMany({
      where: { invoicex_id: invoiceId },
      select: { allocated_amount: true }
    })
    totalAllocated = allocations.reduce((sum: number, a: any) => sum + Number(a.allocated_amount), 0)
  }

  // Calculate payment status: 0=unpaid, 1=partial, 2=paid
  const paymentStatus = totalAllocated === 0 ? 0 :
    (totalAllocated >= invoiceTotal ? 1 : 2)  // Fixed: 1=Paid, 2=Partial

  // Update the invoice
  if (type === 'sale') {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { payment_status: paymentStatus }
    })
  } else {
    await tx.invoicex.update({
      where: { id: invoiceId },
      data: { payment_status: paymentStatus }
    })
  }
}

export default withObservability(handler)
