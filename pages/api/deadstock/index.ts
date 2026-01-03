import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'

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
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {}

    // Search filter - search across product name and reason
    if (search) {
      const searchStr = search as string
      where.OR = [
        { reason: { contains: searchStr } },
        { product: { product_name: { contains: searchStr } } },
        { created_by: { contains: searchStr } }
      ]
    }

    // Validate and set sort parameters
    const validSortFields = ['id', 'quantity', 'reason', 'created_by', 'created_at', 'updated_at', 'product_name']
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'created_at'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    // For product_name sorting, we need to fetch all data first and sort in JavaScript
    const needsPostSorting = sortField === 'product_name'

    let deadstock: any[] = []
    let total: number = 0

    if (needsPostSorting) {
      // Get all deadstock with product info
      const result = await Promise.all([
        prisma.deadstock.findMany({
          where,
          include: {
            product: {
              select: {
                id: true,
                product_name: true,
                part_no: true
              }
            }
          }
        }),
        prisma.deadstock.count({ where })
      ])
      deadstock = result[0]
      total = result[1]
    } else {
      // Get deadstock with database-level sorting
      const result = await Promise.all([
        prisma.deadstock.findMany({
          where,
          skip,
          take: limitNum,
          orderBy: { [sortField]: sortDirection },
          include: {
            product: {
              select: {
                id: true,
                product_name: true,
                part_no: true
              }
            }
          }
        }),
        prisma.deadstock.count({ where })
      ])
      deadstock = result[0]
      total = result[1]
    }

    // Enhanced deadstock with formatted data
    let enhancedDeadstock = deadstock.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      product_name: item.product.product_name,
      part_no: item.product.part_no || '',
      quantity: item.quantity,
      reason: item.reason,
      created_by: item.created_by || '',
      created_at: item.created_at,
      updated_at: item.updated_at,
      formatted_created_at: item.created_at.toLocaleDateString('en-IN'),
      formatted_updated_at: item.updated_at.toLocaleDateString('en-IN')
    }))

    // Apply post-sorting for product_name if needed
    if (needsPostSorting) {
      enhancedDeadstock.sort((a, b) => {
        const aValue = (a.product_name || '').toLowerCase()
        const bValue = (b.product_name || '').toLowerCase()

        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
        return 0
      })

      // Apply pagination after sorting
      enhancedDeadstock = enhancedDeadstock.slice(skip, skip + limitNum)
    }

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      deadstock: enhancedDeadstock,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    console.error('Deadstock fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch deadstock data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { product_id, quantity, reason, created_by } = req.body

    // Validation
    if (!product_id || !quantity || !reason) {
      return res.status(400).json({
        message: 'Product ID, quantity, and reason are required'
      })
    }

    if (quantity <= 0) {
      return res.status(400).json({
        message: 'Quantity must be greater than 0'
      })
    }

    // Check if product exists and has sufficient stock
    const product = await prisma.product.findUnique({
      where: { id: parseInt(product_id) },
      select: { id: true, product_name: true, stock: true }
    })

    if (!product) {
      return res.status(400).json({
        message: 'Product not found'
      })
    }

    if ((product.stock || 0) < quantity) {
      return res.status(400).json({
        message: `Insufficient stock. Available: ${product.stock || 0}, Requested: ${quantity}`
      })
    }

    // Use database transaction to ensure data consistency
    const result = await prisma.$transaction(async (tx) => {
      // Create deadstock entry
      const deadstockEntry = await tx.deadstock.create({
        data: {
          product_id: parseInt(product_id),
          quantity: parseFloat(quantity),
          reason: reason.trim(),
          created_by: created_by?.trim() || null
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

      // Reduce product stock
      await tx.product.update({
        where: { id: parseInt(product_id) },
        data: {
          stock: {
            decrement: parseFloat(quantity)
          }
        }
      })

      return deadstockEntry
    })

    res.status(201).json({
      success: true,
      message: 'Deadstock entry created successfully',
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
    console.error('Deadstock creation error:', error)
    res.status(500).json({
      message: 'Failed to create deadstock entry',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
