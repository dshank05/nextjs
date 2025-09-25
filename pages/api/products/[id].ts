import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

// Function to enhance a single product using new FK relationships
async function enhanceProduct(product: any) {
  if (!product) return null

  // Get foreign key IDs using new relationships
  const categoryIds = product.product_category_id ? [product.product_category_id] : []
  const subcategoryIds = product.product_subcategory_id ? [product.product_subcategory_id] : []
  const carModelIds = product.car_model_id ? [product.car_model_id] : []
  const companyIds = product.company ? [parseInt(product.company)].filter(id => !isNaN(id)) : []

  // Batch fetch names using foreign key relationships
  const [categoryRecords, subcategoryRecords, carModelRecords, companyRecords] = await Promise.all([
    categoryIds.length > 0 ? prisma.product_category_new.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, product_name: true }
    }) : Promise.resolve([]),
    subcategoryIds.length > 0 ? prisma.product_subcategory_new.findMany({
      where: { id: { in: subcategoryIds } },
      select: { id: true, subcategory_name: true }
    }) : Promise.resolve([]),
    carModelIds.length > 0 ? prisma.car_models.findMany({
      where: { id: { in: carModelIds } },
      select: { id: true, model_name: true }
    }) : Promise.resolve([]),
    companyIds.length > 0 ? prisma.product_company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, company_name: true }
    }) : Promise.resolve([])
  ])

  // Create lookup maps
  const categoryMap = new Map(categoryRecords.map(cat => [cat.id, cat.product_name]))
  const subcategoryMap = new Map(subcategoryRecords.map(sub => [sub.id, sub.subcategory_name]))
  const carModelMap = new Map(carModelRecords.map(model => [model.id, model.model_name]))
  const companyMap = new Map(companyRecords.map(comp => [comp.id.toString(), comp.company_name]))

  // Look up names using foreign key maps
  const categoryName = product.product_category_id ? categoryMap.get(product.product_category_id) || '' : ''
  const subcategoryName = product.product_subcategory_id ? subcategoryMap.get(product.product_subcategory_id) || '' : ''
  const carModelName = product.car_model_id ? carModelMap.get(product.car_model_id) || '' : ''
  const companyName = product.company ? companyMap.get(product.company) || '' : ''

  // For display, combine subcategory and car model for backward compatibility
  const subcategoryNames = [subcategoryName, carModelName].filter(Boolean).join(', ')

  return {
    ...product,
    categoryName,
    companyName,
    subcategoryNames
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query

  switch (req.method) {
    case 'GET':
      try {
        const productId = parseInt(id as string)
        if (isNaN(productId)) {
          return res.status(400).json({ message: 'Invalid product ID' })
        }

        const product = await prisma.product.findUnique({
          where: { id: productId }
        })

        if (!product) {
          return res.status(404).json({ message: 'Product not found' })
        }

        const enhancedProduct = await enhanceProduct(product)
        res.status(200).json(enhancedProduct)

      } catch (error) {
        console.error('Get product error:', error)
        res.status(500).json({ message: 'Failed to fetch product', error: error instanceof Error ? error.message : 'Unknown error' })
      }
      break

    case 'PUT':
      try {
        const productId = parseInt(id as string)
        if (isNaN(productId)) {
          return res.status(400).json({ message: 'Invalid product ID' })
        }

        const {
          product_name,
          display_name,
          product_category_id,
          product_subcategory_id,
          car_model_id,
          company,
          part_no,
          min_stock,
          stock,
          rate,
          hsn,
          notes,
        } = req.body

        // Validate required fields
        if (!product_name) {
          return res.status(400).json({ message: 'Product name is required' })
        }

        const updatedProduct = await prisma.product.update({
          where: { id: productId },
          data: {
            product_name,
            display_name: display_name || product_name,
            product_category_id: product_category_id ? parseInt(product_category_id) : null,
            product_subcategory_id: product_subcategory_id ? parseInt(product_subcategory_id) : null,
            car_model_id: car_model_id ? parseInt(car_model_id) : null,
            company,
            part_no,
            min_stock: min_stock ? parseInt(min_stock) : null,
            stock: stock ? parseInt(stock) : null,
            rate: rate ? parseFloat(rate) : null,
            hsn,
            notes,
          }
        })

        const enhancedProduct = await enhanceProduct(updatedProduct)
        res.status(200).json(enhancedProduct)

      } catch (error) {
        console.error('Update product error:', error)
        res.status(500).json({ message: 'Failed to update product', error: error instanceof Error ? error.message : 'Unknown error' })
      }
      break

    case 'DELETE':
      try {
        const productId = parseInt(id as string)
        if (isNaN(productId)) {
          return res.status(400).json({ message: 'Invalid product ID' })
        }

        await prisma.product.delete({
          where: { id: productId }
        })

        res.status(204).end()

      } catch (error) {
        console.error('Delete product error:', error)
        res.status(500).json({ message: 'Failed to delete product', error: error instanceof Error ? error.message : 'Unknown error' })
      }
      break

    default:
      res.setHeader('Allow', ['GET', 'PUT', 'DELETE'])
      res.status(405).end(`Method ${req.method} Not Allowed`)
  }
}
