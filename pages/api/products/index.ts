import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { validateProduct, findConflictingPartNo, buildProductData, partNoConflictMessage } from '../../../lib/product';
import { withObservability } from '../../../lib/withObservability';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { Client } from 'basic-ftp';

// ==================== Helper: Upload file to Hostinger FTP ====================
async function uploadFileToStorage(file: formidable.File): Promise<string | null> {
  const client = new Client();

  try {
    // Connect to FTP server
    await client.access({
      host: process.env.FTP_HOST,
      port: parseInt(process.env.FTP_PORT) || 21,
      user: process.env.FTP_USERNAME,
      password: process.env.FTP_PASSWORD,
      secure: false // Regular FTP, not FTPS
    });

    // Ensure remote directory exists
    await client.ensureDir('/public_html/uploads');

    // Generate unique filename
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const originalName = file.originalFilename || 'unknown';
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext).replace(/[^a-zA-Z0-9]/g, '_');
    const uniqueName = `${base}_${timestamp}_${random}${ext}`;

    // Upload file
    await client.uploadFrom(file.filepath, `/public_html/uploads/${uniqueName}`);

    // Clean up local temp file
    fs.unlink(file.filepath, (err) => {
      // Kept as an error, not dropped with the debug logging: a temp file that
      // will not delete is a real condition worth seeing in the logs.
      if (err) console.error('Failed to remove temp upload file:', file.filepath, err);
    });

    const hostingerDomain = process.env.HOSTINGER_DOMAIN || 'https://baijnathsons.com';
    const publicUrl = `${hostingerDomain}/uploads/${uniqueName}`;

    return publicUrl;
  } catch (error) {
    console.error('FTP upload error:', error);
    throw error;
  } finally {
    // Always close the connection
    client.close();
  }
}

// ---------------------
// Helper: Promisify Formidable parsing
// ---------------------
function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  return new Promise((resolve, reject) => {

    const form = formidable({
      keepExtensions: true,
      maxFileSize: 5 * 1024 * 1024,
      filter: (part) => ['image/jpeg','image/png','image/gif','image/webp'].includes(part.mimetype || ''),
    });


    // Add timeout
    const timeout = setTimeout(() => {
      console.error('FORMIDABLE: TIMEOUT - Parsing took longer than 30 seconds');
      reject(new Error('Form parsing timeout'));
    }, 30000); // 30 second timeout

    form.on('field', (name, value) => {
    });

    form.on('fileBegin', (name, file) => {
    });

    form.on('file', (name, file) => {
    });

    form.on('progress', (bytesReceived, bytesExpected) => {
    });

    form.on('error', (err) => {
      console.error('FORMIDABLE: Error occurred:', err);
      clearTimeout(timeout);
      reject(err);
    });

    form.on('end', () => {
      clearTimeout(timeout);
    });

    form.parse(req, (err, fields, files) => {
      clearTimeout(timeout);
      if (err) {
        console.error('FORMIDABLE: Parse callback error:', err);
        return reject(err);
      }
      resolve({ fields, files });
    });
  });
}

