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
    // Get unique values by joining with lookup tables for proper names
    const [categories, subcategories, companies] = await Promise.all([
      // Get distinct categories with proper names by joining with product_category table
      prisma.product.findMany({
        where: {
          product_category: { not: null }
        },
        select: {
          product_category: true
        },
        distinct: ['product_category']
      }).then(async (products) => {
        // Get category names by joining with product_category table
        const categoryIds = products
          .map(p => p.product_category)
          .filter(Boolean)
          .map(id => parseInt(id as string))
          .filter(id => !isNaN(id));

        if (categoryIds.length === 0) return [];

        const categoryRecords = await prisma.product_category.findMany({
          where: {
            id: { in: categoryIds }
          },
          select: {
            id: true,
            category_name: true
          }
        });

        return categoryRecords;
      }),

      // Get distinct subcategories with proper names by joining with product_subcategory table
      prisma.product.findMany({
        where: {
          product_subcategory: { not: null }
        },
        select: {
          product_subcategory: true
        },
        distinct: ['product_subcategory']
      }).then(async (products) => {
        // Get subcategory names by joining with product_subcategory table
        const subcategoryIds = products
          .map(p => p.product_subcategory)
          .filter(Boolean)
          .flatMap(sub => sub ? sub.split(',').map(s => s.trim()) : [])
          .map(id => parseInt(id as string))
          .filter(id => !isNaN(id));

        if (subcategoryIds.length === 0) return [];

        const subcategoryRecords = await prisma.product_subcategory.findMany({
          where: {
            id: { in: subcategoryIds }
          },
          select: {
            id: true,
            subcategory_name: true
          }
        });

        return subcategoryRecords;
      }),

      // Get distinct companies with proper names by joining with product_company table
      prisma.product.findMany({
        where: {
          company: { not: null }
        },
        select: {
          company: true
        },
        distinct: ['company']
      }).then(async (products) => {
        // Get company names by joining with product_company table
        const companyIds = products
          .map(p => p.company)
          .filter(Boolean)
          .map(id => parseInt(id as string))
          .filter(id => !isNaN(id));

        if (companyIds.length === 0) return [];

        const companyRecords = await prisma.product_company.findMany({
          where: {
            id: { in: companyIds }
          },
          select: {
            id: true,
            company_name: true
          }
        });

        return companyRecords;
      }),
    ])

    // Build category options - use the actual category names as both id and name
    const categoryOptions = categories
      .filter(cat => cat.category_name)
      .map((cat) => ({
        id: cat.category_name,
        name: cat.category_name,
        source: 'products'
      }))

    // Build subcategory options (Car Models) - use the actual subcategory names as both id and name
    const subcategoryOptions = subcategories
      .filter(sub => sub.subcategory_name)
      .map((sub) => ({
        id: sub.subcategory_name,
        name: sub.subcategory_name,
        source: 'products'
      }))

    // Build company options - use the actual company names as both id and name
    const companyOptions = companies
      .filter(comp => comp.company_name)
      .map((comp) => ({
        id: comp.company_name,
        name: comp.company_name,
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
