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
    return res.status(400).json({ message: 'Invalid adjustment ID' })
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

async function handleGet(req: NextApiRequest, res: NextApiResponse, adjustmentId: string) {
  try {
    // Find the adjustment in customer_ledger by ID
    const adjustment = await prisma.customer_ledger.findUnique({
      where: { id: parseInt(adjustmentId) }
    })

    if (!adjustment) {
      return res.status(404).json({ message: 'Customer adjustment not found' })
    }

    // Check if it's an adjustment type
    const adjustmentTypes = ['SALE_ADJUSTMENT', 'RECEIPT_ADJUSTMENT', 'RECEIPT_REVERSAL', 'REFUND_PAID']
    if (!adjustmentTypes.includes(adjustment.transaction_type)) {
      return res.status(404).json({ message: 'Not an adjustment transaction' })
    }

    // Get customer details separately
    const customer = await prisma.customer_details.findUnique({
      where: { id: adjustment.customer_id },
      select: { id: true, billing_name: true }
    })

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

    const enhancedAdjustment = {
      id: adjustment.id,
      customer_id: adjustment.customer_id,
      customer_name: customer?.billing_name || 'Unknown Customer',
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
      created_at: adjustment.created_at,
      updated_at: adjustment.updated_at
    }

    res.status(200).json({
      adjustment: enhancedAdjustment
    })
  } catch (error) {
    console.error('Customer adjustment fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch customer adjustment',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse, adjustmentId: string) {
  try {
    const {
      adjustment_date,
      notes
    } = req.body

    // Find existing adjustment
    const existingAdjustment = await prisma.customer_ledger.findUnique({
      where: { id: parseInt(adjustmentId) }
    })

    if (!existingAdjustment) {
      return res.status(404).json({ message: 'Customer adjustment not found' })
    }

    // Check if it's an adjustment type
    const adjustmentTypes = ['SALE_ADJUSTMENT', 'RECEIPT_ADJUSTMENT', 'RECEIPT_REVERSAL', 'REFUND_PAID']
    if (!adjustmentTypes.includes(existingAdjustment.transaction_type)) {
      return res.status(400).json({ message: 'Not an adjustable transaction type' })
    }

    // Convert adjustment date to Unix timestamp
    const adjustmentDateTimestamp = adjustment_date ? convertDateToTimestamp(adjustment_date) : existingAdjustment.transaction_date

    // Update the adjustment
    const updatedAdjustment = await prisma.customer_ledger.update({
      where: { id: parseInt(adjustmentId) },
      data: {
        transaction_date: adjustmentDateTimestamp,
        notes: notes !== undefined ? notes : existingAdjustment.notes,
        updated_at: new Date()
      }
    })

    res.status(200).json({
      success: true,
      message: 'Customer adjustment updated successfully',
      data: {
        adjustment: {
          id: updatedAdjustment.id,
          transaction_type: updatedAdjustment.transaction_type,
          amount: updatedAdjustment.debit > 0 ? updatedAdjustment.debit : updatedAdjustment.credit,
          notes: updatedAdjustment.notes
        }
      }
    })

  } catch (error) {
    console.error('Customer adjustment update error:', error)
    res.status(500).json({
      message: 'Failed to update customer adjustment',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, adjustmentId: string) {
  try {
    // Find existing adjustment
    const existingAdjustment = await prisma.customer_ledger.findUnique({
      where: { id: parseInt(adjustmentId) },
      select: {
        id: true,
        customer_id: true,
        transaction_type: true,
        debit: true,
        credit: true,
        reference_no: true,
        notes: true
      }
    })

    if (!existingAdjustment) {
      return res.status(404).json({ message: 'Customer adjustment not found' })
    }

    // Check if it's an adjustment type
    const adjustmentTypes = ['SALE_ADJUSTMENT', 'RECEIPT_ADJUSTMENT', 'RECEIPT_REVERSAL', 'REFUND_PAID']
    if (!adjustmentTypes.includes(existingAdjustment.transaction_type)) {
      return res.status(400).json({ message: 'Not a deletable adjustment transaction type' })
    }

    // ✅ Use database transaction for adjustment deletion
    await prisma.$transaction(async (tx) => {
      // Delete the ledger entry inside transaction
      await tx.customer_ledger.delete({
        where: { id: parseInt(adjustmentId) }
      })

      // Reverse the balance update based on the original adjustment
      let balanceReversal: any = {}

      switch (existingAdjustment.transaction_type) {
        case 'SALE_ADJUSTMENT':
          // Reverse sale adjustment (decrease balance)
          balanceReversal = { total_allocated: -Number(existingAdjustment.debit) }
          break

        case 'RECEIPT_ADJUSTMENT':
          // Reverse receipt adjustment
          if (existingAdjustment.credit > 0) {
            // Was an increase, now decrease
            balanceReversal = { 
              total_paid: -Number(existingAdjustment.credit), 
              total_allocated: -Number(existingAdjustment.credit) 
            }
          } else {
            // Was a decrease, now increase
            balanceReversal = { 
              total_paid: Number(existingAdjustment.debit), 
              total_allocated: Number(existingAdjustment.debit) 
            }
          }
          break

        case 'RECEIPT_REVERSAL':
          // Reverse receipt reversal (restore the payment)
          balanceReversal = { 
            total_paid: Number(existingAdjustment.debit), 
            total_allocated: Number(existingAdjustment.debit) 
          }
          break

        case 'REFUND_PAID':
          // Reverse refund paid (decrease refunded amount)
          balanceReversal = { total_refunded: -Number(existingAdjustment.debit) }
          break
      }

      // Update customer balance using handler (with logging) inside transaction
      await require('../../../lib/customer-balance-handler').customerBalanceHandler.incrementBalanceInTransaction(
        tx,
        existingAdjustment.customer_id,
        balanceReversal,
        {
          type: 'adjustment_delete',
          id: parseInt(adjustmentId),
          reference_no: existingAdjustment.reference_no || 'ADJ',
          notes: `Reversed: ${existingAdjustment.notes || existingAdjustment.transaction_type}`
        }
      )
    }, {
      timeout: 30000
    })

    res.status(200).json({
      success: true,
      message: 'Customer adjustment deleted successfully'
    })

  } catch (error) {
    console.error('Customer adjustment deletion error:', error)
    res.status(500).json({
      message: 'Failed to delete customer adjustment',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
