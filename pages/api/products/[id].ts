import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { validateProduct, findConflictingPartNo, buildProductData, partNoConflictMessage, buildProductName, sellingPrice } from '../../../lib/product'
import { withObservability } from '../../../lib/withObservability'
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
    } catch (deleteError) {
      // File might not exist or already deleted - not a critical error
    }

    client.close();
  } catch (error) {
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
  // Resolve the GST rate through the gst_rate_id foreign key, which is what
  // the product form writes and what the list endpoint reads.
  //
  // This used to match product.hsn against gst_tax_rate.hsn_code instead - a
  // second, string-based resolution of the same fact. The two disagreed by
  // construction, and since hsn is NULL on all 602 products the detail endpoint
  // reported every product at 0% tax while the list reported the real rate
  // (F-43). One product, two answers, depending on which screen you arrived
  // from.
  const gstRateId = product.gst_rate_id ?? null;

  const [
    categoryRecords,
    subcategoryRecords,
    carModelRecords,
    companyRecords,
    warehouseRecords,
    rackRecords,
    gstRateRecord
  ] = await Promise.all([
    categoryIds.length ? prisma.product_category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, category_name: true } }) : Promise.resolve([]),
    subcategoryIds.length ? prisma.product_subcategory.findMany({ where: { id: { in: subcategoryIds } }, select: { id: true, subcategory_name: true } }) : Promise.resolve([]),
    carModelIds.length ? prisma.car_models.findMany({ where: { id: { in: carModelIds } }, select: { id: true, model_name: true } }) : Promise.resolve([]),
    companyIds.length ? prisma.product_company.findMany({ where: { id: { in: companyIds } }, select: { id: true, company_name: true } }) : Promise.resolve([]),
    warehouseIds.length ? prisma.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, name: true, location: true } }) : Promise.resolve([]),
    rackIds.length ? prisma.warehouse_racks.findMany({ where: { id: { in: rackIds } }, select: { id: true, rack_number: true } }) : Promise.resolve([]),
    gstRateId ? prisma.gst_tax_rate.findUnique({ where: { id: gstRateId }, select: { id: true, rate: true, hsn_code: true } }) : Promise.resolve(null)
  ]);

  const categoryMap = new Map(categoryRecords.map(c => [c.id, c.category_name]));
  const subcategoryMap = new Map(subcategoryRecords.map(s => [s.id, s.subcategory_name]));
  const carModelMap = new Map(carModelRecords.map(c => [c.id, c.model_name]));
  const companyMap = new Map(companyRecords.map(c => [c.id.toString(), c.company_name]));
  const warehouseMap = new Map(warehouseRecords.map(w => [w.id, { name: w.name, location: w.location }]));
  const rackMap = new Map(rackRecords.map(r => [r.id, r.rack_number]));
  // gstRateRecord is the single rate this product points at, or null.

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
    // One selling-price rule everywhere (PQ-39).
    latestPurchaseRate,
    sale_price: sellingPrice({ latestPurchaseRate, opening_rate: product.opening_rate, margin: product.margin, discount: product.discount }),
    gst_rate: gstRateRecord?.rate ?? 0,
    opening_rate: product.opening_rate || 0
  };
}

// ==================== API Handler ====================
export const config = { api: { bodyParser: false } };

