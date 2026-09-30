import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { validateProduct, findConflictingPartNo, buildProductData, partNoConflictMessage, buildProductName, sellingPrice } from '../../../lib/product'
import { parseProductForm, readProductData, uploadProductFile, deleteProductFile } from '../../../lib/product-files'
import { ok, badRequest, notFound, conflict, fail, parseId, route } from '../../../lib/api/respond'
import { withObservability } from '../../../lib/withObservability'

/** The product with the names, rates and prices the view and edit pages show. */
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

// Multipart for PUT (the product form); GET has no body.
export const config = { api: { bodyParser: false } };

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const productId = parseId(req.query.id);
  if (productId === null) return badRequest(res, 'Invalid product ID');

  // No DELETE: deactivation is PATCH /api/products/[id]/status (PQ-33).
  return route(req, res, {
    GET: async () => {
      try {
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return notFound(res, 'Product not found');
        return ok(res, await enhanceProduct(product));
      } catch (error) {
        return fail(res, error, 'load the product');
      }
    },
    PUT: () => updateProduct(req, res, productId)
  });
}

async function updateProduct(req: NextApiRequest, res: NextApiResponse, productId: number) {
  const uploaded: string[] = [];
  const discardUploads = () => Promise.all(uploaded.map(deleteProductFile));
  try {
    const { fields, files } = await parseProductForm(req);
    const productData = readProductData(fields);
    if (!productData) return badRequest(res, 'Product data is missing or not valid JSON');

    const existingProduct = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true, pic: true, barcode: true,
        product_category_id: true, product_subcategory_id: true,
        company_id: true, car_model_ids: true, part_no: true
      }
    });
    if (!existingProduct) return notFound(res, 'Product not found');

    // Same rules as create; partial, so only what was sent is re-checked (F-79, F-99).
    const failure = await validateProduct(productData, { partial: true, productId });
    if (failure) return res.status(failure.status).json({ message: failure.message });

    const partNoConflict = await findConflictingPartNo(productData.part_no, productId);
    if (partNoConflict) return badRequest(res, partNoConflictMessage(productData.part_no, partNoConflict));

    // Files are decided from the STORED row; fileStates only says what the user
    // did (PQ-13). Upload -> write -> delete the replaced file (PQ-14).
    const fileStates = productData.fileStates || {};
    const replaced: string[] = [];
    const fileData: Record<string, string | null> = {};
    for (const field of ['image', 'barcode'] as const) {
      const column = field === 'image' ? 'pic' : 'barcode';
      const state = fileStates[field];
      const stored = existingProduct[column];
      const incoming = files[field]?.[0];
      if (state?.hasNewFile && incoming) {
        try {
          const url = await uploadProductFile(incoming);
          uploaded.push(url);
          fileData[column] = url;
          if (stored) replaced.push(stored);
        } catch (uploadError) {
          console.error(`${field} upload failed:`, uploadError);
        }
      } else if (state && state.hasNewFile === false && state.existingUrl === null) {
        fileData[column] = null;
        if (stored) replaced.push(stored);
      }
    }

    // Only client-writable fields that were sent (F-75, F-78, F-84).
    const finalData: any = { ...(await buildProductData(productData, { partial: true })), ...fileData };
    if (Object.keys(finalData).length === 0) {
      await discardUploads();
      return badRequest(res, 'No changes supplied');
    }

    // Name and display_name rebuilt from what the row will hold (PQ-12, PQ-55).
    const name = await buildProductName(productId, { ...existingProduct, ...finalData });
    finalData.product_name = name;
    finalData.display_name = name;

    // Optimistic concurrency when the client sends the updated_at it loaded (F-83).
    if (productData.updated_at !== undefined) {
      const seen = productData.updated_at === null ? null : new Date(productData.updated_at);
      if (seen !== null && isNaN(seen.getTime())) {
        await discardUploads();
        return badRequest(res, 'Invalid updated_at value');
      }
      const { count } = await prisma.product.updateMany({ where: { id: productId, updated_at: seen }, data: finalData });
      if (count === 0) {
        await discardUploads();
        return conflict(res, 'This product was changed by someone else while you were editing it. Reload the product and reapply your changes.');
      }
    } else {
      await prisma.product.update({ where: { id: productId }, data: finalData });
    }

    await Promise.all(replaced.map(deleteProductFile));
    const reloaded = await prisma.product.findUnique({ where: { id: productId } });
    return ok(res, await enhanceProduct(reloaded));
  } catch (error) {
    await discardUploads();
    return fail(res, error, 'update the product');
  }
}

export default withObservability(handler);
