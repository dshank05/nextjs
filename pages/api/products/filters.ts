import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { fail, methodNotAllowed } from '../../../lib/api/respond'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])

  try {
    // Get filter options from all related tables in parallel
    const [categories, subcategories, companies, models] = await Promise.all([
      // Get categories from product_category table - indexed on category_name
      prisma.product_category.findMany({
        orderBy: { category_name: 'asc' },
        select: {
          id: true,
          category_name: true
        }
      }),

      // Get subcategories from product_subcategory table - indexed on subcategory_name
      prisma.product_subcategory.findMany({
        orderBy: { subcategory_name: 'asc' },
        select: {
          id: true,
          category_id:true,
          subcategory_name: true
        }
      }),

      // Get companies from product_company table - indexed on company_name
      prisma.product_company.findMany({
        orderBy: { company_name: 'asc' },
        select: {
          id: true,
          company_name: true
        }
      }),

      // Get car models from car_models table - indexed on model_name
      prisma.car_models.findMany({
        orderBy: { model_name: 'asc' },
        select: {
          id: true,
          model_name: true
        }
      }),
    ])

    // Ordered by name in the query: without ORDER BY the database promises no order (PQ-46).
    const categoryOptions = categories.map((cat) => ({
      id: cat.id,
      name: cat.category_name || ''
    }))

    const subcategoryOptions = subcategories.map((sub) => ({
      category_id:sub.category_id,
      id: sub.id,
      name: sub.subcategory_name || ''
    }))

    const companyOptions = companies.map((comp) => ({
      id: comp.id,
      name: comp.company_name || ''
    }))

    const modelOptions = models.map((model) => ({
      id: model.id,
      name: model.model_name || ''
    }))

    res.status(200).json({
      categories: categoryOptions,
      subcategories: subcategoryOptions,
      companies: companyOptions,
      models: modelOptions
    })
  } catch (error) {
    return fail(res, error, 'load filter options')
  }
}

export default withObservability(handler)
