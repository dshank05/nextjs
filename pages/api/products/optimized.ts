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

// Columns the search box may match against. A column name cannot be passed as a
// SQL parameter, so the raw-SQL path whitelists it instead of interpolating
// whatever key turns up in the `where` clause.
const SEARCHABLE_COLUMNS = ['product_name', 'display_name', 'part_no'];

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
      fetchAll = 'false',
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
    const isFetchAll = fetchAll === 'true'


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

    // 🔥 PHASE 2 OPTIMIZATION: Move ALL filtering to database level
    // Build comprehensive WHERE clause for database-level filtering
    const where: any = {
      is_active: true  // Always filter active products
    }

    // Handle UID filtering
    if (uid && uid !== '') {
      where.id = parseInt(uid as string)
    }

    // Handle search with normalized text
    if (search) {
      const normalizedSearch = normalizeSearchText(search as string)
      where.OR = [
        { product_name: { contains: search as string } },
        { display_name: { contains: search as string } },
        { part_no: { contains: search as string } },
        { product_name: { contains: normalizedSearch } },
        { display_name: { contains: normalizedSearch } },
        { part_no: { contains: normalizedSearch } }
      ]
    }

    // Handle category filtering
    if (category && category !== '') {
      where.product_category_id = parseInt(category as string)
    }

    // Handle company filtering
    if (company_id && company_id !== '') {
      where.company_id = parseInt(company_id as string)
    }

    // Handle part_no filtering
    if (part_no && part_no !== '') {
      where.part_no = { contains: part_no as string }
    }

    // Handle low stock filter (database level)
    if (lowStock === 'true') {
      // Use raw SQL for complex stock conditions since Prisma doesn't support field comparisons
      // This will be handled in the main query
    }

    // Handle quantity filter (exact stock match)
    if (quantity && quantity !== '') {
      const quantityNum = parseInt(quantity as string);
      if (!isNaN(quantityNum)) {
        where.stock = quantityNum;
      }
    }

    // Handle date filtering at database level
    if (startDateTimestamp) {
      where.last_purchase_date = { gte: startDateTimestamp }
    }
    if (endDateTimestamp) {
      where.last_purchase_date = where.last_purchase_date ?
        { ...where.last_purchase_date, lte: endDateTimestamp } :
        { lte: endDateTimestamp }
    }

    // Handle car model filtering (convert name to ID first)
    let carModelId: number | undefined;
    if (subcategory && subcategory !== '') {
      const carModelRecord = await prisma.car_models.findFirst({
        where: { model_name: subcategory as string },
        select: { id: true }
      });
      carModelId = carModelRecord?.id;
    }

    // Handle single car model selection
    let hasModelFilter = false;
    if (model && model !== '') {
      const selectedModelId = (model as string).trim();
      if (selectedModelId) {
        hasModelFilter = true;
      }
    }

    // Determine if we need special handling for complex filters
    const needsSpecialHandling = lowStock === 'true' || carModelId || hasModelFilter;


    let products: any[];
    let total: number;


    if (needsSpecialHandling) {
      // For complex filters that require raw SQL, get all matching products
      // Raw SQL is only needed for the filters Prisma cannot express: low-stock
      // (a column-to-column comparison) and car-model matching against the
      // comma-joined `car_model_ids` string.
      //
      // Every user-supplied value goes in as a `?` parameter. It used to be
      // interpolated straight into the string, which was injectable through the
      // search box (F-11).
      const params: any[] = [];
      // The joins exist purely so the raw path can sort by the same fields the
      // Prisma path sorts by. They are LEFT JOINs on indexed foreign keys, and
      // only p.* is selected, so nothing else changes.
      let rawQuery = `
        SELECT p.* FROM product p
        LEFT JOIN product_category pc ON p.product_category_id = pc.id
        LEFT JOIN product_subcategory psc ON p.product_subcategory_id = psc.id
        LEFT JOIN product_company pcm ON p.company_id = pcm.id
        WHERE p.is_active = true
      `;

      if (where.id) { rawQuery += ` AND p.id = ?`; params.push(where.id); }
      if (where.product_category_id) { rawQuery += ` AND p.product_category_id = ?`; params.push(where.product_category_id); }
      if (where.company_id) { rawQuery += ` AND p.company_id = ?`; params.push(where.company_id); }
      if (where.stock !== undefined) { rawQuery += ` AND p.stock = ?`; params.push(where.stock); }
      if (where.last_purchase_date?.gte) { rawQuery += ` AND p.last_purchase_date >= ?`; params.push(where.last_purchase_date.gte); }
      if (where.last_purchase_date?.lte) { rawQuery += ` AND p.last_purchase_date <= ?`; params.push(where.last_purchase_date.lte); }

      // Search conditions.
      //
      // LIKE, not ILIKE. ILIKE is Postgres-only and this database is MySQL, so
      // the query threw `Raw query failed` on every search combined with a
      // low-stock or car-model filter - the product list simply failed to load
      // (F-11). MySQL's default collation is case-insensitive, so LIKE gives
      // the case-insensitive match that was intended.
      if (where.OR) {
        const searchConditions = where.OR.map((condition: any) => {
          const field = Object.keys(condition)[0];
          const value = condition[field].contains;
          // The column name cannot be a parameter, so it is whitelisted instead.
          if (!SEARCHABLE_COLUMNS.includes(field)) return null;
          params.push(`%${value}%`);
          return `p.\`${field}\` LIKE ?`;
        }).filter(Boolean).join(' OR ');
        if (searchConditions) rawQuery += ` AND (${searchConditions})`;
      }

      // Low stock condition
      if (lowStock === 'true') {
        // "Low stock" means below the minimum someone actually set for the
        // product. A min_stock of 0 or NULL means no minimum was defined, so
        // the product cannot be below it.
        //
        // This used to read `stock < min_stock OR stock < 2`. The second half
        // was a workaround for min_stock being unset across the catalogue - it
        // made the filter return something, but that something was every
        // product with 0 or 1 in stock: 362 of 602 here, which is noise, not a
        // reorder list. Two other places in the app already used the strict
        // rule, so the filter, the Low Stock page and the minimum-stock report
        // each gave a different answer (F-70).
        rawQuery += ` AND p.min_stock IS NOT NULL AND p.min_stock > 0 AND p.stock < p.min_stock`;
      }

      // Car model conditions.
      //
      // `car_model_ids` is a comma-joined list, so a match is any of four
      // positions: middle, first, last, or the only value. The whole disjunction
      // must be parenthesised - without the brackets the ORs broke out of the
      // enclosing AND chain and the filter returned the entire catalogue (F-17).
      const CAR_MODEL_CLAUSE =
        '(p.car_model_ids LIKE ? OR p.car_model_ids LIKE ? OR p.car_model_ids LIKE ? OR p.car_model_ids = ?)';
      const carModelParams = (id: string | number) => [`%,${id},%`, `${id},%`, `%,${id}`, String(id)];

      if (carModelId) {
        rawQuery += ` AND ${CAR_MODEL_CLAUSE}`;
        params.push(...carModelParams(carModelId));
      }

      if (model && model !== '') {
        const selectedModelIds = (model as string).split(',').map(id => id.trim()).filter(id => id !== '');
        if (selectedModelIds.length) {
          rawQuery += ` AND (${selectedModelIds.map(() => CAR_MODEL_CLAUSE).join(' OR ')})`;
          selectedModelIds.forEach(id => params.push(...carModelParams(id)));
        }
      }

      // Get total count - same WHERE, same parameters, before ORDER BY/LIMIT.
      const countQuery = `SELECT COUNT(*) as count FROM (${rawQuery}) as filtered_products`;
      const totalResult = await prisma.$queryRawUnsafe(countQuery, ...params) as any[];
      total = parseInt(totalResult[0].count);

      // Add sorting and pagination. Sort field and direction are whitelisted
      // above, so they are safe to interpolate; LIMIT/OFFSET are parameterised.
      // Every sort the Prisma path supports must be supported here too.
      //
      // Four of them were missing, and one of the four - categoryName - is the
      // LIST PAGE'S DEFAULT SORT. So applying a low-stock or car-model filter
      // silently dropped the sort back to `p.id DESC` while the column header
      // still showed the list as sorted (F-62).
      const RAW_SORT_COLUMNS: Record<string, string> = {
        product_name: 'p.product_name',
        part_no: 'p.part_no',
        stock: 'p.stock',
        lastPurchaseDate: 'p.last_purchase_date',
        rate: 'p.opening_rate',
        categoryName: 'pc.category_name',
        subcategoryName: 'psc.subcategory_name',
        companyName: 'pcm.company_name'
      };

      // sortDirection is already constrained to asc/desc, and the column comes
      // from this map, so neither can carry anything injectable.
      const sortColumn = RAW_SORT_COLUMNS[sortField as string];
      const orderByClause = sortColumn ? `${sortColumn} ${sortDirection}` : 'p.id DESC';

      rawQuery += ` ORDER BY ${orderByClause}`;

      if (!isFetchAll) {
        rawQuery += ` LIMIT ? OFFSET ?`;
        params.push(limitNum, (pageNum - 1) * limitNum);
      }

      products = await prisma.$queryRawUnsafe(rawQuery, ...params) as any[];
    } else {
      // Simple case - use Prisma's efficient pagination
      const skip = isFetchAll ? 0 : (pageNum - 1) * limitNum;
      const take = isFetchAll ? undefined : limitNum;

      // Build orderBy based on sort field
      let orderBy: any;
      if (sortField === 'categoryName') {
        orderBy = { category_ref: { category_name: sortDirection } };
      } else if (sortField === 'companyName') {
        orderBy = { product_company_ref: { company_name: sortDirection } };
      } else if (sortField === 'subcategoryName') {
        orderBy = { subcategory_ref: { subcategory_name: sortDirection } };
      } else if (sortField === 'rate') {
        orderBy = { opening_rate: sortDirection };
      } else if (sortField === 'lastPurchaseDate') {
        orderBy = { last_purchase_date: sortDirection };
      } else {
        orderBy = { [sortField]: sortDirection };
      }

      // Get products with efficient pagination
      const [productsResult, totalResult] = await Promise.all([
        prisma.product.findMany({
          where,
          skip,
          take,
          orderBy,
          include: sortField === 'categoryName' ? { category_ref: true } :
                  sortField === 'companyName' ? { product_company_ref: true } :
                  sortField === 'subcategoryName' ? { subcategory_ref: true } : undefined,
        }),
        prisma.product.count({ where })
      ]);

      products = productsResult;
      total = totalResult;
    }




    // 🔥 PHASE 3 OPTIMIZATION: Batch all related data queries
    // Get all required lookup data in parallel for better performance
    const categoryIds = Array.from(new Set(products.map(p => p.product_category_id).filter(Boolean)));
    const subcategoryIds = Array.from(new Set(products.map(p => p.product_subcategory_id).filter(Boolean)));
    const carModelIds = Array.from(new Set(
      products.flatMap(p =>
        p.car_model_ids ?
          p.car_model_ids.split(',').map((id: string) => parseInt(id.trim())).filter((id: any) => !isNaN(id))
          : []
      )
    ));
    const companyIds = Array.from(new Set(products.map(p => p.company_id).filter(Boolean)));
    const productIds = products.map(p => p.id.toString());


    // Single batch query for all lookup data
    const [categoryRecords, subcategoryRecords, carModelRecords, companyRecords, purchaseRates] = await Promise.all([
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
      }) : Promise.resolve([]),
      getPurchaseRatesOptimized(productIds)
    ]);


    // Create efficient lookup maps
    const categoryMap = new Map(categoryRecords.map(cat => [cat.id, cat.category_name]));
    const subcategoryMap = new Map(subcategoryRecords.map(sub => [sub.id, sub.subcategory_name]));
    const carModelMap = new Map(carModelRecords.map(model => [model.id, model.model_name]));
    const companyMap = new Map(companyRecords.map(comp => [comp.id.toString(), comp.company_name]));

    // Build final enhanced products (no additional queries needed)
    const enhancedProducts = products.map(product => {
      const categoryName = product.product_category_id ? categoryMap.get(product.product_category_id) || '' : '';
      const subcategoryName = product.product_subcategory_id ? subcategoryMap.get(product.product_subcategory_id) || '' : '';

      let carModelNames: string[] = [];
      if (product.car_model_ids) {
        const modelIds = product.car_model_ids.split(',').map((id: string) => parseInt(id.trim())).filter((id: any) => !isNaN(id));
        carModelNames = modelIds.map(id => carModelMap.get(id)).filter(Boolean) as string[];
      }

      const carModelsDisplay = carModelNames.join(', ') || undefined;
      const latestPurchaseRate = purchaseRates.get(product.id.toString()) || product.latest_purchase_rate || product.opening_rate || 0;

      return {
        id: product.id,
        product_name: product.product_name,
        stock: product.stock || 0,
        min_stock: product.min_stock || 0,
        rate: latestPurchaseRate,
        part_no: product.part_no || '',
        product_category_id: product.product_category_id || undefined,
        categoryName,
        product_subcategory_id: product.product_subcategory_id || undefined,
        subcategoryName: subcategoryName || undefined,
        company_id: product.company_id || undefined,
        companyName: product.company_id ? companyMap.get(product.company_id.toString()) || '' : '',
        car_model_ids: product.car_model_ids || undefined,
        carModelsDisplay,
        latestPurchaseRate,
        lastPurchaseDate: product.last_purchase_date ? format(new Date(product.last_purchase_date * 1000), 'dd/MM/yyyy') : '-',
        pic: product.pic || undefined,
        barcode: product.barcode || undefined,
        index: undefined
      };
    });

    const totalPages = Math.ceil(total / limitNum);


    res.status(200).json({
      products: enhancedProducts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    });

  } catch (error) {
    console.error('[PRODUCTS OPTIMIZED API] Error occurred:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      query: req.query,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({
      message: 'Failed to fetch optimized products',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}



// ULTRA OPTIMIZED: Get all purchase rates in a single efficient query
async function getPurchaseRatesOptimized(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map()

  try {
    // Convert string IDs to numbers for proper Prisma querying
    const numericIds = productIds.map(id => parseInt(id)).filter(id => !isNaN(id));

    if (numericIds.length === 0) return new Map();

    // 🔥 SINGLE EFFICIENT QUERY: Get latest purchase rates for all products at once
    // Uses window function approach with ROW_NUMBER() to get the latest record per product
    const latestPurchases = await prisma.$queryRaw`
      SELECT DISTINCT
        pi.product_id,
        pi.rate
      FROM (
        SELECT
          product_id,
          rate,
          ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY invoice_date DESC, rate DESC) as rn
        FROM purchase_items
        WHERE product_id IN (${numericIds.join(',')})
          AND rate > 0
      ) pi
      WHERE pi.rn = 1
    ` as any[];

    // Build result map from single query results
    const resultMap = new Map<string, number>();
    latestPurchases.forEach((record: any) => {
      resultMap.set(record.product_id.toString(), record.rate);
    });

    return resultMap;

  } catch (e) {
    // Fallback: try to get data directly from product table
    try {
      const products = await prisma.product.findMany({
        where: { id: { in: productIds.map(id => parseInt(id)).filter(id => !isNaN(id)) } },
        select: {
          id: true,
          latest_purchase_rate: true,
        }
      });

      const fallbackMap = new Map<string, number>();
      products.forEach(p => {
        if (p.latest_purchase_rate) {
          fallbackMap.set(p.id.toString(), p.latest_purchase_rate);
        }
      });

      return fallbackMap;

    } catch (fallbackError) {
      return new Map(); // final fallback
    }
  }
}

export default withObservability(handler)
