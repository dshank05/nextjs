import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { convertDateToTimestamp } from '../../../lib/date-utils'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ message: 'Invalid payment ID' })
  }

  switch (req.method) {
    case 'GET':
      return handleGet(req, res, id)
    case 'PUT':
      return handlePut(req, res, id)
    case 'DELETE':
      return handleDelete(req, res, id)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse, paymentId: string) {
  try {
    const payment = await prisma.customer_payments.findUnique({
      where: { id: parseInt(paymentId) },
      include: {
        allocations: {
          include: {
            invoice: {
              select: { id: true, invoice_no: true }
            },
            invoicex: {
              select: { id: true, invoice_no: true }
            }
          }
        },
        customer: {
          select: { id: true, billing_name: true }
        }
      }
    })

    if (!payment) {
      return res.status(404).json({ message: 'Customer payment not found' })
    }

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
      invoice_no: allocation.invoice_id ? allocation.invoice?.invoice_no :
                 allocation.invoicex_id ? allocation.invoicex?.invoice_no : null,
      type: allocation.invoice_id ? 'sale' : 'salex'
    }))

    const enhancedPayment = {
      id: payment.id,
      customer_id: payment.customer_id,
      customer_name: payment.customer?.billing_name || 'Unknown Customer',
      payment_date: payment.payment_date,
      formattedDate: formattedDate,
      payment_amount: payment.payment_amount,
      payment_mode: payment.payment_mode,
      payment_type: payment.payment_type,
      notes: payment.notes,
      fy: payment.fy,
      allocations: enhancedAllocations,
      total_allocated: enhancedAllocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0),
      created_at: payment.created_at,
      updated_at: payment.updated_at
    }

    res.status(200).json({
      payment: enhancedPayment
    })
  } catch (error) {
    console.error('Customer payment fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch customer payment',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse, paymentId: string) {
  try {
    const {
      payment_date,
      payment_amount,
      payment_mode,
      payment_type,
      notes,
      allocations
    } = req.body

    // Validation
    if (!payment_amount) {
      return res.status(400).json({
        message: 'Payment amount is required'
      })
    }

    // Check if payment exists
    const existingPayment = await prisma.customer_payments.findUnique({
      where: { id: parseInt(paymentId) },
      include: { allocations: true }
    })

    if (!existingPayment) {
      return res.status(404).json({ message: 'Customer payment not found' })
    }

    // Get current financial year
    const currentDate = new Date()
    const currentYear = currentDate.getFullYear()
    const financialYear = currentDate.getMonth() >= 3 ? currentYear : currentYear - 1

    // Convert payment date to Unix timestamp
    const paymentDateTimestamp = payment_date ? convertDateToTimestamp(payment_date) : existingPayment.payment_date

    // Calculate old and new allocated amounts
    const oldAllocated = existingPayment.allocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0)
    const newAllocated = allocations ? allocations.reduce((sum: number, a: any) => sum + parseFloat(a.allocated_amount), 0) : oldAllocated

    // Use transaction handler for payment edit
    const operations = await require('../../../lib/customer-transaction-handler').customerTransactionHandler.handleCustomerPaymentEdit({
      paymentId: parseInt(paymentId),
      oldAmount: Number(existingPayment.payment_amount),
      newAmount: parseFloat(payment_amount),
      oldAllocated,
      newAllocated,
      customerId: existingPayment.customer_id,
      paymentMode: parseInt(payment_mode) || existingPayment.payment_mode,
      transactionDate: paymentDateTimestamp,
      fy: financialYear,
      notes: notes || existingPayment.notes,
      allocations: allocations || existingPayment.allocations.map(a => ({
        invoice_id: a.invoice_id,
        invoicex_id: a.invoicex_id,
        allocated_amount: Number(a.allocated_amount)
      }))
    });

    // Execute operations in transaction
    await prisma.$transaction(async (tx) => {
      await require('../../../lib/customer-transaction-handler').customerTransactionHandler.executeInTransaction(tx, operations);
    }, {
      timeout: 30000
    });

    // Fetch updated payment
    const updatedPayment = await prisma.customer_payments.findUnique({
      where: { id: parseInt(paymentId) },
      include: { allocations: true }
    });

    res.status(200).json({
      success: true,
      message: 'Customer payment updated successfully',
      data: {
        payment: {
          id: updatedPayment.id,
          payment_no: `PAY-${String(updatedPayment.id).padStart(3, '0')}`,
          payment_amount: updatedPayment.payment_amount,
          total_allocated: updatedPayment.allocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0),
          allocations_count: updatedPayment.allocations.length,
          notes: updatedPayment.notes
        }
      }
    })

  } catch (error) {
    console.error('Customer payment update error:', error)
    res.status(500).json({
      message: 'Failed to update customer payment',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, paymentId: string) {
  try {
    // Check if payment exists
    const existingPayment = await prisma.customer_payments.findUnique({
      where: { id: parseInt(paymentId) },
      select: {
        id: true,
        customer_id: true,
        payment_amount: true,
        fy: true,
        allocations: true
      }
    })

    if (!existingPayment) {
      return res.status(404).json({ message: 'Customer payment not found' })
    }

    // Calculate total allocated
    const totalAllocated = existingPayment.allocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0);

    // Use transaction handler for payment deletion
    const operations = await require('../../../lib/customer-transaction-handler').customerTransactionHandler.handlePaymentDelete({
      paymentId: parseInt(paymentId),
      customerId: existingPayment.customer_id,
      paymentAmount: Number(existingPayment.payment_amount),
      allocatedAmount: totalAllocated,
      fy: existingPayment.fy
    });

    // Execute operations in transaction
    await prisma.$transaction(async (tx) => {
      await require('../../../lib/customer-transaction-handler').customerTransactionHandler.executeDeleteInTransaction(tx, operations);
    }, {
      timeout: 30000
    });

    res.status(200).json({
      success: true,
      message: 'Customer payment deleted successfully'
    })

  } catch (error) {
    console.error('Customer payment deletion error:', error)
    res.status(500).json({
      message: 'Failed to delete customer payment',
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

  // Calculate payment status: 0=unpaid, 1=paid, 2=partial
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
