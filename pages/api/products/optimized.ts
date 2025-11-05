import type { NextApiRequest, NextApiResponse } from 'next'
import { format } from 'date-fns'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'

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

// Search normalization function
function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '') // Remove all whitespace
    .replace(/[^a-z0-9]/g, '') // Remove special characters except alphanumeric
}

function createSearchableText(productName: string, partNo: string): string {
  const normalizedProductName = productName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Keep letters, numbers, spaces, and hyphens
    .replace(/\s+/g, '') // Remove spaces
    .replace(/-/g, '') // Remove hyphens for searching

  const normalizedPartNo = partNo
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '') // Remove all whitespace
    .replace(/[^a-z0-9]/g, '') // Remove special characters

  return `${normalizedProductName} ${normalizedPartNo}`.trim()
}

async function handler(
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
      subcategory = '', // Filters actual subcategories
      model = '', // NEW: Filters car models (comma-separated IDs)
      company_id = '',
      quantity = '', // NEW: Filter by exact quantity/stock
      lowStock = 'false',
      startDate = '',
      endDate = '',
      uid = '', // NEW: Filter by product ID
      part_no = '', // NEW: Filter by part number
      sortBy = 'categoryName', // NEW: Sort field (default: categoryName)
      sortOrder = 'asc' // NEW: Sort order (default: asc)
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)

    // Validate and set sort parameters
    const validSortFields = ['id', 'product_name', 'part_no', 'stock', 'rate', 'lastPurchaseDate', 'categoryName', 'companyName', 'subcategoryName']
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'categoryName'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    // Parse date filters - convert to Unix timestamps for comparison with last_purchase_date
    let startDateTimestamp: number | undefined
    let endDateTimestamp: number | undefined

    if (startDate && startDate !== '') {
      // Convert date string (YYYY-MM-DD or DD/MM/YYYY) to Unix timestamp
      const date = new Date(startDate as string)
      if (!isNaN(date.getTime())) {
        startDateTimestamp = Math.floor(date.getTime() / 1000)
      }
    }

    if (endDate && endDate !== '') {
      // Convert date string to Unix timestamp and set to end of day
      const date = new Date(endDate as string)
      if (!isNaN(date.getTime())) {
        date.setHours(23, 59, 59, 999) // End of day
        endDateTimestamp = Math.floor(date.getTime() / 1000)
      }
    }

    // Handle complex filtering that requires post-processing
    const needsPostFiltering = lowStock === 'true' || (subcategory && subcategory !== '') || (model && model !== '') || (startDateTimestamp || endDateTimestamp) || (quantity && quantity !== '')

    if (needsPostFiltering) {
      // For complex filters, get all matching products first
      const where: any = {}

      // Handle UID filtering
      if (uid && uid !== '') {
        where.id = parseInt(uid as string)
      }

      if (search) {
        const normalizedSearch = normalizeSearchText(search as string)
        where.OR = [
          // Original search for exact matches
          { product_name: { contains: search as string } },
          { display_name: { contains: search as string } },
          { part_no: { contains: search as string } },
          // Normalized search for flexible matching
          {
            product_name: {
              contains: normalizedSearch
            }
          },
          {
            display_name: {
              contains: normalizedSearch
            }
          },
          {
            part_no: {
              contains: normalizedSearch
            }
          }
        ]
      }

      // Handle category filtering with ID directly
      if (category && category !== '') {
        where.product_category_id = parseInt(category as string)
      }

      // Handle company filtering with ID directly
      if (company_id && company_id !== '') {
        where.company_id = parseInt(company_id as string)
      }

      // Handle part_no filtering
      if (part_no && part_no !== '') {
        where.part_no = { contains: part_no as string }
      }

      // Get all products that match database filters (only active products)
      let allProducts = await prisma.product.findMany({
        where: {
          ...where,
          is_active: true,  // Only fetch active products
          // Apply date filtering at database level if possible
          ...(startDateTimestamp ? {
            last_purchase_date: { gte: startDateTimestamp }
          } : {}),
          ...(endDateTimestamp ? {
            last_purchase_date: { lte: endDateTimestamp }
          } : {}),
        },
        orderBy: { id: 'desc' },
      })

      // Create lookup maps for sorting (needed for category/company/subcategory names)
      const categoryIds = Array.from(new Set(allProducts.map(p => p.product_category_id).filter(Boolean)))
      const subcategoryIds = Array.from(new Set(allProducts.map(p => p.product_subcategory_id).filter(Boolean)))
      const companyIds = Array.from(new Set(allProducts.map(p => p.company_id).filter(Boolean)))

      const [categoryRecords, subcategoryRecords, companyRecords] = await Promise.all([
        categoryIds.length > 0 ? prisma.product_category.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, category_name: true }
        }) : Promise.resolve([]),
        subcategoryIds.length > 0 ? prisma.product_subcategory.findMany({
          where: { id: { in: subcategoryIds } },
          select: { id: true, subcategory_name: true }
        }) : Promise.resolve([]),
        companyIds.length > 0 ? prisma.product_company.findMany({
          where: { id: { in: companyIds } },
          select: { id: true, company_name: true }
        }) : Promise.resolve([])
      ]);

      const categoryMap = new Map(categoryRecords.map(cat => [cat.id, cat.category_name]));
      const subcategoryMap = new Map(subcategoryRecords.map(sub => [sub.id, sub.subcategory_name]));
      const companyMap = new Map(companyRecords.map(comp => [comp.id.toString(), comp.company_name]));

      // Apply post-filters
      if (lowStock === 'true') {
        allProducts = allProducts.filter((product: any) =>
          (product.stock || 0) < (product.min_stock || 0) || (product.stock || 0) < 2
        )
      }

      // Apply quantity filter (exact stock match)
      if (quantity && quantity !== '') {
        const quantityNum = parseInt(quantity as string);
        if (!isNaN(quantityNum)) {
          allProducts = allProducts.filter((product: any) =>
            (product.stock || 0) === quantityNum
          );
        }
      }

      // Apply date filtering as post-filter if needed (for products without last_purchase_date)
      if (startDateTimestamp || endDateTimestamp) {
        allProducts = allProducts.filter((product: any) => {
          const purchaseDate = product.last_purchase_date
          if (!purchaseDate) return !startDateTimestamp && !endDateTimestamp // Include if no dates specified

          if (startDateTimestamp && purchaseDate < startDateTimestamp) return false
          if (endDateTimestamp && purchaseDate > endDateTimestamp) return false
          return true
        })
      }

      if (subcategory && subcategory !== '') {
        // Convert car model name to ID for filtering
        const carModelRecord = await prisma.car_models.findFirst({
          where: { model_name: subcategory as string },
          select: { id: true }
        });
        if (carModelRecord) {
          allProducts = allProducts.filter((product: any) =>
            product.car_model_ids &&
            product.car_model_ids.split(',').some((id: string) => id.trim() === carModelRecord.id.toString())
          )
        }
      }

      // NEW: Handle multiple car model selection (comma-separated IDs)
      if (model && model !== '') {
        const selectedModelIds = (model as string).split(',').map(id => id.trim()).filter(id => id !== '');
        if (selectedModelIds.length > 0) {
          allProducts = allProducts.filter((product: any) =>
            product.car_model_ids &&
            product.car_model_ids.split(',').some((productModelId: string) =>
              selectedModelIds.some((selectedId: string) => productModelId.trim() === selectedId)
            )
          )
        }
      }

      // Get purchase rates for sorting (needed for rate and lastPurchaseDate sorting)
      const productIdsForSorting = allProducts.map(p => p.id.toString());
      const purchaseRatesForSorting = await getPurchaseRatesOptimized(productIdsForSorting);

      // Apply sorting before pagination
      allProducts.sort((a, b) => {
        let aValue: any;
        let bValue: any;

        // Get enhanced data for sorting (we need category names, etc.)
        const aCategoryName = a.product_category_id ? categoryMap.get(a.product_category_id) || '' : '';
        const bCategoryName = b.product_category_id ? categoryMap.get(b.product_category_id) || '' : '';
        const aCompanyName = a.company_id ? companyMap.get(a.company_id.toString()) || '' : '';
        const bCompanyName = b.company_id ? companyMap.get(b.company_id.toString()) || '' : '';
        const aSubcategoryName = a.product_subcategory_id ? subcategoryMap.get(a.product_subcategory_id) || '' : '';
        const bSubcategoryName = b.product_subcategory_id ? subcategoryMap.get(b.product_subcategory_id) || '' : '';

        switch (sortField) {
          case 'id':
            aValue = a.id || 0;
            bValue = b.id || 0;
            break;
          case 'product_name':
            aValue = a.product_name?.toString().toLowerCase() || '';
            bValue = b.product_name?.toString().toLowerCase() || '';
            break;
          case 'part_no':
            aValue = a.part_no?.toString().toLowerCase() || '';
            bValue = b.part_no?.toString().toLowerCase() || '';
            break;
          case 'stock':
            aValue = a.stock || 0;
            bValue = b.stock || 0;
            break;
          case 'rate':
            // Sort by latest purchase rate (same as UI displays)
            aValue = purchaseRatesForSorting.get(a.id.toString()) || a.opening_rate || 0;
            bValue = purchaseRatesForSorting.get(b.id.toString()) || b.opening_rate || 0;
            break;
          case 'lastPurchaseDate':
            aValue = a.last_purchase_date || 0;
            bValue = b.last_purchase_date || 0;
            break;
          case 'categoryName':
            aValue = aCategoryName.toLowerCase();
            bValue = bCategoryName.toLowerCase();
            break;
          case 'companyName':
            aValue = aCompanyName.toLowerCase();
            bValue = bCompanyName.toLowerCase();
            break;
          case 'subcategoryName':
            aValue = aSubcategoryName.toLowerCase();
            bValue = bSubcategoryName.toLowerCase();
            break;
          default:
            return 0;
        }

        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });

      // Apply pagination after filtering and sorting
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

      // Handle UID filtering
      if (uid && uid !== '') {
        where.id = parseInt(uid as string)
      }

      if (search) {
        const normalizedSearch = normalizeSearchText(search as string)
        where.OR = [
          // Original search for exact matches
          { product_name: { contains: search as string } },
          { display_name: { contains: search as string } },
          { part_no: { contains: search as string } },
          // Normalized search for flexible matching
          {
            product_name: {
              contains: normalizedSearch
            }
          },
          {
            display_name: {
              contains: normalizedSearch
            }
          },
          {
            part_no: {
              contains: normalizedSearch
            }
          }
        ]
      }

      // Handle category filtering with ID directly
      if (category && category !== '') {
        where.product_category_id = parseInt(category as string)
      }

      // Handle company filtering with ID directly
      if (company_id && company_id !== '') {
        where.company_id = parseInt(company_id as string)
      }

      // Handle part_no filtering
      if (part_no && part_no !== '') {
        where.part_no = { contains: part_no as string }
      }

      // Handle date filtering
      if (startDateTimestamp) {
        where.last_purchase_date = { gte: startDateTimestamp }
      }
      if (endDateTimestamp) {
        where.last_purchase_date = {
          ...where.last_purchase_date,
          lte: endDateTimestamp
        }
      }

      // Build orderBy based on sort field
      let orderBy: any;
      if (sortField === 'categoryName') {
        // Special handling for category sorting - need to join
        orderBy = {
          category_ref: {
            category_name: sortDirection
          }
        };
      } else if (sortField === 'companyName') {
        // Special handling for company sorting - need to join
        orderBy = {
          product_company_ref: {
            company_name: sortDirection
          }
        };
      } else if (sortField === 'subcategoryName') {
        // Special handling for subcategory sorting - need to join
        orderBy = {
          subcategory_ref: {
            subcategory_name: sortDirection
          }
        };
      } else if (sortField === 'rate') {
        // For rate sorting in simple path, sort by opening_rate (fallback when no purchase data)
        orderBy = { opening_rate: sortDirection };
      } else if (sortField === 'lastPurchaseDate') {
        // Map frontend field name to database field name
        orderBy = { last_purchase_date: sortDirection };
      } else {
        // Direct field sorting
        orderBy = { [sortField]: sortDirection };
      }

      // Get products with efficient pagination (only active products)
      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where: {
            ...where,
            is_active: true  // Only fetch active products
          },
          skip,
          take: limitNum,
          orderBy,
          include: sortField === 'categoryName' ? { category_ref: true } :
                  sortField === 'companyName' ? { product_company_ref: true } :
                  sortField === 'subcategoryName' ? { subcategory_ref: true } : undefined,
        }),
        prisma.product.count({
          where: {
            ...where,
            is_active: true  // Only count active products
          }
        }),
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

  // Get foreign key IDs using new relationships - handle comma-separated car models
  const categoryIds = Array.from(new Set(products.map(p => p.product_category_id).filter(Boolean)))
  const subcategoryIds = Array.from(new Set(products.map(p => p.product_subcategory_id).filter(Boolean)))
  const carModelIds = Array.from(new Set(
    products.flatMap(p =>
      p.car_model_ids ?
        p.car_model_ids.split(',').map((id: string) => parseInt(id.trim())).filter((id: any) => !isNaN(id))
        : []
    )
  ))
  const companyIds = Array.from(new Set(products.map(p => p.company_id).filter(Boolean)))

  // Batch fetch names using foreign key relationships
  const [categoryRecords, subcategoryRecords, carModelRecords, companyRecords] = await Promise.all([
    categoryIds.length > 0 ? prisma.product_category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, category_name: true }
    }) : Promise.resolve([]),
    subcategoryIds.length > 0 ? prisma.product_subcategory.findMany({
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
  ]);

  // Create lookup maps
  const categoryMap = new Map(categoryRecords.map(cat => [cat.id, cat.category_name])); // Use category_name
  const subcategoryMap = new Map(subcategoryRecords.map(sub => [sub.id, sub.subcategory_name]));
  const carModelMap = new Map(carModelRecords.map(model => [model.id, model.model_name]));
  const companyMap = new Map(companyRecords.map(comp => [comp.id.toString(), comp.company_name]));

  // Get purchase rates
  const latestPurchaseRates = await getPurchaseRatesOptimized(productIds)

  // Build enhanced products with proper names - OPTIMIZED to only include UI-required fields
  return products.map(product => {
    // Look up names using foreign key maps
    const categoryName = product.product_category_id ? categoryMap.get(product.product_category_id) || '' : '';
    const subcategoryName = product.product_subcategory_id ? subcategoryMap.get(product.product_subcategory_id) || '' : '';

    // Handle comma-separated car model IDs
    let carModelNames: string[] = [];
    if (product.car_model_ids) {
      const modelIds = product.car_model_ids.split(',').map((id: string) => parseInt(id.trim())).filter((id: any) => !isNaN(id));
      carModelNames = modelIds.map(id => carModelMap.get(id)).filter(Boolean) as string[];
    }

    // UI expects: subcategoryName (combined) and carModelsDisplay (separate)
    const carModelsDisplay = carModelNames.join(', ') || undefined;

    // Get latest purchase rate
    const latestPurchaseRate = latestPurchaseRates.get(product.id.toString()) || product.opening_rate || 0;
    const rate = latestPurchaseRate; // For UI compatibility

    // OPTIMIZATION: Only include fields that are actually used in the UI
    // Added pic and barcode for Media column visual cues
    return {
      id: product.id,
      product_name: product.product_name,
      stock: product.stock || 0,
      min_stock: product.min_stock || 0,
      rate,
      part_no: product.part_no || '',
      categoryName,
      company_id: product.company_id || undefined,
      companyName: product.company_id ? companyMap.get(product.company_id.toString()) || '' : '',
      subcategoryName: subcategoryName || undefined, // UI expects singular form
      carModelsDisplay, // UI expects this separate field for car models column
      latestPurchaseRate,
      lastPurchaseDate: product.last_purchase_date ? format(new Date(product.last_purchase_date * 1000), 'dd/MM/yyyy') : '-',
      pic: product.pic || undefined, // ✅ Added for Media column
      barcode: product.barcode || undefined, // ✅ Added for Media column
      index: undefined // Will be set by frontend

      // OPTIMIZATION: Commented out unused product fields - uncomment if needed
      // ...product, // All base product fields are unused by UI
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
        pi.product_id,
        pi.rate,
        pi.invoice_date
      FROM purchase_items pi
      INNER JOIN (
        SELECT
          product_id,
          MAX(invoice_date) as max_date
        FROM purchase_items
        WHERE product_id IN (${productIds.map(id => `'${id}'`).join(',')})
        GROUP BY product_id
      ) latest ON pi.product_id = latest.product_id
                 AND pi.invoice_date = latest.max_date
      ORDER BY pi.product_id
    ` as any[]

    return new Map(latestPurchases.map((r: any) => [r.product_id.toString(), r.rate]))
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
              where: { product_id: parseInt(productId) },
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

export default withObservability(handler)
