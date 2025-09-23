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

      // Convert category name to ID for database filtering
      if (category && category !== '') {
        const categoryRecord = await prisma.product_category.findFirst({
          where: { category_name: category as string },
          select: { id: true }
        });
        if (categoryRecord) {
          where.product_category = categoryRecord.id.toString()
        }
      }

      // Convert company name to ID for database filtering
      if (company && company !== '') {
        const companyRecord = await prisma.product_company.findFirst({
          where: { company_name: company as string },
          select: { id: true }
        });
        if (companyRecord) {
          where.company = companyRecord.id.toString()
        }
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
        // Convert subcategory name to ID for filtering
        const subcategoryRecord = await prisma.product_subcategory.findFirst({
          where: { subcategory_name: subcategory as string },
          select: { id: true }
        });
        if (subcategoryRecord) {
          allProducts = allProducts.filter((product: any) =>
            product.product_subcategory &&
            product.product_subcategory.split(',').some((id: string) => id.trim() === subcategoryRecord.id.toString())
          )
        }
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

      // Convert category name to ID for database filtering
      if (category && category !== '') {
        const categoryRecord = await prisma.product_category.findFirst({
          where: { category_name: category as string },
          select: { id: true }
        });
        if (categoryRecord) {
          where.product_category = categoryRecord.id.toString()
        }
      }

      // Convert company name to ID for database filtering
      if (company && company !== '') {
        const companyRecord = await prisma.product_company.findFirst({
          where: { company_name: company as string },
          select: { id: true }
        });
        if (companyRecord) {
          where.company = companyRecord.id.toString()
        }
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

  // Get category and company IDs to look up names
  const categoryIds = Array.from(new Set(products.map(p => p.product_category).filter(Boolean).map(id => parseInt(id as string)).filter(id => !isNaN(id))))
  const companyIds = Array.from(new Set(products.map(p => p.company).filter(Boolean).map(id => parseInt(id as string)).filter(id => !isNaN(id))))

  // Get all subcategory IDs from comma-separated values
  const subcategoryIds = new Set<number>()
  products.forEach((product: any) => {
    if (product.product_subcategory) {
      product.product_subcategory.split(',').forEach((id: string) => {
        const parsedId = parseInt(id.trim());
        if (!isNaN(parsedId)) subcategoryIds.add(parsedId);
      })
    }
  })

  // Batch fetch category, company, and subcategory names
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
  ]);

  // Create lookup maps
  const categoryMap = new Map(categoryRecords.map(cat => [cat.id.toString(), cat.category_name]));
  const companyMap = new Map(companyRecords.map(comp => [comp.id.toString(), comp.company_name]));
  const subcategoryMap = new Map(subcategoryRecords.map(sub => [sub.id.toString(), sub.subcategory_name]));

  // Get purchase rates
  const latestPurchaseRates = await getPurchaseRatesOptimized(productIds)

  // Build enhanced products with proper names
  return products.map(product => {
    // Look up names from the maps
    const categoryName = product.product_category ? categoryMap.get(product.product_category) || '' : '';
    const companyName = product.company ? companyMap.get(product.company) || '' : '';

    // Convert subcategory IDs to names
    let subcategoryNames = '';
    if (product.product_subcategory) {
      const subcategoryNameList = product.product_subcategory
        .split(',')
        .map((id: string) => {
          const trimmedId = id.trim();
          return subcategoryMap.get(trimmedId) || ''; // no fallback to ID if name not found
        })
        .filter(name => name) // remove empty names
        .sort((a, b) => a.localeCompare(b)); // sort alphabetically

      subcategoryNames = subcategoryNameList.join(', ');
    }

    // Get latest purchase rate
    const latestPurchaseRate = latestPurchaseRates.get(product.id.toString()) || product.rate

    return {
      ...product,
      categoryName,
      companyName,
      subcategoryNames,
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
