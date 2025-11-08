import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import formidable from 'formidable'
import fs from 'fs'
import path from 'path'
import { Client } from 'basic-ftp'

// ==================== Helper: Promisify Formidable ====================
function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      keepExtensions: true,
      maxFileSize: 5 * 1024 * 1024, // 5MB
      filter: (part) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        return part.mimetype ? allowedTypes.includes(part.mimetype) : false;
      }
    });
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

// ==================== Helper: Delete old file from FTP ====================
async function deleteOldFile(fileUrl: string): Promise<void> {
  try {
    // Extract filename from URL
    const urlParts = fileUrl.split('/');
    const filename = urlParts[urlParts.length - 1];

    if (!filename) return;

    const client = new Client();

    // Connect to FTP server
    await client.access({
      host: process.env.FTP_HOST,
      port: parseInt(process.env.FTP_PORT) || 21,
      user: process.env.FTP_USERNAME,
      password: process.env.FTP_PASSWORD,
      secure: false // Regular FTP, not FTPS
    });

    // Try to delete the file
    try {
      await client.remove(`/public_html/uploads/${filename}`);
      console.log('Old file deleted successfully:', filename);
    } catch (deleteError) {
      // File might not exist or already deleted - not a critical error
      console.warn('Could not delete old file (might not exist):', filename);
    }

    client.close();
  } catch (error) {
    console.warn('Error deleting old file:', error);
    // Don't throw - file deletion failure shouldn't break the update
  }
}

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

// ==================== Helper: Enhance Product ====================
async function enhanceProduct(product: any) {
  if (!product) return null;

  const latestPurchaseData = await prisma.purchaseitems.findFirst({
    where: { product_id: product.id, rate: { gt: 0 } },
    select: { rate: true, invoice_date: true },
    orderBy: { invoice_date: 'desc' }
  });

  const latestPurchaseRate = latestPurchaseData?.rate || 0;

  const categoryIds = product.product_category_id ? [product.product_category_id] : [];
  const subcategoryIds = product.product_subcategory_id ? [product.product_subcategory_id] : [];
  const carModelIds = product.car_model_ids
    ? product.car_model_ids.split(',').map((id: string) => parseInt(id.trim())).filter(id => !isNaN(id))
    : [];
  const companyIds = product.company_id ? [product.company_id] : [];
  const warehouseIds = product.warehouse_id ? [product.warehouse_id] : [];
  const rackIds = product.rack_id ? [product.rack_id] : [];
  const gstRateIds = product.hsn ? [product.hsn] : [];

  const [
    categoryRecords,
    subcategoryRecords,
    carModelRecords,
    companyRecords,
    warehouseRecords,
    rackRecords,
    gstRateRecords
  ] = await Promise.all([
    categoryIds.length ? prisma.product_category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, category_name: true } }) : Promise.resolve([]),
    subcategoryIds.length ? prisma.product_subcategory.findMany({ where: { id: { in: subcategoryIds } }, select: { id: true, subcategory_name: true } }) : Promise.resolve([]),
    carModelIds.length ? prisma.car_models.findMany({ where: { id: { in: carModelIds } }, select: { id: true, model_name: true } }) : Promise.resolve([]),
    companyIds.length ? prisma.product_company.findMany({ where: { id: { in: companyIds } }, select: { id: true, company_name: true } }) : Promise.resolve([]),
    warehouseIds.length ? prisma.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, name: true, location: true } }) : Promise.resolve([]),
    rackIds.length ? prisma.warehouse_racks.findMany({ where: { id: { in: rackIds } }, select: { id: true, rack_number: true } }) : Promise.resolve([]),
    gstRateIds.length ? prisma.gst_tax_rate.findMany({ where: { hsn_code: { in: gstRateIds } }, select: { id: true, rate: true, hsn_code: true } }) : Promise.resolve([])
  ]);

  const categoryMap = new Map(categoryRecords.map(c => [c.id, c.category_name]));
  const subcategoryMap = new Map(subcategoryRecords.map(s => [s.id, s.subcategory_name]));
  const carModelMap = new Map(carModelRecords.map(c => [c.id, c.model_name]));
  const companyMap = new Map(companyRecords.map(c => [c.id.toString(), c.company_name]));
  const warehouseMap = new Map(warehouseRecords.map(w => [w.id, { name: w.name, location: w.location }]));
  const rackMap = new Map(rackRecords.map(r => [r.id, r.rack_number]));
  const gstRateMap = new Map(gstRateRecords.map(g => [g.hsn_code, g.rate]));

  const carModelNames = carModelIds.map(id => carModelMap.get(id)).filter(Boolean) as string[];

  return {
    ...product,
    categoryName: product.product_category_id ? categoryMap.get(product.product_category_id) || '' : '',
    subcategoryName: product.product_subcategory_id ? subcategoryMap.get(product.product_subcategory_id) || '' : '',
    companyName: product.company_id ? companyMap.get(product.company_id.toString()) || '' : '',
    warehouse: product.warehouse_id && warehouseMap.get(product.warehouse_id)
      ? `${warehouseMap.get(product.warehouse_id)?.name} - ${warehouseMap.get(product.warehouse_id)?.location}`
      : '',
    rack_number: product.rack_id ? rackMap.get(product.rack_id) || product.rack_number || '' : product.rack_number || '',
    carModelsDisplay: carModelNames.join(', '),
    sale_price: (latestPurchaseRate || product?.opening_rate || 0) + (product.margin || 0) - (product.discount || 0),
    gst_rate: product.hsn ? gstRateMap.get(product.hsn) || 0 : 0,
    opening_rate: product.opening_rate || 0
  };
}

