import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

// Simple in-memory cache for lookup data (resets on server restart)
const lookupCache = new Map<string, { data: any; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function getCachedLookupData(key: string, fetcher: () => Promise<any>) {
  const cached = lookupCache.get(key)
  const now = Date.now()
  
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.data
  }
  
  const data = await fetcher()
  lookupCache.set(key, { data, timestamp: now })
  return data
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const { 
      page = '1', 
      limit = '50', 
      search = '', 
      category = '',
      subcategory = '',
      company = '',
      lowStock = 'false' 
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    
    // Handle complex filtering that requires post-processing
    const needsPostFiltering = lowStock === 'true' || (subcategory && subcategory !== '')
    
    if (needsPostFiltering) {
      // For complex filters, get all matching products first
      const where: any = {}
      
      if (search) {
        where.OR = [
          { product_name: { contains: search as string } },
          { part_no: { contains: search as string } },
        ]
      }

      if (category && category !== '') {
        where.product_category = category as string
      }

      if (company && company !== '') {
        where.company = company as string
      }

      // Get all products that match database filters
      let allProducts = await prisma.product.findMany({
        where,
        orderBy: { id: 'desc' },
      })

      // Apply post-filters
      if (lowStock === 'true') {
        allProducts = allProducts.filter((product: any) => 
          (product.stock || 0) < (product.min_stock || 0) || (product.stock || 0) < 2
        )
      }

      if (subcategory && subcategory !== '') {
        allProducts = allProducts.filter((product: any) => 
          product.product_subcategory && 
          product.product_subcategory.split(',').some((id: string) => id.trim() === subcategory)
        )
      }

      // Apply pagination after filtering
      const skip = (pageNum - 1) * limitNum
      const products = allProducts.slice(skip, skip + limitNum)
      const total = allProducts.length

      // Get enhanced data for paginated products
      const enhancedProducts = await enhanceProducts(products)
      
      const totalPages = Math.ceil(total / limitNum)

      res.status(200).json({
        products: enhancedProducts,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasMore: pageNum < totalPages,
        },
      })

    } else {
      // Simple filtering - can use efficient database pagination
      const skip = (pageNum - 1) * limitNum
      const where: any = {}
      
      if (search) {
        where.OR = [
          { product_name: { contains: search as string } },
          { part_no: { contains: search as string } },
        ]
      }

      if (category && category !== '') {
        where.product_category = category as string
      }

      if (company && company !== '') {
        where.company = company as string
      }

      // Get products with efficient pagination
      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          skip,
          take: limitNum,
          orderBy: { id: 'desc' },
        }),
        prisma.product.count({ where }),
      ])

      // Get enhanced data
      const enhancedProducts = await enhanceProducts(products)
      
      const totalPages = Math.ceil(total / limitNum)

      res.status(200).json({
        products: enhancedProducts,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasMore: pageNum < totalPages,
        },
      })
    }

  } catch (error) {
    console.error('Optimized products fetch error:', error)
    res.status(500).json({ 
      message: 'Failed to fetch optimized products',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function enhanceProducts(products: any[]): Promise<any[]> {
  if (products.length === 0) return []

  // Extract unique IDs for batch queries
  const productIds = products.map(p => p.id.toString())
  const categoryIds = [...new Set(products.map(p => p.product_category).filter(Boolean))]
  const companyIds = [...new Set(products.map(p => p.company).filter(Boolean))]
  
  // Get all subcategory IDs from comma-separated values
  const allSubcategoryIds = new Set<string>()
  products.forEach((product: any) => {
    if (product.product_subcategory) {
      product.product_subcategory.split(',').forEach((id: string) => {
        if (id.trim()) allSubcategoryIds.add(id.trim())
      })
    }
  })

  // OPTIMIZED: Single batch queries with caching
  const [categoriesMap, companiesMap, subcategoriesMap, latestPurchaseRates] = await Promise.all([
    // Categories with caching
    getCachedLookupData(`categories_${categoryIds.join(',')}`, async () => {
      if (categoryIds.length === 0) return new Map()
      const cats = await prisma.product_category.findMany({
        where: { id: { in: categoryIds.map((id: string) => parseInt(id)) } },
        select: { id: true, category_name: true }
      })
      return new Map(cats.map((c: any) => [c.id.toString(), c.category_name]))
    }),

    // Companies with caching
    getCachedLookupData(`companies_${companyIds.join(',')}`, async () => {
      if (companyIds.length === 0) return new Map()
      const comps = await prisma.product_company.findMany({
        where: { id: { in: companyIds.map((id: string) => parseInt(id)) } },
        select: { id: true, company_name: true }
      })
      return new Map(comps.map((c: any) => [c.id.toString(), c.company_name]))
    }),

    // Subcategories with caching
    getCachedLookupData(`subcategories_${Array.from(allSubcategoryIds).join(',')}`, async () => {
      if (allSubcategoryIds.size === 0) return new Map()
      const subs = await prisma.product_subcategory.findMany({
        where: { id: { in: Array.from(allSubcategoryIds).map((id: string) => parseInt(id)) } },
        select: { id: true, subcategory_name: true }
      })
      return new Map(subs.map((s: any) => [s.id.toString(), s.subcategory_name]))
    }),

    // FIXED: Single query for all purchase rates using raw SQL for better performance
    getPurchaseRatesOptimized(productIds)
  ])

  // Build enhanced products using cached lookup maps
  return products.map(product => {
    const categoryName = categoriesMap.get(product.product_category || '') || product.product_category
    const companyName = companiesMap.get(product.company || '') || product.company
    
    // Get subcategory names
    const subcategoryNames: string[] = []
    if (product.product_subcategory) {
      const subcategoryIds = product.product_subcategory.split(',').filter((id: string) => id.trim())
      subcategoryIds.forEach((id: string) => {
        const name = subcategoriesMap.get(id.trim())
        if (name) subcategoryNames.push(name)
      })
    }

    // Get latest purchase rate
    const latestPurchaseRate = latestPurchaseRates.get(product.id.toString()) || product.rate

    return {
      ...product,
      categoryName,
      companyName,
      subcategoryNames: subcategoryNames.join(', '),
      latestPurchaseRate
    }
  })
}

// OPTIMIZED: Get all purchase rates efficiently using Prisma groupBy and batch queries
async function getPurchaseRatesOptimized(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map()
  
  try {
    // Get latest purchase for each product using a more efficient approach
    // This uses a single query with proper ordering and grouping
    const latestPurchases = await prisma.$queryRaw`
      SELECT DISTINCT
        pi.name_of_product,
        pi.rate,
        pi.invoice_date
      FROM purchase_items pi
      INNER JOIN (
        SELECT 
          name_of_product,
          MAX(invoice_date) as max_date
        FROM purchase_items 
        WHERE name_of_product IN (${productIds.map(id => `'${id}'`).join(',')})
        GROUP BY name_of_product
      ) latest ON pi.name_of_product = latest.name_of_product 
                 AND pi.invoice_date = latest.max_date
      ORDER BY pi.name_of_product
    ` as any[]

    return new Map(latestPurchases.map((r: any) => [r.name_of_product, r.rate]))
  } catch (error) {
    console.error('Raw SQL query failed, using safer Prisma approach:', error)
    
    // Fallback: Use batch Prisma queries (still efficient, just not raw SQL)
    const ratesMap = new Map<string, number>()
    
    // Process in smaller batches to avoid overwhelming the database
    const batchSize = 20
    for (let i = 0; i < productIds.length; i += batchSize) {
      const batch = productIds.slice(i, i + batchSize)
      
      // Get latest purchase for each product in this batch
      const latestRates = await Promise.all(
        batch.map(async (productId) => {
          try {
            const latest = await prisma.purchaseitems.findFirst({
              where: { name_of_product: productId },
              orderBy: { invoice_date: 'desc' },
              select: { rate: true }
            })
            return [productId, latest?.rate || null]
          } catch (e) {
            return [productId, null]
          }
        })
      )
      
      // Add to map (only if rate exists)
      latestRates.forEach(([productId, rate]) => {
        if (rate !== null) {
          ratesMap.set(productId as string, rate as number)
        }
      })
    }
    
    return ratesMap
  }
}
