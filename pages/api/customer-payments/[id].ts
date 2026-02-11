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
      allocations // Array of { invoice_id?, invoicex_id?, allocated_amount, notes? }
    } = req.body

    // Validation
    if (!payment_amount || !allocations || allocations.length === 0) {
      return res.status(400).json({
        message: 'Payment amount and allocations are required'
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

      // Check if invoice exists and belongs to customer
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
            select_customer: true
          }
        })

        if (!invoice) {
          return res.status(400).json({
            message: `Invoice ${allocation.invoice_id} not found`
          })
        }

        if (invoice.select_customer !== existingPayment.customer_id) {
          return res.status(400).json({
            message: `Invoice ${allocation.invoice_id} does not belong to the payment's customer`
          })
        }

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
            select_customer: true
          }
        })

        if (!invoicex) {
          return res.status(400).json({
            message: `Invoicex ${allocation.invoicex_id} not found`
          })
        }

        if (invoicex.select_customer !== existingPayment.customer_id) {
          return res.status(400).json({
            message: `Invoicex ${allocation.invoicex_id} does not belong to the payment's customer`
          })
        }

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

    // Use database transaction for payment update and allocations
    const result = await prisma.$transaction(async (tx) => {
      // Update the payment record
      const payment = await tx.customer_payments.update({
        where: { id: parseInt(paymentId) },
        data: {
          payment_date: paymentDateTimestamp,
          payment_amount: parseFloat(payment_amount),
          payment_mode: parseInt(payment_mode) || existingPayment.payment_mode,
          payment_type: payment_type || existingPayment.payment_type,
          notes: notes || existingPayment.notes,
          fy: financialYear,
          updated_at: new Date()
        }
      })

      // Delete existing allocations
      await tx.customer_payment_allocations.deleteMany({
        where: { payment_id: parseInt(paymentId) }
      })

      // Create new allocation records
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
          await updateInvoicePaymentStatus(tx, allocation.invoice_id, 'sale')
        } else if (allocation.invoicex_id) {
          await updateInvoicePaymentStatus(tx, allocation.invoicex_id, 'salex')
        }
      }

      return payment
    })

    res.status(200).json({
      success: true,
      message: 'Customer payment updated successfully',
      data: {
        payment: {
          id: result.id,
          payment_no: `PAY-${String(result.id).padStart(3, '0')}`,
          payment_amount: result.payment_amount,
          total_allocated: totalAllocated,
          allocations_count: validatedAllocations.length,
          notes: result.notes
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
      include: { allocations: true }
    })

    if (!existingPayment) {
      return res.status(404).json({ message: 'Customer payment not found' })
    }

    // Use database transaction for payment deletion and status updates
    await prisma.$transaction(async (tx) => {
      // Get allocation details before deletion
      const allocations = await tx.customer_payment_allocations.findMany({
        where: { payment_id: parseInt(paymentId) }
      })

      // Delete allocations first
      await tx.customer_payment_allocations.deleteMany({
        where: { payment_id: parseInt(paymentId) }
      })

      // Delete the payment
      await tx.customer_payments.delete({
        where: { id: parseInt(paymentId) }
      })

      // Update payment status for affected invoices
      for (const allocation of allocations) {
        if (allocation.invoice_id) {
          await updateInvoicePaymentStatus(tx, allocation.invoice_id, 'sale')
        } else if (allocation.invoicex_id) {
          await updateInvoicePaymentStatus(tx, allocation.invoicex_id, 'salex')
        }
      }
    })

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
