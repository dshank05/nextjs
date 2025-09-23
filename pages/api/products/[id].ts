import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

// Function to enhance a single product (reuse from optimized.ts)
async function enhanceProduct(product: any) {
  if (!product) return null

  const productIds = [product.id.toString()]

  // Get category and company IDs
  const categoryIds = [product.product_category].filter(Boolean).map(id => parseInt(id as string)).filter(id => !isNaN(id))
  const companyIds = [product.company].filter(Boolean).map(id => parseInt(id as string)).filter(id => !isNaN(id))

  // Get subcategory IDs
  const subcategoryIds = new Set<number>()
  if (product.product_subcategory) {
    product.product_subcategory.split(',').forEach((id: string) => {
      const parsedId = parseInt(id.trim())
      if (!isNaN(parsedId)) subcategoryIds.add(parsedId)
    })
  }

  // Batch fetch
  const [categoryRecords, companyRecords, subcategoryRecords] = await Promise.all([
    categoryIds.length > 0 ? prisma.product_category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, category_name: true }
    }) : Promise.resolve([]),
    companyIds.length > 0 ? prisma.product_company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, company_name: true }
    }) : Promise.resolve([]),
    subcategoryIds.size > 0 ? prisma.product_subcategory.findMany({
      where: { id: { in: Array.from(subcategoryIds) } },
      select: { id: true, subcategory_name: true }
    }) : Promise.resolve([])
  ])

  const categoryMap = new Map(categoryRecords.map(cat => [cat.id.toString(), cat.category_name]))
  const companyMap = new Map(companyRecords.map(comp => [comp.id.toString(), comp.company_name]))
  const subcategoryMap = new Map(subcategoryRecords.map(sub => [sub.id.toString(), sub.subcategory_name]))

  // Lookup
  const categoryName = product.product_category ? categoryMap.get(product.product_category) || '' : ''
  const companyName = product.company ? companyMap.get(product.company) || '' : ''

  let subcategoryNames = ''
  if (product.product_subcategory) {
    const subcategoryNameList = product.product_subcategory
      .split(',')
      .map((id: string) => {
        const trimmedId = id.trim()
        return subcategoryMap.get(trimmedId) || ''
      })
      .filter(name => name)
      .sort((a, b) => a.localeCompare(b))

    subcategoryNames = subcategoryNameList.join(', ')
  }

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

  if (req.method === 'GET') {
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
  } else {
    res.setHeader('Allow', ['GET'])
    res.status(405).end(`Method ${req.method} Not Allowed`)
  }
}
