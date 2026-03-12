import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { customerLedgerService } from '../../../lib/customer-ledger-service'
import { customerBalanceHandler } from '../../../lib/customer-balance-handler'
import { convertDateToTimestamp } from '../../../lib/date-utils'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case 'POST':
      return handlePost(req, res)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      customer_id,
      invoice_id,
      invoicex_id,
      return_type,
      return_date,
      return_notes,
      payment_status, // 0=Incomplete, 1=Complete (like purchase returns)
      payment_mode,
      items
    } = req.body

    // Validation
    if (!customer_id) {
      return res.status(400).json({ message: 'Customer ID is required' })
    }

    if (return_type === 'full' || return_type === 'partial') {
      if (!invoice_id && !invoicex_id) {
        return res.status(400).json({ message: 'Invoice ID required for full/partial returns' })
      }
    } else {
      if (!items || items.length === 0) {
        return res.status(400).json({ message: 'Items required for custom returns' })
      }
    }

    // Get financial year
    const currentDate = new Date()
    const currentYear = currentDate.getFullYear()
    const financialYear = currentDate.getMonth() >= 3 ? currentYear : currentYear - 1

    // Convert dates
    const returnDateTimestamp = return_date ? convertDateToTimestamp(return_date) : Math.floor(Date.now() / 1000)
    const paymentStatusValue = payment_status !== undefined ? parseInt(payment_status.toString()) : 0
    const paymentModeValue = payment_mode !== undefined ? parseInt(payment_mode.toString()) : 1
    const paymentDateValue = paymentStatusValue === 1 ? returnDateTimestamp : null

    // Determine invoice type and prepare items
    let invoiceIdForReturn: number | null = null
    let invoicexIdForReturn: number | null = null
    let invoiceReturnItems: any[] = []
    let invoicexReturnItems: any[] = []

    if (invoice_id) {
      invoiceIdForReturn = parseInt(invoice_id)
      
      if (return_type === 'full' && (!items || items.length === 0)) {
        const allItems = await prisma.invoiceitems.findMany({
          where: { invoice_no: invoiceIdForReturn },
          select: { id: true, qty: true, rate: true, gst_percentage: true }
        })
        invoiceReturnItems = allItems.map(item => ({
          sale_item_id: item.id,
          return_qty: item.qty,
          return_reason_id: 1,
          unit_price: item.rate,
          tax_rate: item.gst_percentage || 0,
          notes: 'Full order return'
        }))
      } else {
        invoiceReturnItems = items || []
      }
    } else if (invoicex_id) {
      invoicexIdForReturn = parseInt(invoicex_id)
      
      if (return_type === 'full' && (!items || items.length === 0)) {
        const allItems = await prisma.invoice_itemsx.findMany({
          where: { invoice_no: invoicexIdForReturn },
          select: { id: true, qty: true, rate: true }
        })
        invoicexReturnItems = allItems.map(item => ({
          sale_item_id: item.id,
          return_qty: item.qty,
          return_reason_id: 1,
          unit_price: item.rate,
          tax_rate: 0,
          notes: 'Full order return'
        }))
      } else {
        invoicexReturnItems = items || []
      }
    } else if (items && items.length > 0) {
      // Custom return - categorize items
      const saleItemIds = items.map((item: any) => parseInt(item.sale_item_id))
      
      const invoiceItems = await prisma.invoiceitems.findMany({
        where: { id: { in: saleItemIds } },
        select: { id: true, invoice_no: true }
      })
      
      const invoicexItems = await prisma.invoice_itemsx.findMany({
        where: { id: { in: saleItemIds } },
        select: { id: true, invoice_no: true }
      })
      
      const invoiceItemIdSet = new Set(invoiceItems.map(i => i.id))
      const invoicexItemIdSet = new Set(invoicexItems.map(i => i.id))
      
      if (invoiceItems.length > 0) invoiceIdForReturn = invoiceItems[0].invoice_no
      if (invoicexItems.length > 0) invoicexIdForReturn = invoicexItems[0].invoice_no
      
      invoiceReturnItems = items.filter((item: any) => invoiceItemIdSet.has(parseInt(item.sale_item_id)))
      invoicexReturnItems = items.filter((item: any) => invoicexItemIdSet.has(parseInt(item.sale_item_id)))
    }

    // Use database transaction - ALL operations inside
    const result = await prisma.$transaction(async (tx) => {
      let saleReturn = null
      let salexReturn = null
      let totalRefundAmount = 0

      // Process sale returns
      if (invoiceReturnItems.length > 0 && invoiceIdForReturn) {
        let totalAmount = 0
        let totalTax = 0

        for (const item of invoiceReturnItems) {
          const subtotal = item.return_qty * item.unit_price
          const taxAmount = (subtotal * (item.tax_rate || 0)) / 100
          totalAmount += subtotal
          totalTax += taxAmount
        }

        const refundAmount = totalAmount + totalTax

        // Create sale return
        saleReturn = await tx.sale_returns.create({
          data: {
            invoice_id: invoiceIdForReturn,
            return_date: returnDateTimestamp,
            total_amount: totalAmount,
            total_tax: totalTax,
            refund_amount: refundAmount,
            payment_status: paymentStatusValue,
            payment_mode: paymentModeValue,
            payment_date: paymentDateValue,
            notes: return_notes || '',
            fy: financialYear
          }
        })

        // Create return items and update stock
        for (const item of invoiceReturnItems) {
          const subtotal = item.return_qty * item.unit_price
          const taxAmount = (subtotal * (item.tax_rate || 0)) / 100

          await tx.sale_return_items.create({
            data: {
              sale_return_id: saleReturn.id,
              invoice_item_id: parseInt(item.sale_item_id),
              return_qty: item.return_qty,
              unit_price: item.unit_price,
              tax_amount: taxAmount,
              return_reason_id: item.return_reason_id,
              notes: item.notes || ''
            }
          })

          // Update stock
          const invoiceItem = await tx.invoiceitems.findUnique({
            where: { id: parseInt(item.sale_item_id) },
            select: { product_id: true }
          })

          if (invoiceItem?.product_id) {
            await tx.product.update({
              where: { id: invoiceItem.product_id },
              data: { stock: { increment: item.return_qty } }
            })
          }
        }

        totalRefundAmount += refundAmount

        // Only create ledger entries when COMPLETE (payment_status === 1)
        if (paymentStatusValue === 1) {
          // Create CREDIT_NOTE entry (reduces what customer owes)
          await customerLedgerService.createEntry({
            customer_id: parseInt(customer_id),
            transaction_date: returnDateTimestamp,
            transaction_type: 'CREDIT_NOTE',
            reference_type: 'sale_return',
            reference_id: saleReturn.id,
            reference_no: `SR-${saleReturn.id}`,
            debit: 0,
            credit: refundAmount,
            payment_mode: null,
            payment_status: 1,
            payment_date: null,
            notes: return_notes || `Sale return SR-${saleReturn.id}`,
            fy: financialYear,
            transaction_id: null
          }, tx)

          // Create REFUND entry (money paid back to customer)
          await customerLedgerService.createEntry({
            customer_id: parseInt(customer_id),
            transaction_date: returnDateTimestamp,
            transaction_type: 'REFUND',
            reference_type: 'sale_return',
            reference_id: saleReturn.id,
            reference_no: `REF-SR-${saleReturn.id}`,
            debit: refundAmount,
            credit: 0,
            payment_mode: paymentModeValue,
            payment_status: 1,
            payment_date: returnDateTimestamp,
            notes: `Refund for sale return SR-${saleReturn.id}`,
            fy: financialYear,
            transaction_id: saleReturn.id
          }, tx)
        }
      }

      // Process salex returns
      if (invoicexReturnItems.length > 0 && invoicexIdForReturn) {
        let totalAmount = 0

        for (const item of invoicexReturnItems) {
          totalAmount += item.return_qty * item.unit_price
        }

        const refundAmount = totalAmount

        // Create salex return
        salexReturn = await tx.salex_returns.create({
          data: {
            invoicex_id: invoicexIdForReturn,
            return_date: returnDateTimestamp,
            total_amount: totalAmount,
            refund_amount: refundAmount,
            payment_status: paymentStatusValue,
            payment_mode: paymentModeValue,
            payment_date: paymentDateValue,
            notes: return_notes || '',
            fy: financialYear
          }
        })

        // Create return items and update stock
        for (const item of invoicexReturnItems) {
          await tx.salex_return_items.create({
            data: {
              salex_return_id: salexReturn.id,
              invoice_itemx_id: parseInt(item.sale_item_id),
              return_qty: item.return_qty,
              unit_price: item.unit_price,
              return_reason_id: item.return_reason_id,
              notes: item.notes || ''
            }
          })

          // Update stock
          const invoicexItem = await tx.invoice_itemsx.findUnique({
            where: { id: parseInt(item.sale_item_id) },
            select: { product_id: true }
          })

          if (invoicexItem?.product_id) {
            await tx.product.update({
              where: { id: invoicexItem.product_id },
              data: { stock: { increment: item.return_qty } }
            })
          }
        }

        totalRefundAmount += refundAmount

        // Only create ledger entries when COMPLETE (payment_status === 1)
        if (paymentStatusValue === 1) {
          // Create CREDIT_NOTE entry
          await customerLedgerService.createEntry({
            customer_id: parseInt(customer_id),
            transaction_date: returnDateTimestamp,
            transaction_type: 'CREDIT_NOTE',
            reference_type: 'salex_return',
            reference_id: salexReturn.id,
            reference_no: `SXR-${salexReturn.id}`,
            debit: 0,
            credit: refundAmount,
            payment_mode: null,
            payment_status: 1,
            payment_date: null,
            notes: return_notes || `Salex return SXR-${salexReturn.id}`,
            fy: financialYear,
            transaction_id: null
          }, tx)

          // Create REFUND entry
          await customerLedgerService.createEntry({
            customer_id: parseInt(customer_id),
            transaction_date: returnDateTimestamp,
            transaction_type: 'REFUND',
            reference_type: 'salex_return',
            reference_id: salexReturn.id,
            reference_no: `REF-SXR-${salexReturn.id}`,
            debit: refundAmount,
            credit: 0,
            payment_mode: paymentModeValue,
            payment_status: 1,
            payment_date: returnDateTimestamp,
            notes: `Refund for salex return SXR-${salexReturn.id}`,
            fy: financialYear,
            transaction_id: salexReturn.id
          }, tx)
        }
      }

      // Update customer balance ONLY when COMPLETE (payment_status === 1)
      if (paymentStatusValue === 1 && totalRefundAmount > 0) {
        await customerBalanceHandler.incrementBalanceInTransaction(
          tx,
          parseInt(customer_id),
          {
            total_refunded: totalRefundAmount,
            total_refund_allocated: totalRefundAmount
          },
          {
            type: 'return_create',
            id: saleReturn?.id || salexReturn?.id || 0,
            reference_no: saleReturn ? `SR-${saleReturn.id}` : `SXR-${salexReturn.id}`,
            notes: return_notes || 'Customer return with refund'
          }
        )
      }

      return { saleReturn, salexReturn }
    }, {
      timeout: 30000
    })

    res.status(201).json({
      success: true,
      message: 'Return(s) created successfully',
      data: {
        sale_return: result.saleReturn,
        salex_return: result.salexReturn
      }
    })

  } catch (error) {
    console.error('Customer return creation error:', error)
    res.status(500).json({
      message: 'Failed to create return',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
