import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
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
      if (err) console.warn('Failed to clean up temp file:', err);
    });

    const hostingerDomain = process.env.HOSTINGER_DOMAIN || 'https://baijnathsons.com';
    const publicUrl = `${hostingerDomain}/uploads/${uniqueName}`;
    console.log('FTP upload successful:', publicUrl);

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
    console.log('FORMIDABLE: Creating formidable instance...');

    const form = formidable({
      keepExtensions: true,
      maxFileSize: 5 * 1024 * 1024,
      filter: (part) => ['image/jpeg','image/png','image/gif','image/webp'].includes(part.mimetype || ''),
    });

    console.log('FORMIDABLE: Setting up event handlers...');

    // Add timeout
    const timeout = setTimeout(() => {
      console.error('FORMIDABLE: TIMEOUT - Parsing took longer than 30 seconds');
      reject(new Error('Form parsing timeout'));
    }, 30000); // 30 second timeout

    form.on('field', (name, value) => {
      console.log(`FORMIDABLE: Received field: ${name} = ${value.substring(0, 100)}...`);
    });

    form.on('fileBegin', (name, file) => {
      console.log(`FORMIDABLE: File begin: ${name}, ${file.originalFilename}`);
    });

    form.on('file', (name, file) => {
      console.log(`FORMIDABLE: File received: ${name}, ${file.originalFilename}, size: ${file.size}`);
    });

    form.on('progress', (bytesReceived, bytesExpected) => {
      console.log(`FORMIDABLE: Progress: ${bytesReceived}/${bytesExpected} bytes`);
    });

    form.on('error', (err) => {
      console.error('FORMIDABLE: Error occurred:', err);
      clearTimeout(timeout);
      reject(err);
    });

    form.on('end', () => {
      console.log('FORMIDABLE: Parsing completed successfully');
      clearTimeout(timeout);
    });

    console.log('FORMIDABLE: Starting parse...');
    form.parse(req, (err, fields, files) => {
      clearTimeout(timeout);
      if (err) {
        console.error('FORMIDABLE: Parse callback error:', err);
        return reject(err);
      }
      console.log('FORMIDABLE: Parse callback success, fields:', Object.keys(fields), 'files:', Object.keys(files));
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
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (includeInactive !== 'true') where.is_active = true;

    // Handle search term (from search input)
    if (search) {
      const term = (search as string).trim();
      where.OR = [
        { product_name: { contains: term, mode: 'insensitive' } },
        { part_no: { contains: term, mode: 'insensitive' } },
      ];
    }

    // Handle category filter (legacy support)
    if (category) where.product_category_id = parseInt(category as string);

    // Handle advanced filters from ProductTable
    if (categoryFilter) where.product_category_id = parseInt(categoryFilter as string);
    if (subcategoryFilter) where.product_subcategory_id = parseInt(subcategoryFilter as string);
    if (companyFilter) where.company_id = parseInt(companyFilter as string);
    if (partNoFilter) where.part_no = { contains: partNoFilter as string, mode: 'insensitive' };
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
          where.stock = { equals: 0 };
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

    // Handle date range filters
    if (startDate || endDate) {
      where.created_at = {};
      if (startDate) where.created_at.gte = new Date(startDate as string);
      if (endDate) where.created_at.lte = new Date(endDate as string);
    }

    let products: any[];
    let total: number;

    // Handle low stock filter with raw SQL since Prisma doesn't support field-to-field comparisons
    if (stockFilter === 'low_stock') {
      // Use raw SQL only for low stock filter
      const lowStockProducts = await prisma.$queryRaw`
        SELECT p.*, g.rate as gst_rate_value
        FROM product p
        LEFT JOIN gst_tax_rate g ON p.gst_rate_id = g.id
        WHERE ${where.is_active !== undefined ? `p.is_active = ${where.is_active}` : '1=1'}
          ${where.product_category_id ? `AND p.product_category_id = ${where.product_category_id}` : ''}
          ${where.product_subcategory_id ? `AND p.product_subcategory_id = ${where.product_subcategory_id}` : ''}
          ${where.company_id ? `AND p.company_id = ${where.company_id}` : ''}
          ${where.part_no ? `AND p.part_no ILIKE '%${where.part_no?.contains}%'` : ''}
          ${where.id ? `AND p.id = ${where.id}` : ''}
          ${stockFilter === 'low_stock' ? 'AND p.stock > 0 AND p.stock <= p.min_stock' : ''}
        ORDER BY p.id DESC
        LIMIT ${limitNum} OFFSET ${skip}
      ` as any[];

      // Get total count for low stock
      const totalResult = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM product p
        WHERE ${where.is_active !== undefined ? `p.is_active = ${where.is_active}` : '1=1'}
          ${where.product_category_id ? `AND p.product_category_id = ${where.product_category_id}` : ''}
          ${where.product_subcategory_id ? `AND p.product_subcategory_id = ${where.product_subcategory_id}` : ''}
          ${where.company_id ? `AND p.company_id = ${where.company_id}` : ''}
          ${where.part_no ? `AND p.part_no ILIKE '%${where.part_no?.contains}%'` : ''}
          ${where.id ? `AND p.id = ${where.id}` : ''}
          ${stockFilter === 'low_stock' ? 'AND p.stock > 0 AND p.stock <= p.min_stock' : ''}
      ` as any[];

      products = lowStockProducts;
      total = parseInt(totalResult[0].count);
    } else {
      // Normal Prisma query for all other cases (including model filter)
      [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          skip,
          take: limitNum,
          orderBy: { id: 'desc' },
          include: { gst_rate: true },
        }),
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
        latest_purchase_rate: latestPurchase?.rate || null,
        last_purchase_date: latestPurchase?.date || null,
        selling_price: calcSelling,
        gst_rate_percentage: p.gst_rate?.rate || 0,
      };
    });

    res.status(200).json({
      products: processedProducts,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum), hasMore: pageNum * limitNum < total },
    });
  } catch (error) {
    console.error('GET /products error:', error);
    res.status(500).json({ message: 'Failed to fetch products', error: error instanceof Error ? error.message : 'Unknown' });
  }
}

// ---------------------
// POST handler: Create product
// ---------------------
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    console.log('POST /products: Starting request processing');

    // Parse FormData (UI sends FormData with productData JSON)
    console.log('POST /products: Parsing FormData...');
    const { fields, files } = await parseForm(req);
    
    console.log('POST /products: Form parsed successfully');

    const productDataStr = Array.isArray(fields.productData) ? fields.productData[0] : fields.productData;
    if (!productDataStr) return res.status(400).json({ message: 'Product data is required' });
    const productData = JSON.parse(productDataStr);
    console.log('POST /products: Product data parsed:', productData);



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

    // Basic validation
    if (!productData.product_name || productData.product_name.trim() === '') {
      console.log('POST /products: Product name validation failed');
      return res.status(400).json({ message: 'Product name is required' });
    }
    if (!productData.warehouse_id) {
      console.log('POST /products: Warehouse validation failed');
      return res.status(400).json({ message: 'Warehouse is required' });
    }

    // Check for duplicate part number (case-insensitive)
    if (productData.part_no && productData.part_no.trim() !== '') {
      const trimmedPartNo = productData.part_no.trim();
      // Use raw SQL for case-insensitive comparison since Prisma doesn't support mode on nullable strings
      const existingProduct = await prisma.$queryRaw`
        SELECT id, part_no FROM product
        WHERE LOWER(part_no) = LOWER(${trimmedPartNo})
        AND is_active = true
        LIMIT 1
      ` as any[];

      if (existingProduct.length > 0) {
        console.log('POST /products: Duplicate part number validation failed');
        return res.status(400).json({
          message: `Part number "${trimmedPartNo}" is already in use by another product (ID: ${existingProduct[0].id}). Please use a different part number.`
        });
      }
    }

    console.log('POST /products: Basic validation passed');

    // Optional FK validations
    console.log('POST /products: Starting FK validations');
    if (productData.company_id && !(await prisma.product_company.findUnique({ where: { id: parseInt(productData.company_id) } }))) {
      console.log('POST /products: Company validation failed');
      return res.status(400).json({ message: 'Invalid company selected' });
    }
    console.log('POST /products: Company validation passed');

    if (!(await prisma.warehouse.findUnique({ where: { id: parseInt(productData.warehouse_id) } }))) {
      console.log('POST /products: Warehouse validation failed');
      return res.status(400).json({ message: 'Invalid warehouse selected' });
    }
    console.log('POST /products: Warehouse validation passed');

    if (productData.gst_rate_id && !(await prisma.gst_tax_rate.findUnique({ where: { id: parseInt(productData.gst_rate_id) } }))) {
      console.log('POST /products: GST rate validation failed');
      return res.status(400).json({ message: 'Invalid GST rate selected' });
    }
    console.log('POST /products: GST rate validation passed');

    // ===== IMPLEMENTATION: opening_stock = stock during product creation =====
    const initialStock = productData.stock ? parseInt(productData.stock) : 0;

    const finalProductData = {
      product_name: productData.product_name,
      product_category_id: productData.product_category_id ? parseInt(productData.product_category_id) : null,
      product_subcategory_id: productData.product_subcategory_id ? parseInt(productData.product_subcategory_id) : null,
      car_model_ids: productData.car_model_ids || null,
      company_id: productData.company_id ? parseInt(productData.company_id) : null,
      part_no: productData.part_no || null,
      min_stock: productData.min_stock ? parseInt(productData.min_stock) : 0,
      stock: initialStock,
      opening_stock: initialStock,  // ✅ Always equals initial stock on creation
      opening_rate: productData.opening_rate ? parseFloat(productData.opening_rate) : 0,
      hsn: productData.hsn || null,
      pic: imageUrl,
      barcode: barcodeUrl,
      descriptions: productData.descriptions || null,
      mrp: productData.mrp ? parseFloat(productData.mrp) : null,
      discount: productData.discount ? parseFloat(productData.discount) : null,
      margin: productData.margin ? parseFloat(productData.margin) : null,
      warehouse_id: productData.warehouse_id ? parseInt(productData.warehouse_id) : null,
      gst_rate_id: productData.gst_rate_id ? parseInt(productData.gst_rate_id) : null,
      rack_id: productData.rack_id ? parseInt(productData.rack_id) : null,
      rack_number: productData.rack_number || null,
      notes: productData.notes || null,
    };

    console.log('POST /products: Final product data prepared:', finalProductData);
    console.log('POST /products: Creating product in database...');

    try {
      const product = await prisma.product.create({ data: finalProductData });
      console.log('POST /products: Product created successfully:', product.id);

      // ===== BACKGROUND: Update display_name with UID =====
      // Fire background update - don't wait for it to complete
      prisma.product.update({
        where: { id: product.id },
        data: { display_name: `${product.id} ${product.product_name}` }
      }).catch(error => {
        console.error('Background display_name update failed:', error);
        // Don't fail the main request if background update fails
      });

      res.status(201).json({
        message: 'Product created successfully',
        product: {
          id: product.id,
          product_name: product.product_name,
          part_no: product.part_no
        }
      });
    } catch (dbError) {
      console.error('POST /products: Database error:', dbError);
      return res.status(500).json({
        status: 'failure',
        message: 'Failed to create product',
        error: dbError instanceof Error ? dbError.message : 'Database error',
        details: dbError instanceof Error ? dbError.stack : 'Unknown database error'
      });
    }
  } catch (error) {
    console.error('POST /products error:', error);
    res.status(500).json({ status: 'failure', message: 'Failed to create product', error: error instanceof Error ? error.message : 'Unknown' });
  }
}



// ---------------------
// ULTRA OPTIMIZED: Get all purchase rates in a single efficient query
// ---------------------
async function getPurchaseRatesOptimized(productIds: number[]): Promise<Map<number, { rate: number; date: number }>> {
  if (!productIds.length) return new Map();

  try {
    // 🔥 SINGLE EFFICIENT QUERY: Get latest purchase rates for all products at once
    // Uses window function approach with ROW_NUMBER() to get the latest record per product
    const latestPurchases = await prisma.$queryRaw`
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
        WHERE product_id IN (${productIds.join(',')})
          AND rate > 0
      ) pi
      WHERE pi.rn = 1
    ` as any[];

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
