import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query

  if (!id || Array.isArray(id)) {
    return res.status(400).json({ message: 'Invalid deadstock ID' })
  }

  const deadstockId = parseInt(id)
  if (isNaN(deadstockId)) {
    return res.status(400).json({ message: 'Invalid deadstock ID format' })
  }

  switch (req.method) {
    case 'GET':
      return handleGet(req, res, deadstockId)
    case 'PUT':
      return handlePut(req, res, deadstockId)
    case 'DELETE':
      return handleDelete(req, res, deadstockId)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse, deadstockId: number) {
  try {
    const deadstock = await prisma.deadstock.findUnique({
      where: { id: deadstockId },
      include: {
        product: {
          select: {
            id: true,
            product_name: true,
            part_no: true,
            stock: true
          }
        }
      }
    })

    if (!deadstock) {
      return res.status(404).json({ message: 'Deadstock entry not found' })
    }

    res.status(200).json({
      id: deadstock.id,
      product_id: deadstock.product_id,
      product_name: deadstock.product.product_name,
      part_no: deadstock.product.part_no || '',
      available_stock: deadstock.product.stock || 0,
      quantity: deadstock.quantity,
      reason: deadstock.reason,
      created_by: deadstock.created_by || '',
      created_at: deadstock.created_at,
      updated_at: deadstock.updated_at
    })
  } catch (error) {
    console.error('Deadstock fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch deadstock entry',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse, deadstockId: number) {
  try {
    const { product_id, quantity, reason, created_by } = req.body

    // Validation
    if (!quantity || !reason) {
      return res.status(400).json({
        message: 'Quantity and reason are required'
      })
    }

    if (quantity <= 0) {
      return res.status(400).json({
        message: 'Quantity must be greater than 0'
      })
    }

    // Get current deadstock entry
    const currentDeadstock = await prisma.deadstock.findUnique({
      where: { id: deadstockId },
      include: {
        product: {
          select: {
            id: true,
            product_name: true,
            stock: true
          }
        }
      }
    })

    if (!currentDeadstock) {
      return res.status(404).json({ message: 'Deadstock entry not found' })
    }

    // Calculate stock adjustment needed
    const quantityDifference = parseFloat(quantity) - currentDeadstock.quantity

    // If increasing quantity, check if there's enough stock for the difference
    // For editing deadstock, available stock includes current deadstock quantity
    if (quantityDifference > 0) {
      const availableStock = (currentDeadstock.product.stock || 0) + currentDeadstock.quantity
      if (availableStock < quantityDifference) {
        return res.status(400).json({
          message: `Insufficient stock for increase. Available: ${availableStock}, Needed: ${quantityDifference}`
        })
      }
    }

    // Use database transaction to ensure data consistency
    const result = await prisma.$transaction(async (tx) => {
      // Update deadstock entry
      const updatedDeadstock = await tx.deadstock.update({
        where: { id: deadstockId },
        data: {
          quantity: parseFloat(quantity),
          reason: reason.trim()
        },
        include: {
          product: {
            select: {
              id: true,
              product_name: true,
              part_no: true
            }
          }
        }
      })

      // Only adjust product stock if quantity actually changed
      if (quantityDifference !== 0) {
        await tx.product.update({
          where: { id: currentDeadstock.product_id },
          data: {
            stock: {
              decrement: quantityDifference  // If increasing deadstock, decrease stock; if decreasing, increase stock
            }
          }
        })
      }

      return updatedDeadstock
    })

    res.status(200).json({
      success: true,
      message: 'Deadstock entry updated successfully',
      data: {
        id: result.id,
        product_id: result.product_id,
        product_name: result.product.product_name,
        part_no: result.product.part_no || '',
        quantity: result.quantity,
        reason: result.reason,
        created_by: result.created_by,
        created_at: result.created_at,
        updated_at: result.updated_at
      }
    })

  } catch (error) {
    console.error('Deadstock update error:', error)
    res.status(500).json({
      message: 'Failed to update deadstock entry',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, deadstockId: number) {
  try {
    // Get current deadstock entry to know how much stock to return
    const currentDeadstock = await prisma.deadstock.findUnique({
      where: { id: deadstockId },
      select: {
        id: true,
        product_id: true,
        quantity: true
      }
    })

    if (!currentDeadstock) {
      return res.status(404).json({ message: 'Deadstock entry not found' })
    }

    // Use database transaction to ensure data consistency
    await prisma.$transaction(async (tx) => {
      // Return stock to product inventory
      await tx.product.update({
        where: { id: currentDeadstock.product_id },
        data: {
          stock: {
            increment: currentDeadstock.quantity
          }
        }
      })

      // Delete deadstock entry
      await tx.deadstock.delete({
        where: { id: deadstockId }
      })
    })

    res.status(200).json({
      success: true,
      message: 'Deadstock entry deleted successfully. Stock returned to inventory.',
      data: {
        returned_quantity: currentDeadstock.quantity,
        product_id: currentDeadstock.product_id
      }
    })

  } catch (error) {
    console.error('Deadstock deletion error:', error)
    res.status(500).json({
      message: 'Failed to delete deadstock entry',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
