import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    // Get unique values from the products table since lookup tables might not exist
    const [categories, subcategories, companies] = await Promise.all([
      // Get distinct categories used in products
      prisma.product.findMany({
        where: {
          product_category: { not: null }
        },
        select: {
          product_category: true
        },
        distinct: ['product_category']
      }),

      // Get distinct subcategories used in products (Car Models)
      prisma.product.findMany({
        where: {
          product_subcategory: { not: null }
        },
        select: {
          product_subcategory: true
        },
        distinct: ['product_subcategory']
      }),

      // Get distinct companies used in products
      prisma.product.findMany({
        where: {
          company: { not: null }
        },
        select: {
          company: true
        },
        distinct: ['company']
      }),
    ])

    // Build category options
    const categoryOptions = categories
      .filter(cat => cat.product_category)
      .map((cat, index) => ({
        id: (index + 1).toString(),
        name: cat.product_category,
        source: 'products'
      }))

    // Build subcategory options (Car Models)
    const subcategoryOptions = subcategories
      .filter(sub => sub.product_subcategory)
      .map((sub, index) => ({
        id: (index + 1).toString(),
        name: sub.product_subcategory,
        source: 'products'
      }))

    // Build company options
    const companyOptions = companies
      .filter(comp => comp.company)
      .map((comp, index) => ({
        id: (index + 1).toString(),
        name: comp.company,
        source: 'products'
      }))

    res.status(200).json({
      categories: categoryOptions.sort((a, b) => a.name.localeCompare(b.name)),
      subcategories: subcategoryOptions.sort((a, b) => a.name.localeCompare(b.name)),
      companies: companyOptions.sort((a, b) => a.name.localeCompare(b.name))
    })
  } catch (error) {
    console.error('Filter options fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch filter options',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
