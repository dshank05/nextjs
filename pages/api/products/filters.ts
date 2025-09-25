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
    // Get filter options using new foreign key relationships
    const [categories, subcategories, companies] = await Promise.all([
      // Get categories with proper names from new product_category_new table
      prisma.product_category_new.findMany({
        select: {
          id: true,
          product_name: true
        },
        orderBy: { product_name: 'asc' }
      }),

      // Get subcategories with proper names from new product_subcategory_new table
      prisma.product_subcategory_new.findMany({
        select: {
          id: true,
          subcategory_name: true
        },
        orderBy: { subcategory_name: 'asc' }
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

    // Build category options - use the actual category ID and name
    const categoryOptions = categories
      .filter(cat => cat.product_name)
      .map((cat) => ({
        id: cat.id,
        name: cat.product_name,
        source: 'products'
      }))

    // Build subcategory options (Car Models) - use the actual subcategory ID and name
    const subcategoryOptions = subcategories
      .filter(sub => sub.subcategory_name)
      .map((sub) => ({
        id: sub.id,
        name: sub.subcategory_name,
        source: 'products'
      }))

    // Build company options - use the actual company ID and name
    const companyOptions = companies
      .filter(comp => comp.company_name)
      .map((comp) => ({
        id: comp.id,
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