// ==================== API Handler ====================
export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const productId = parseInt(id as string);

  if (isNaN(productId)) return res.status(400).json({ message: 'Invalid product ID' });

  try {
    switch (req.method) {
      case 'GET': {
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return res.status(404).json({ message: 'Product not found' });

        const enhancedProduct = await enhanceProduct(product);
        return res.status(200).json(enhancedProduct);
      }

      case 'PUT': {
        // Parse FormData (UI sends FormData with productData JSON + files)
        const { fields, files } = await parseForm(req);

        const productDataStr = Array.isArray(fields.productData) ? fields.productData[0] : fields.productData;
        if (!productDataStr) return res.status(400).json({ message: 'Product data is required' });

        let productData;
        try {
          productData = JSON.parse(productDataStr);
        } catch (parseError) {
          console.error('JSON parse error:', parseError);
          console.error('Raw productData:', productDataStr);
          return res.status(400).json({
            message: 'Invalid JSON in product data',
            error: parseError instanceof Error ? parseError.message : 'Unknown parse error'
          });
        }

        // Check for duplicate part number (case-insensitive, excluding current product)
        if (productData.part_no && productData.part_no.trim() !== '') {
          const trimmedPartNo = productData.part_no.trim();
          // Use raw SQL for case-insensitive comparison since Prisma doesn't support mode on nullable strings
          const existingProduct = await prisma.$queryRaw`
            SELECT id, part_no FROM product
            WHERE LOWER(part_no) = LOWER(${trimmedPartNo})
            AND is_active = true
            AND id != ${productId}
            LIMIT 1
          ` as any[];

          if (existingProduct.length > 0) {
            return res.status(400).json({
              message: `Part number "${trimmedPartNo}" is already in use by another product (ID: ${existingProduct[0].id}). Please use a different part number.`
            });
          }
        }

        // Smart file handling - handle new uploads, existing files, and deletions
        const fileStates = productData.fileStates || {};
        const uploadPromises: Promise<void>[] = [];
        let imageUrl: string | null = null;
        let barcodeUrl: string | null = null;

        // Handle image file
        if (fileStates.image?.hasNewFile && files.image && files.image[0]) {
          // NEW FILE: Upload new file and delete old one if exists
          uploadPromises.push(
            (async () => {
              try {
                imageUrl = await uploadFileToStorage(files.image[0]);
                // Delete old file if it exists
                if (imageUrl && fileStates.image.existingUrl) {
                  await deleteOldFile(fileStates.image.existingUrl);
                }
              } catch (uploadError) {
                console.error('Image upload failed:', uploadError);
                // Continue without image - don't fail the entire update
              }
            })()
          );
        } else if (fileStates.image && fileStates.image.existingUrl === null && fileStates.image.hasNewFile === false) {
          // DELETE: User explicitly removed existing file - delete from FTP and set DB to null
          try {
            // Get current product to check existing file
            const currentProduct = await prisma.product.findUnique({
              where: { id: productId },
              select: { pic: true }
            });
            if (currentProduct?.pic) {
              await deleteOldFile(currentProduct.pic);
            }
          } catch (deleteError) {
            console.warn('Failed to delete existing image file:', deleteError);
          }
          imageUrl = null; // Set DB field to null
        } else if (fileStates.image?.existingUrl) {
          // KEEP EXISTING: Preserve existing URL
          imageUrl = fileStates.image.existingUrl;
        }
        // If no fileStates.image or existingUrl is undefined, keep current DB value (no change)

        // Handle barcode file
        if (fileStates.barcode?.hasNewFile && files.barcode && files.barcode[0]) {
          // NEW FILE: Upload new file and delete old one if exists
          uploadPromises.push(
            (async () => {
              try {
                barcodeUrl = await uploadFileToStorage(files.barcode[0]);
                // Delete old file if it exists
                if (barcodeUrl && fileStates.barcode.existingUrl) {
                  await deleteOldFile(fileStates.barcode.existingUrl);
                }
              } catch (uploadError) {
                console.error('Barcode upload failed:', uploadError);
                // Continue without barcode - don't fail the entire update
              }
            })()
          );
        } else if (fileStates.barcode && fileStates.barcode.existingUrl === null && fileStates.barcode.hasNewFile === false) {
          // DELETE: User explicitly removed existing file - delete from FTP and set DB to null
          try {
            // Get current product to check existing file
            const currentProduct = await prisma.product.findUnique({
              where: { id: productId },
              select: { barcode: true }
            });
            if (currentProduct?.barcode) {
              await deleteOldFile(currentProduct.barcode);
            }
          } catch (deleteError) {
            console.warn('Failed to delete existing barcode file:', deleteError);
          }
          barcodeUrl = null; // Set DB field to null
        } else if (fileStates.barcode?.existingUrl) {
          // KEEP EXISTING: Preserve existing URL
          barcodeUrl = fileStates.barcode.existingUrl;
        }
        // If no fileStates.barcode or existingUrl is undefined, keep current DB value (no change)

        // Wait for all uploads to complete in parallel
        if (uploadPromises.length > 0) {
          await Promise.all(uploadPromises);
        }

        const finalData: any = {
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
          // Handle file URLs - can be string, null, or undefined (for no change)
          ...(imageUrl !== undefined && { pic: imageUrl }),
          ...(barcodeUrl !== undefined && { barcode: barcodeUrl }),
          descriptions: productData.descriptions || null,
          mrp: productData.mrp ? parseFloat(productData.mrp) : null,
          discount: productData.discount ? parseFloat(productData.discount) : null,
          margin: productData.margin ? parseFloat(productData.margin) : null,
          warehouse_id: productData.warehouse_id ? parseInt(productData.warehouse_id) : null,
          gst_rate_id: productData.gst_rate_id ? parseInt(productData.gst_rate_id) : null,
          rack_id: productData.rack_id ? parseInt(productData.rack_id) : null,
          rack_number: productData.rack_number || null,
          notes: productData.notes || null
        };

        const updatedProduct = await prisma.product.update({ where: { id: productId }, data: finalData });
        const enhancedProduct = await enhanceProduct(updatedProduct);
        return res.status(200).json(enhancedProduct);
      }

      case 'DELETE': {
        await prisma.product.delete({ where: { id: productId } });
        return res.status(204).end();
      }

      default:
        res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error('API error:', error);
    return res.status(500).json({ message: 'Server error', error: error instanceof Error ? error.message : 'Unknown error' });
  }
}