async function handler(req: NextApiRequest, res: NextApiResponse) {
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
          return res.status(400).json({ message: 'Invalid JSON in product data' });
        }

        // The product has to exist before anything else. Without this check the
        // update fell through to prisma, which threw P2025, which surfaced as a
        // generic 500 (F-80).
        const existingProduct = await prisma.product.findUnique({
          where: { id: productId },
          select: {
            id: true, pic: true, barcode: true,
            product_category_id: true, product_subcategory_id: true,
            company_id: true, car_model_ids: true, part_no: true
          }
        });
        if (!existingProduct) {
          return res.status(404).json({ message: 'Product not found' });
        }

        // Same validation create applies. This endpoint used to check nothing
        // but the part number, so an edit accepted an empty product name and an
        // invalid warehouse that create would have rejected (F-79, F-86).
        // productId is passed so the rack check can fall back to the warehouse
        // already stored on the product when a payload carries rack_id without
        // warehouse_id (F-99).
        const failure = await validateProduct(productData, { partial: true, productId });
        if (failure) {
          return res.status(failure.status).json({ message: failure.message });
        }

        const partNoConflict = await findConflictingPartNo(productData.part_no, productId);
        if (partNoConflict) {
          return res.status(400).json({
            message: partNoConflictMessage(productData.part_no, partNoConflict)
          });
        }

        // Files: the SERVER decides, from what is stored (PQ-13).
        //
        // `fileStates` from the client now only says what the user DID - picked
        // a new file, or removed the current one. The stored URL comes from the
        // row. It used to come from `fileStates.*.existingUrl`, so a caller could
        // set pic/barcode to any URL, or name any file in /uploads for deletion.
        //
        // Order (PQ-14): upload -> write the row -> delete the replaced file.
        // If the write fails or is refused (409), the new upload is removed and
        // the old file is untouched. Old files used to be deleted before the
        // write, so a refused edit could leave the row pointing at nothing.
        const fileStates = productData.fileStates || {};
        const uploaded: string[] = [];
        const replaced: string[] = [];
        const fileData: Record<string, string | null> = {};

        for (const field of ['image', 'barcode'] as const) {
          const column = field === 'image' ? 'pic' : 'barcode';
          const state = fileStates[field];
          const stored = existingProduct[column];
          const incoming = files[field]?.[0];

          if (state?.hasNewFile && incoming) {
            try {
              const url = await uploadFileToStorage(incoming);
              if (url) {
                uploaded.push(url);
                fileData[column] = url;
                if (stored) replaced.push(stored);
              }
            } catch (uploadError) {
              // Continue without the file - don't fail the entire update.
              console.error(`${field} upload failed:`, uploadError);
            }
          } else if (state && state.hasNewFile === false && state.existingUrl === null) {
            // The user removed the current file.
            fileData[column] = null;
            if (stored) replaced.push(stored);
          }
          // Anything else: the client said nothing about this file; leave it.
        }

        const discardUploads = () => Promise.all(uploaded.map(deleteOldFile));

        // Only client-writable fields, and only the ones actually sent (F-75,
        // F-78, F-84). File columns come from the block above, not the payload.
        const finalData: any = { ...(await buildProductData(productData, { partial: true })), ...fileData };

        if (Object.keys(finalData).length === 0) {
          return res.status(400).json({ message: 'No changes supplied' });
        }

        // The name is rebuilt from what the row WILL hold - stored values
        // overlaid with this update - and display_name moves with it (PQ-12,
        // PQ-55). display_name used to be written once, on create, and go stale.
        const name = await buildProductName(productId, { ...existingProduct, ...finalData });
        finalData.product_name = name;
        finalData.display_name = name;

        try {
          // Optimistic concurrency when the client sends the updated_at it
          // loaded (F-83): 409 instead of silently overwriting someone else.
          if (productData.updated_at !== undefined) {
            const seen = productData.updated_at === null ? null : new Date(productData.updated_at);
            if (seen !== null && isNaN(seen.getTime())) {
              await discardUploads();
              return res.status(400).json({ message: 'Invalid updated_at value' });
            }

            const { count } = await prisma.product.updateMany({
              where: { id: productId, updated_at: seen },
              data: finalData
            });

            if (count === 0) {
              await discardUploads();
              return res.status(409).json({
                message: 'This product was changed by someone else while you were editing it. Reload the product and reapply your changes.'
              });
            }
          } else {
            await prisma.product.update({ where: { id: productId }, data: finalData });
          }
        } catch (writeError) {
          await discardUploads();
          throw writeError;
        }

        await Promise.all(replaced.map(deleteOldFile));

        const reloaded = await prisma.product.findUnique({ where: { id: productId } });
        return res.status(200).json(await enhanceProduct(reloaded));
      }

      // No DELETE. Deactivation is PATCH /api/products/[id]/status - the route
      // the app actually uses. This DELETE did the same thing with no caller (PQ-33).
      default:
        res.setHeader('Allow', ['GET', 'PUT']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error: any) {
    console.error('API error:', error);

    // Translate the database's own errors instead of forwarding them. The raw
    // Prisma message names tables and constraints, which should not leave the
    // server (F-81), and a missing row read as a 500 rather than a 404 (F-80).
    if (error?.code === 'P2025') {
      return res.status(404).json({ message: 'Product not found' });
    }
    if (error?.code === 'P2003') {
      return res.status(400).json({ message: 'A selected category, company, warehouse, rack or GST rate does not exist' });
    }
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'That value is already in use by another product' });
    }

    return res.status(500).json({ message: 'Server error' });
  }
}
// Wrapped like its siblings. Six of the eight product API files had this and
// these two did not, so the busiest route in the module - the one that reads,
// edits and deactivates a product - was the one with no request logging (F-89).
export default withObservability(handler);
