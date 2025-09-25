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
    // Get filter options from all related tables
    const [categories, subcategories, companies, models] = await Promise.all([
      // Get categories from product_category table
      prisma.product_category.findMany({
        select: {
          id: true,
          category_name: true
        },
        orderBy: { category_name: 'asc' }
      }),

      // Get subcategories from product_subcategory table
      prisma.product_subcategory.findMany({
        select: {
          id: true,
          subcategory_name: true
        },
        orderBy: { subcategory_name: 'asc' }
      }),

      // Get companies from product_company table
      prisma.product_company.findMany({
        select: {
          id: true,
          company_name: true
        },
        orderBy: { company_name: 'asc' }
      }),

      // Get car models from car_models table
      prisma.car_models.findMany({
        select: {
          id: true,
          model_name: true
        },
        orderBy: { model_name: 'asc' }
      }),
    ])

    // Build category options - use the actual category ID and name
    const categoryOptions = categories
      .filter(cat => cat.category_name)
      .map((cat) => ({
        id: cat.id,
        name: cat.category_name,
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

    // Build model options - use the actual model ID and name
    const modelOptions = models
      .filter(model => model.model_name)
      .map((model) => ({
        id: model.id,
        name: model.model_name,
        source: 'products'
      }))

    res.status(200).json({
      categories: categoryOptions.sort((a, b) => a.name.localeCompare(b.name)),
      subcategories: subcategoryOptions.sort((a, b) => a.name.localeCompare(b.name)),
      companies: companyOptions.sort((a, b) => a.name.localeCompare(b.name)),
      models: modelOptions.sort((a, b) => a.name.localeCompare(b.name))
    })
  } catch (error) {
    console.error('Filter options fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch filter options',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
