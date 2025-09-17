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
    // Get all categories, subcategories, and companies from lookup tables
    const [categories, subcategories, companies] = await Promise.all([
      // Get all product categories
      prisma.product_category.findMany({
        select: {
          id: true,
          category_name: true
        },
        orderBy: { category_name: 'asc' }
      }),

      // Get all product subcategories (Car Models)
      prisma.product_subcategory.findMany({
        select: {
          id: true,
          subcategory_name: true
        },
        orderBy: { subcategory_name: 'asc' }
      }),

      // Get all product companies  
      prisma.product_company.findMany({
        select: {
          id: true,
          company_name: true
        },
        orderBy: { company_name: 'asc' }
      }),
    ])

    // Also get unique categories and companies actually used in products
    const [usedCategories, usedCompanies] = await Promise.all([
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

    // Build category options (merge lookup table with used categories)
    const categoryOptions = []
    
    // Add from lookup table
    for (const cat of categories) {
      categoryOptions.push({
        id: cat.id.toString(),
        name: cat.category_name,
        source: 'lookup'
      })
    }
    
    // Add any categories used in products that aren't in lookup table
    for (const used of usedCategories) {
      if (used.product_category && !categoryOptions.find(c => c.id === used.product_category)) {
        categoryOptions.push({
          id: used.product_category,
          name: used.product_category,
          source: 'direct'
        })
      }
    }

    // Build company options (merge lookup table with used companies)
    const companyOptions = []
    
    // Add from lookup table
    for (const comp of companies) {
      companyOptions.push({
        id: comp.id.toString(),
        name: comp.company_name,
        source: 'lookup'
      })
    }
    
    // Add any companies used in products that aren't in lookup table
    for (const used of usedCompanies) {
      if (used.company && !companyOptions.find(c => c.id === used.company)) {
        companyOptions.push({
          id: used.company,
          name: used.company,
          source: 'direct'
        })
      }
    }

    // Build subcategory options (Car Models)
    const subcategoryOptions = subcategories.map(sub => ({
      id: sub.id.toString(),
      name: sub.subcategory_name,
      source: 'lookup'
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
