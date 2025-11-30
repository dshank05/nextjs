import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../../lib/db'
import { withObservability } from '../../../../lib/withObservability'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ message: 'Return ID is required' })
  }

  switch (req.method) {
    case 'PUT':
      return handlePut(req, res, parseInt(id))
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handlePut(
  req: NextApiRequest,
  res: NextApiResponse,
  returnId: number
) {
  try {
    const {
      payment_status, // 0=Unpaid, 1=Paid
      payment_mode,   // 0=Cash, 1=Bank
      payment_date    // Unix timestamp
    } = req.body

    // Validation
    if (payment_status === undefined) {
      return res.status(400).json({
        message: 'Payment status is required'
      })
    }

    // Verify return exists
    const existingReturn = await prisma.purchase_returns.findUnique({
      where: { id: returnId },
      select: {
        id: true,
        total_amount: true,
        total_tax: true,
        refund_amount: true
      }
    })

    if (!existingReturn) {
      return res.status(404).json({ message: 'Return not found' })
    }

    // Prepare update data
    const updateData: any = {
      payment_status: parseInt(payment_status)
    }

    // Add payment_mode if provided
    if (payment_mode !== undefined) {
      updateData.payment_mode = parseInt(payment_mode)
    }

    // Add payment_date if provided (or current timestamp if marking as paid)
    if (payment_date) {
      updateData.payment_date = parseInt(payment_date)
    } else if (parseInt(payment_status) === 1) {
      // Auto-set payment_date to now if marking as paid without a specific date
      updateData.payment_date = Math.floor(Date.now() / 1000)
    }

    // Update the return
    const updatedReturn = await prisma.purchase_returns.update({
      where: { id: returnId },
      data: updateData,
      select: {
        id: true,
        payment_status: true,
        payment_mode: true,
        payment_date: true,
        refund_amount: true,
        total_amount: true,
        total_tax: true,
        vendor: {
          select: {
            id: true,
            vendor_name: true
          }
        }
      }
    })

    res.status(200).json({
      success: true,
      message: 'Payment status updated successfully',
      data: {
        return: updatedReturn
      }
    })

  } catch (error) {
    console.error('Payment status update error:', error)
    res.status(500).json({
      message: 'Failed to update payment status',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
