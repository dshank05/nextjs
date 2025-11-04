import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { withObservability } from '../../../lib/withObservability';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import Client from 'ssh2-sftp-client';

// ---------------------
// Helper: Upload file to SFTP and return public URL (TEMPORARILY DISABLED)
// ---------------------
async function uploadFileToStorage(file: formidable.File): Promise<string | null> {
  // TEMPORARILY DISABLED: File upload functionality commented out
  // TODO: Uncomment when FTP/SFTP credentials are available

  /*
  const sftp = new Client();
  try {
    // Connect to SFTP server
    await sftp.connect({
      host: process.env.FTP_HOST,
      port: parseInt(process.env.FTP_PORT) || 22, // SFTP uses port 22
      username: process.env.FTP_USERNAME,
      password: process.env.FTP_PASSWORD,
    });

    // Ensure remote directory exists
    try {
      await sftp.mkdir('public_html/uploads', true);
    } catch (mkdirErr: any) {
      // Ignore if directory already exists (code 4)
      if (mkdirErr.code !== 4) {
        throw mkdirErr;
      }
    }

    // Generate unique filename
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const originalName = file.originalFilename || 'unknown';
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext).replace(/[^a-zA-Z0-9]/g, '_');
    const uniqueName = `${base}_${timestamp}_${random}${ext}`;

    // Upload file
    await sftp.put(file.filepath, `public_html/uploads/${uniqueName}`);

    // Clean up local temp file
    fs.unlink(file.filepath, (err) => {
      if (err) console.warn('Failed to clean up temp file:', err);
    });

    const hostingerDomain = process.env.HOSTINGER_DOMAIN || 'https://baijnathsons.com';
    const publicUrl = `${hostingerDomain}/uploads/${uniqueName}`;
    console.log('SFTP upload successful:', publicUrl);

    return publicUrl;
  } catch (error) {
    console.error('SFTP upload error:', error);
    throw error;
  } finally {
    // Always disconnect
    try {
      await sftp.end();
    } catch (endErr) {
      console.warn('SFTP disconnect error:', endErr);
    }
  }
  */

  // Clean up temp file
  fs.unlink(file.filepath, (err) => {
    if (err) console.warn('Failed to clean up temp file:', err);
  });

  // Return null to disable file uploads temporarily
  console.log('File upload temporarily disabled');
  return null;
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

    // Handle car model filter
    if (modelFilter) {
      const modelIds = (modelFilter as string).split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      if (modelIds.length > 0) {
        where.car_model_ids = { hasSome: modelIds };
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
      const baseWhere = { ...where };
      delete baseWhere.stock; // Remove stock filter since we'll handle it in SQL

      // Get products with low stock using raw SQL
      const lowStockProducts = await prisma.$queryRaw`
        SELECT p.*, g.rate as gst_rate_value
        FROM product p
        LEFT JOIN gst_tax_rate g ON p.gst_rate_id = g.id
        WHERE ${baseWhere.is_active !== undefined ? `p.is_active = ${baseWhere.is_active}` : '1=1'}
          ${baseWhere.product_category_id ? `AND p.product_category_id = ${baseWhere.product_category_id}` : ''}
          ${baseWhere.product_subcategory_id ? `AND p.product_subcategory_id = ${baseWhere.product_subcategory_id}` : ''}
          ${baseWhere.company_id ? `AND p.company_id = ${baseWhere.company_id}` : ''}
          ${baseWhere.part_no ? `AND p.part_no ILIKE '%${baseWhere.part_no.contains}%'` : ''}
          ${baseWhere.id ? `AND p.id = ${baseWhere.id}` : ''}
          ${baseWhere.stock ? `AND p.stock = ${baseWhere.stock}` : ''}
          AND p.stock > 0 AND p.stock <= p.min_stock
        ORDER BY p.id DESC
        LIMIT ${limitNum} OFFSET ${skip}
      ` as any[];

      // Get total count for low stock
      const totalResult = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM product p
        WHERE ${baseWhere.is_active !== undefined ? `p.is_active = ${baseWhere.is_active}` : '1=1'}
          ${baseWhere.product_category_id ? `AND p.product_category_id = ${baseWhere.product_category_id}` : ''}
          ${baseWhere.product_subcategory_id ? `AND p.product_subcategory_id = ${baseWhere.product_subcategory_id}` : ''}
          ${baseWhere.company_id ? `AND p.company_id = ${baseWhere.company_id}` : ''}
          ${baseWhere.part_no ? `AND p.part_no ILIKE '%${baseWhere.part_no?.contains}%'` : ''}
          ${baseWhere.id ? `AND p.id = ${baseWhere.id}` : ''}
          ${baseWhere.stock ? `AND p.stock = ${baseWhere.stock}` : ''}
          AND p.stock > 0 AND p.stock <= p.min_stock
      ` as any[];

      products = lowStockProducts;
      total = parseInt(totalResult[0].count);
    } else {
      // Normal Prisma query for other cases
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

    const imageUrl = null; // Temporarily disabled
    const barcodeUrl = null; // Temporarily disabled
    console.log('POST /products: File uploads disabled');

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

    const finalProductData = {
      product_name: productData.product_name,
      product_category_id: productData.product_category_id ? parseInt(productData.product_category_id) : null,
      product_subcategory_id: productData.product_subcategory_id ? parseInt(productData.product_subcategory_id) : null,
      car_model_ids: productData.car_model_ids || null,
      company_id: productData.company_id ? parseInt(productData.company_id) : null,
      part_no: productData.part_no || null,
      min_stock: productData.min_stock ? parseInt(productData.min_stock) : 0,
      stock: productData.stock ? parseInt(productData.stock) : 0,
      opening_stock: productData.opening_stock ? parseInt(productData.opening_stock) : 0,
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
// Optimized batch fetch of latest purchase rates
// ---------------------
async function getPurchaseRatesOptimized(productIds: number[]): Promise<Map<number, { rate: number; date: number }>> {
  if (!productIds.length) return new Map();
  try {
    const latestPurchases = await prisma.$queryRaw`
      SELECT DISTINCT pi.product_id, pi.rate, pi.invoice_date
      FROM purchase_items pi
      INNER JOIN (
        SELECT product_id, MAX(invoice_date) AS max_date
        FROM purchase_items
        WHERE product_id IN (${productIds.join(',')})
        GROUP BY product_id
      ) latest ON pi.product_id = latest.product_id AND pi.invoice_date = latest.max_date
      ORDER BY pi.product_id
    ` as any[];

    return new Map(latestPurchases.map(r => [r.product_id, { rate: r.rate, date: r.invoice_date }]));
  } catch (e) {
    console.error('Raw SQL failed:', e);
    return new Map(); // fallback empty
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