// ---------------------
// GET handler: Paginated products
// ---------------------
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      page = '1',
      limit = '50',
      fetchAll = 'false',
      search = '',
      category = '',
      includeInactive = 'false',
      categoryFilter = '',
      subcategoryFilter = '',
      modelFilter = '',
      companyFilter = '',
      quantityFilter = '',
      stockFilter = 'all',
      startDate = '',
      endDate = '',
      uidFilter = '',
      partNoFilter = ''
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const isFetchAll = fetchAll === 'true';
    const skip = isFetchAll ? 0 : (pageNum - 1) * limitNum;
    const actualLimit = isFetchAll ? undefined : limitNum;

    const where: any = {};
    if (includeInactive !== 'true') where.is_active = true;

    // Handle search term - search across multiple fields for comprehensive results
    // MySQL's default collation is case-insensitive, so this will work automatically
    if (search) {
      const term = (search as string).trim();
      // Search across display_name, product_name, and part_no for maximum coverage
      where.OR = [
        { display_name: { contains: term } }, // UID + car model + category + subcategory + company + part_no
        { product_name: { contains: term } }, // Direct product name search
        { part_no: { contains: term } }       // Direc  t part number search
      ];
    }

    // Handle category filter (legacy support)
    if (category) where.product_category_id = parseInt(category as string);

    // Handle advanced filters from ProductTable
    if (categoryFilter) where.product_category_id = parseInt(categoryFilter as string);
    if (subcategoryFilter) where.product_subcategory_id = parseInt(subcategoryFilter as string);
    if (companyFilter) where.company_id = parseInt(companyFilter as string);
    if (partNoFilter) where.part_no = { contains: partNoFilter as string };
    if (uidFilter) where.id = parseInt(uidFilter as string);

    // Handle quantity filter (stock filtering)
    if (quantityFilter) {
      const quantity = parseInt(quantityFilter as string);
      if (!isNaN(quantity)) {
        where.stock = quantity;
      }
    }

    // Handle stock status filter
    if (stockFilter && stockFilter !== 'all') {
      switch (stockFilter) {
        case 'in_stock':
          where.stock = { gt: 0 };
          break;
        case 'out_of_stock':
          // <= 0, not = 0. Stock can be negative - product 211 sits at -1
          // today (F-73) - and a product you cannot sell is out of stock
          // whether it reads 0 or -1. /api/products/optimized uses the same
          // rule so the two endpoints agree.
          where.stock = { lte: 0 };
          break;
        case 'low_stock':
          // Low stock: stock > 0 AND stock <= min_stock
          // This will be handled with raw SQL in the query
          break;
      }
    }

    // Handle car model filter (single selection) with Prisma
    if (modelFilter && (modelFilter as string).trim()) {
      const modelId = (modelFilter as string).trim();
      const modelConditions = [
        { car_model_ids: { contains: `,${modelId},` } }, // middle: ,1,
        { car_model_ids: { startsWith: `${modelId},` } }, // start: 1,
        { car_model_ids: { endsWith: `,${modelId}` } },   // end: ,1
        { car_model_ids: { equals: modelId } }            // exact: 1
      ];

      // If there's already an OR condition (from search), combine with AND
      if (where.OR) {
        where.AND = [
          { OR: where.OR }, // existing search conditions
          { OR: modelConditions } // model filter conditions
        ];
        delete where.OR; // Remove the OR since we're using AND now
      } else {
        // No search conditions, just use model conditions
        where.OR = modelConditions;
      }
    }

    // Handle date range filters.
    //
    // This filtered on `created_at`, a column the Product model did not have,
    // so any request carrying startDate or endDate died inside Prisma with an
    // "unknown argument" error - a hard 500 on the main list endpoint (F-93).
    //
    // Product does have created_at now (F-82), but the range is applied to
    // `last_purchase_date` because that is what /api/products/optimized has
    // always filtered on, and what the list page's Date Range control means
    // sitting next to its Last Purchase Date column. Two endpoints answering
    // the same question differently is exactly how F-43 and F-70 happened.
    const toUnixSeconds = (value: string, endOfDay = false): number | undefined => {
      const date = new Date(value);
      if (isNaN(date.getTime())) return undefined;
      if (endOfDay) date.setHours(23, 59, 59, 999);
      return Math.floor(date.getTime() / 1000);
    };
    if (startDate || endDate) {
      const range: any = {};
      const gte = startDate ? toUnixSeconds(startDate as string) : undefined;
      const lte = endDate ? toUnixSeconds(endDate as string, true) : undefined;
      if (gte !== undefined) range.gte = gte;
      if (lte !== undefined) range.lte = lte;
      if (Object.keys(range).length > 0) where.last_purchase_date = range;
    }

    let products: any[];
    let total: number;

    // Handle low stock filter with raw SQL since Prisma doesn't support field-to-field comparisons
    if (stockFilter === 'low_stock') {
      // Parameterised, and assembled the same way /api/products/optimized does
      // it. Two things were wrong here.
      //
      // First, this used prisma.$queryRaw - a TAGGED TEMPLATE - with SQL
      // FRAGMENTS in the interpolations. A tagged template binds every `${}` as
      // a value, not as SQL, so what reached MySQL was `WHERE ? ? ? ? ? ? ? ?`
      // and it answered with syntax error 1064. Requesting stockFilter=low_stock
      // was a guaranteed 500 (F-92). Had those fragments been interpolated as
      // text, the search term went in unescaped and it would have been an
      // injection instead.
      //
      // Second, the rule itself was a third variant: `stock > 0 AND stock <=
      // min_stock`. F-70 unified the Low Stock page and the minimum-stock report
      // but missed this endpoint, so "what is low on stock" still had two
      // answers. It now uses the same rule as everywhere else: a min_stock of 0
      // or NULL means no minimum was ever set, so the product cannot be below it.
      const params: any[] = [];
      let lowStockSql = `
        SELECT p.*, g.rate as gst_rate_value
        FROM product p
        LEFT JOIN gst_tax_rate g ON p.gst_rate_id = g.id
        WHERE 1=1
      `;

      if (where.is_active !== undefined) { lowStockSql += ` AND p.is_active = ?`; params.push(where.is_active); }
      if (where.product_category_id) { lowStockSql += ` AND p.product_category_id = ?`; params.push(where.product_category_id); }
      if (where.product_subcategory_id) { lowStockSql += ` AND p.product_subcategory_id = ?`; params.push(where.product_subcategory_id); }
      if (where.company_id) { lowStockSql += ` AND p.company_id = ?`; params.push(where.company_id); }
      if (where.part_no?.contains) { lowStockSql += ` AND p.part_no LIKE ?`; params.push(`%${where.part_no.contains}%`); }
      if (where.id) { lowStockSql += ` AND p.id = ?`; params.push(where.id); }
      if (where.last_purchase_date?.gte) { lowStockSql += ` AND p.last_purchase_date >= ?`; params.push(where.last_purchase_date.gte); }
      if (where.last_purchase_date?.lte) { lowStockSql += ` AND p.last_purchase_date <= ?`; params.push(where.last_purchase_date.lte); }

      if (search) {
        const term = `%${(search as string).trim()}%`;
        lowStockSql += ` AND (p.display_name LIKE ? OR p.product_name LIKE ? OR p.part_no LIKE ?)`;
        params.push(term, term, term);
      }

      if (modelFilter && (modelFilter as string).trim()) {
        const modelId = (modelFilter as string).trim();
        lowStockSql += ` AND (p.car_model_ids LIKE ? OR p.car_model_ids LIKE ? OR p.car_model_ids LIKE ? OR p.car_model_ids = ?)`;
        params.push(`%,${modelId},%`, `${modelId},%`, `%,${modelId}`, modelId);
      }

      lowStockSql += ` AND p.min_stock IS NOT NULL AND p.min_stock > 0 AND p.stock < p.min_stock`;

      const totalResult = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*) as count FROM (${lowStockSql}) as filtered_products`,
        ...params
      ) as any[];
      total = Number(totalResult[0].count);

      let pagedSql = lowStockSql + ` ORDER BY p.id DESC`;
      const pagedParams = [...params];
      if (!isFetchAll) {
        pagedSql += ` LIMIT ? OFFSET ?`;
        pagedParams.push(limitNum, skip);
      }

      products = await prisma.$queryRawUnsafe(pagedSql, ...pagedParams) as any[];
    } else {
      // Normal Prisma query for all other cases (including model filter)
      const queryOptions: any = {
        where,
        orderBy: { id: 'desc' },
        include: { gst_rate: true },
      };

      // Only add pagination if not fetching all
      if (!isFetchAll) {
        queryOptions.skip = skip;
        queryOptions.take = limitNum;
      }

      [products, total] = await Promise.all([
        prisma.product.findMany(queryOptions),
        prisma.product.count({ where }),
      ]);
    }

    // Get latest purchase rates in batch
    const productIds = products.map(p => p.id);
    const latestRateMap = await getPurchaseRatesOptimized(productIds);

    const processedProducts = products.map(p => {
      const latestPurchase = latestRateMap.get(p.id);
      const displayRate = latestPurchase?.rate || p.opening_rate || 0;
      const latestSelling = (latestPurchase?.rate || p.opening_rate || 0) - (p.discount || 0) + (p.margin || 0);
      const calcSelling = (p.opening_rate || 0) + (p.margin || 0) - (p.discount || 0);

      return {
        ...p,
        display_rate: displayRate,
        latest_selling_price: latestSelling,
        calculated_selling_price: calcSelling,
        latest_purchase_rate: p.latest_purchase_rate || latestPurchase?.rate || null,
        last_purchase_date: p.last_purchase_date || latestPurchase?.date || null,
        selling_price: calcSelling,
        gst_rate_percentage: p.gst_rate?.rate || 0,
      };
    });

    res.status(200).json({
      products: processedProducts,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum), hasMore: pageNum * limitNum < total },
    });
  } catch (error) {
    // Logged in full, returned as a bare message. The raw Prisma text names
    // tables, columns and constraints and should not leave the server - F-81
    // was fixed in [id].ts and missed here, which is how the F-92 and F-93
    // probes came back with the query and the schema in the response body.
    console.error('GET /products error:', error);
    res.status(500).json({ message: 'Failed to fetch products' });
  }
}

// ---------------------
// POST handler: Create product
// ---------------------
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {

    // Parse FormData (UI sends FormData with productData JSON)
    const { fields, files } = await parseForm(req);
    

    const productDataStr = Array.isArray(fields.productData) ? fields.productData[0] : fields.productData;
    if (!productDataStr) return res.status(400).json({ message: 'Product data is required' });

    // Guarded, the way the update path guards it. A malformed payload used to
    // throw straight past this into the outer catch and answer 500, when the
    // client is the one that got it wrong (F-109).
    let productData;
    try {
      productData = JSON.parse(productDataStr);
    } catch (parseError) {
      console.error('POST /products: JSON parse error:', parseError);
      return res.status(400).json({ message: 'Invalid JSON in product data' });
    }

    // Validate BEFORE uploading anything.
    //
    // The uploads used to run first, so a product rejected for a missing
    // warehouse or a duplicate part number had already pushed its image and
    // barcode to the FTP server, where nothing would ever reference or remove
    // them (F-104).
    //
    // Same rules the update path applies, from the same module, so create and
    // update cannot drift apart again - which is how edit came to accept an
    // empty product name that create rejected (F-79).
    const failure = await validateProduct(productData, { partial: false });
    if (failure) {
      return res.status(failure.status).json({ message: failure.message });
    }

    const partNoConflict = await findConflictingPartNo(productData.part_no);
    if (partNoConflict) {
      return res.status(400).json({
        message: partNoConflictMessage(productData.part_no, partNoConflict)
      });
    }

    // Smart file handling for new products (all files are new)
    const uploadPromises: Promise<void>[] = [];
    let imageUrl: string | null = null;
    let barcodeUrl: string | null = null;

    // Upload image if provided
    if (files.image && files.image[0]) {
      uploadPromises.push(
        (async () => {
          try {
            imageUrl = await uploadFileToStorage(files.image[0]);
          } catch (uploadError) {
            console.error('Image upload failed:', uploadError);
            // Continue without image - don't fail the entire creation
          }
        })()
      );
    }

    // Upload barcode if provided
    if (files.barcode && files.barcode[0]) {
      uploadPromises.push(
        (async () => {
          try {
            barcodeUrl = await uploadFileToStorage(files.barcode[0]);
          } catch (uploadError) {
            console.error('Barcode upload failed:', uploadError);
            // Continue without barcode - don't fail the entire creation
          }
        })()
      );
    }

    // Wait for all uploads to complete in parallel
    if (uploadPromises.length > 0) {
      await Promise.all(uploadPromises);
    }

    const finalProductData: any = await buildProductData(productData, { partial: false });

    // Opening stock IS the starting stock - but only here, at creation. This is
    // the one legitimate place the two are equal; repeating it on update was
    // F-75. `stock` is not read from the payload: the client does not get to
    // choose a stock level.
    finalProductData.stock = finalProductData.opening_stock;
    finalProductData.pic = imageUrl;
    finalProductData.barcode = barcodeUrl;


    try {
      const product = await prisma.product.create({ data: finalProductData });

      // display_name needs the id, which only exists after the insert, so it is
      // a second statement - but an AWAITED one.
      //
      // It used to be fired and forgotten with a .catch() that only logged. If
      // it lost the race or failed, the product kept display_name NULL, and
      // display_name is the FIRST field both list endpoints search on - so the
      // product was effectively unfindable by name and nothing reported why
      // (F-105).
      await prisma.product.update({
        where: { id: product.id },
        data: { display_name: `${product.id} ${product.product_name}` }
      });

      res.status(201).json({
        message: 'Product created successfully',
        product: {
          id: product.id,
          product_name: product.product_name,
          part_no: product.part_no
        }
      });
    } catch (dbError: any) {
      // Translated at the boundary, the same way [id].ts does it. This used to
      // return the raw Prisma message AND the stack trace to the client, which
      // is F-81 with an extra step - the fix landed on the update path and not
      // on create.
      console.error('POST /products: Database error:', dbError);
      if (dbError?.code === 'P2002') {
        // part_no carries a database-level unique index across ALL products,
        // active or not, which is wider than the check findConflictingPartNo
        // makes (F-100).
        return res.status(409).json({
          status: 'failure',
          message: 'That part number is already in use, including by a deactivated product'
        });
      }
      if (dbError?.code === 'P2003') {
        return res.status(400).json({
          status: 'failure',
          message: 'A selected category, company, warehouse, rack or GST rate does not exist'
        });
      }
      return res.status(500).json({ status: 'failure', message: 'Failed to create product' });
    }
  } catch (error) {
    console.error('POST /products error:', error);
    res.status(500).json({ status: 'failure', message: 'Failed to create product' });
  }
}



// ---------------------
// ULTRA OPTIMIZED: Get all purchase rates in a single efficient query
// ---------------------
async function getPurchaseRatesOptimized(productIds: number[]): Promise<Map<number, { rate: number; date: number }>> {
  if (!productIds.length) return new Map();

  try {
    // One placeholder per id, not one placeholder for the whole list.
    //
    // This read `IN (${productIds.join(',')})` inside a $queryRaw TAGGED
    // TEMPLATE, so the joined string went in as a single bound parameter:
    // `IN (?)` with the value '1,2,3'. MySQL coerces that string to the number
    // 1, so the query only ever matched product_id 1 and every other product
    // silently fell back to its opening rate. Nothing threw, so the catch below
    // never ran either (F-94). Invisible today only because purchase_items is
    // empty; it would have quietly mispriced the whole list once Phase 4 wrote
    // the first purchase.
    const placeholders = productIds.map(() => '?').join(',');
    const latestPurchases = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT
        pi.product_id,
        pi.rate,
        pi.invoice_date
      FROM (
        SELECT
          product_id,
          rate,
          invoice_date,
          ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY invoice_date DESC, rate DESC) as rn
        FROM purchase_items
        WHERE product_id IN (${placeholders})
          AND rate > 0
      ) pi
      WHERE pi.rn = 1
    `, ...productIds) as any[];

    // Build result map from single query results
    const resultMap = new Map<number, { rate: number; date: number }>();
    latestPurchases.forEach((record: any) => {
      resultMap.set(record.product_id, {
        rate: record.rate,
        date: record.invoice_date
      });
    });

    return resultMap;

  } catch (e) {
    // Fallback: try to get data directly from product table
    try {
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          latest_purchase_rate: true,
          last_purchase_date: true
        }
      });

      const fallbackMap = new Map<number, { rate: number; date: number }>();
      products.forEach(p => {
        if (p.latest_purchase_rate && p.last_purchase_date) {
          fallbackMap.set(p.id, {
            rate: p.latest_purchase_rate,
            date: p.last_purchase_date
          });
        }
      });

      return fallbackMap;

    } catch (fallbackError) {
      return new Map(); // final fallback
    }
  }
}

// ---------------------
// Main handler
// ---------------------
async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET': return handleGet(req, res);
    case 'POST': return handlePost(req, res);
    default: return res.status(405).json({ message: 'Method not allowed' });
  }
}

export default withObservability(handler);

// Enable raw body parsing for POST requests
export const config = {
  api: {
    bodyParser: false, // Disable Next.js body parser for FormData
  },
};
