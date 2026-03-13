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
              select: { id: true, invoice_no: true, total: true, invoice_date: true, payment_status: true }
            },
            invoicex: {
              select: { id: true, invoice_no: true, total: true, invoice_date: true, payment_status: true }
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

    // Calculate total allocated
    const totalAllocated = payment.allocations.reduce(
      (sum, alloc) => sum + Number(alloc.allocated_amount),
      0
    )

    // Enhance allocations with invoice details (following vendor-payments pattern)
    const enhancedAllocations = payment.allocations.map(allocation => ({
      allocation_id: allocation.id,
      invoice_id: allocation.invoice_id,
      invoicex_id: allocation.invoicex_id,
      invoice_no: allocation.invoice_id ? allocation.invoice?.invoice_no :
                 allocation.invoicex_id ? allocation.invoicex?.invoice_no : null,
      invoice_date: allocation.invoice_id ? allocation.invoice?.invoice_date :
                   allocation.invoicex_id ? allocation.invoicex?.invoice_date : null,
      invoice_total: allocation.invoice_id ? Number(allocation.invoice?.total || 0) :
                    allocation.invoicex_id ? Number(allocation.invoicex?.total || 0) : 0,
      payment_status: allocation.invoice_id ? allocation.invoice?.payment_status :
                     allocation.invoicex_id ? allocation.invoicex?.payment_status : 0,
      allocated_amount: Number(allocation.allocated_amount),
      allocation_date: allocation.allocation_date,
      notes: allocation.notes,
      type: allocation.invoice_id ? 'sale' : 'salex'
    }))

    const enhancedPayment = {
      id: payment.id,
      customer: {
        id: payment.customer_id,
        name: payment.customer?.billing_name || 'Unknown Customer'
      },
      payment_date: payment.payment_date,
      formattedDate: formattedDate,
      payment_amount: Number(payment.payment_amount),
      payment_mode: payment.payment_mode,
      payment_type: payment.payment_type,
      notes: payment.notes,
      fy: payment.fy,
      allocations: enhancedAllocations,
      created_at: payment.created_at,
      updated_at: payment.updated_at,
      summary: {
        payment_amount: Number(payment.payment_amount),
        total_allocated: totalAllocated,
        allocation_count: payment.allocations.length,
        difference: Number(payment.payment_amount) - totalAllocated
      }
    }

    res.status(200).json({
      success: true,
      data: enhancedPayment
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

    // Validate required fields
    if (!payment_amount || !payment_date || payment_mode === undefined || !allocations) {
      return res.status(400).json({
        message: 'Missing required fields',
        required: ['payment_amount', 'payment_date', 'payment_mode', 'allocations']
      })
    }

    // ⚡ OPTIMIZATION: Fetch existing payment BEFORE transaction
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

    // ⚡ OPTIMIZATION: Prepare handler params OUTSIDE transaction
    const handlerParams = {
      paymentId: parseInt(paymentId),
      customerId: existingPayment.customer_id,
      oldAmount: Number(existingPayment.payment_amount),
      newAmount: Number(payment_amount),
      oldAllocations: existingPayment.allocations.map(a => ({
        invoice_id: a.invoice_id,
        invoicex_id: a.invoicex_id,
        allocated_amount: Number(a.allocated_amount)
      })),
      newAllocations: allocations.map((a: any) => ({
        invoice_id: a.invoice_id,
        invoicex_id: a.invoicex_id,
        allocated_amount: Number(a.allocated_amount)
      })),
      paymentMode: parseInt(payment_mode),
      paymentDate: paymentDateTimestamp,
      paymentType: payment_type,
      fy: financialYear
    }

    // Update payment in transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Calculate what needs to change using pre-fetched data
      console.log('[PAYMENT EDIT] Calling handleCustomerPaymentEdit with params:', {
        paymentId: handlerParams.paymentId,
        customerId: handlerParams.customerId,
        oldAmount: handlerParams.oldAmount,
        newAmount: handlerParams.newAmount,
        oldAllocationsCount: handlerParams.oldAllocations.length,
        newAllocationsCount: handlerParams.newAllocations.length
      })
      
      const handlerResult = await require('../../../lib/customer-transaction-handler').customerTransactionHandler.handleCustomerPaymentEdit(handlerParams)
      
      console.log('[PAYMENT EDIT] Handler result:', {
        ledgerOps: handlerResult.ledgerOps?.length || 0,
        ledgerCreates: handlerResult.ledgerCreates?.length || 0,
        ledgerUpdates: handlerResult.ledgerUpdates?.length || 0,
        ledgerDeletes: handlerResult.ledgerDeletes?.length || 0,
        balanceOp: handlerResult.balanceOp ? 'yes' : 'no',
        metadata: handlerResult.metadata
      })
      
      if (handlerResult.ledgerUpdates && handlerResult.ledgerUpdates.length > 0) {
        console.log('[PAYMENT EDIT] Ledger updates to execute:', JSON.stringify(handlerResult.ledgerUpdates, null, 2))
      }

      // 2. Update payment record
      console.log('[PAYMENT EDIT] Updating payment record...')
      const updatedPayment = await tx.customer_payments.update({
        where: { id: parseInt(paymentId) },
        data: {
          payment_amount: Number(payment_amount),
          payment_date: paymentDateTimestamp,
          payment_mode: parseInt(payment_mode),
          payment_type,
          notes: notes || null
        }
      })
      console.log('[PAYMENT EDIT] Payment record updated')

      // 3. If payment_date changed, sync all related ledger entries
      if (existingPayment.payment_date !== paymentDateTimestamp) {
        await tx.customer_ledger.updateMany({
          where: {
            transaction_id: parseInt(paymentId),
            transaction_type: 'PAYMENT_RECEIVED'
          },
          data: {
            transaction_date: paymentDateTimestamp,
            payment_date: paymentDateTimestamp
          }
        })
      }

      // 4. ⚡ OPTIMIZATION: Sequential allocation updates (delete then create)
      // Delete old allocations first
      await tx.customer_payment_allocations.deleteMany({
        where: { payment_id: parseInt(paymentId) }
      })
      
      // Create new allocations - using createMany for bulk insert
      await tx.customer_payment_allocations.createMany({
        data: allocations.map((alloc: any) => ({
          payment_id: parseInt(paymentId),
          invoice_id: alloc.invoice_id || null,
          invoicex_id: alloc.invoicex_id || null,
          allocated_amount: Number(alloc.allocated_amount),
          allocation_date: paymentDateTimestamp,
          notes: alloc.notes || null
        }))
      })

      // 5. ⚡ OPTIMIZATION: Recalculate invoice statuses in parallel
      if (handlerResult.metadata?.invoicesToUpdate && handlerResult.metadata.invoicesToUpdate.length > 0) {
        console.log('[PAYMENT EDIT] Recalculating invoice statuses for:', handlerResult.metadata.invoicesToUpdate)
        
        // Separate sale and salex invoices
        const saleInvoiceIds: number[] = []
        const salexInvoiceIds: number[] = []
        
        for (const invoiceId of handlerResult.metadata.invoicesToUpdate) {
          // Check if it's a sale or salex invoice
          const saleInvoice = await tx.invoice.findUnique({
            where: { id: invoiceId },
            select: { id: true }
          })
          
          if (saleInvoice) {
            saleInvoiceIds.push(invoiceId)
          } else {
            salexInvoiceIds.push(invoiceId)
          }
        }
        
        // Update payment statuses
        await Promise.all([
          ...saleInvoiceIds.map(id => updateInvoicePaymentStatus(tx, id, 'sale')),
          ...salexInvoiceIds.map(id => updateInvoicePaymentStatus(tx, id, 'salex'))
        ])
        
        console.log('[PAYMENT EDIT] Invoice statuses recalculated')
      }

      // 6. ✅ Execute ledger operations (UPDATE existing or CREATE new)
      if (handlerResult.ledgerUpdates && handlerResult.ledgerUpdates.length > 0) {
        console.log('[PAYMENT EDIT] Executing ledger UPDATES:', handlerResult.ledgerUpdates.length)
        for (const update of handlerResult.ledgerUpdates) {
          console.log(`[LEDGER UPDATE] ${update.description}`, update.where)
          
          // Get entries before update for balance recalculation
          const entries = await tx.customer_ledger.findMany({
            where: update.where,
            select: { id: true, customer_id: true }
          })
          
          if (entries.length === 0) {
            console.warn(`[LEDGER UPDATE] No entries found for update:`, update.where)
            continue
          }
          
          console.log(`[LEDGER UPDATE] Found ${entries.length} entries to update`)
          
          // Execute UPDATE
          await tx.customer_ledger.updateMany({
            where: update.where,
            data: update.data
          })
          
          console.log(`[LEDGER UPDATE] Updated entries, now recalculating balances...`)
          
          // Recalculate balances after update
          const firstEntry = entries[0]
          await require('../../../lib/customer-ledger-service').customerLedgerService.recalculateBalancesAfter(
            firstEntry.customer_id,
            firstEntry.id,
            tx
          )
          
          console.log(`[LEDGER UPDATE] ✅ Successfully updated ${entries.length} entries and recalculated balances`)
        }
      } else if (handlerResult.ledgerOps && handlerResult.ledgerOps.length > 0) {
        // Fallback: CREATE new entries (shouldn't happen for payment edits, but kept for safety)
        console.log('[PAYMENT EDIT] Creating NEW ledger entries:', handlerResult.ledgerOps.length)
        for (const ledgerOp of handlerResult.ledgerOps) {
          await require('../../../lib/customer-ledger-service').customerLedgerService.createEntry(ledgerOp.entry, tx)
        }
        console.log('[PAYMENT EDIT] Ledger entries created')
      } else {
        console.log('[PAYMENT EDIT] No ledger operations to execute')
      }

      // 7. Update customer balance
      console.log('[PAYMENT EDIT] Updating customer balance...')
      const amountDiff = handlerResult.metadata?.amountDiff || 0
      const allocDiff = handlerResult.metadata?.allocDiff || 0

      console.log('[PAYMENT EDIT] Balance update:', { amountDiff, allocDiff })

      if (amountDiff !== 0 || allocDiff !== 0) {
        await require('../../../lib/customer-balance-handler').customerBalanceHandler.incrementBalanceInTransaction(
          tx,
          existingPayment.customer_id,
          {
            total_paid: amountDiff,
            total_allocated: allocDiff
          },
          {
            type: 'payment_received_edit',
            id: parseInt(paymentId),
            reference_no: `PAY-${paymentId}`,
            notes: `Payment edited: amount ${amountDiff !== 0 ? `₹${amountDiff > 0 ? '+' : ''}${amountDiff.toFixed(2)}` : 'unchanged'}, allocation ${allocDiff !== 0 ? `₹${allocDiff > 0 ? '+' : ''}${allocDiff.toFixed(2)}` : 'unchanged'}`
          }
        )
        console.log('[PAYMENT EDIT] Customer balance updated')
      } else {
        console.log('[PAYMENT EDIT] No balance update needed')
      }

      console.log('[PAYMENT EDIT] ✅ Transaction complete')

      return {
        payment: updatedPayment,
        allocations: allocations
      }
    }, {
      timeout: 30000
    })

    res.status(200).json({
      success: true,
      message: 'Customer payment updated successfully',
      data: result
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
