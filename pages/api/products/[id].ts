import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { validateProduct, findConflictingPartNo, buildProductData, partNoConflictMessage, buildProductName, sellingPrice } from '../../../lib/product'
import { parseProductForm, readProductData, uploadProductFile, deleteProductFile } from '../../../lib/product-files'
import { ok, badRequest, notFound, conflict, fail, parseId, route } from '../../../lib/api/respond'
import { withObservability } from '../../../lib/withObservability'
import { latestPurchaseRates } from '../../../lib/product-query'

/**
 * The product with the names, rates and prices the view and edit pages show:
 * one query with its relations, one for car model names, one for the latest
 * purchase rate. This ran seven `findMany({ id: { in: [one id] } })` lookups
 * and its own latest-rate query with a different tie-break (PQ-18, PQ-22).
 */
async function loadProductDetail(id: number) {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category_ref: { select: { category_name: true } },
      subcategory_ref: { select: { subcategory_name: true } },
      product_company_ref: { select: { company_name: true } },
      warehouse: { select: { name: true, location: true } },
      rack: { select: { rack_number: true } },
      gst_rate: { select: { rate: true } }
    }
  });
  if (!product) return null;

  const modelIds = (product.car_model_ids || '').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  const [models, rates] = await Promise.all([
    modelIds.length ? prisma.car_models.findMany({ where: { id: { in: modelIds } }, select: { id: true, model_name: true } }) : Promise.resolve([] as { id: number; model_name: string }[]),
    latestPurchaseRates([id])
  ]);
  const modelName = new Map<number, string>(models.map((m) => [m.id, m.model_name] as [number, string]));
  const latestPurchaseRate = rates.get(id)?.rate || product.latest_purchase_rate || 0;
  const { category_ref, subcategory_ref, product_company_ref, warehouse, rack, gst_rate, ...row } = product;

  return {
    ...row,
    categoryName: category_ref?.category_name || '',
    subcategoryName: subcategory_ref?.subcategory_name || '',
    companyName: product_company_ref?.company_name || '',
    warehouse: warehouse ? `${warehouse.name} - ${warehouse.location}` : '',
    rack_number: rack?.rack_number || product.rack_number || '',
    carModelsDisplay: modelIds.map((m) => modelName.get(m)).filter(Boolean).join(', '),
    latestPurchaseRate,
    // One selling-price rule everywhere (PQ-39).
    sale_price: sellingPrice({ latestPurchaseRate, opening_rate: product.opening_rate, margin: product.margin, discount: product.discount }),
    gst_rate: gst_rate?.rate ?? 0,
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
        const product = await loadProductDetail(productId);
        if (!product) return notFound(res, 'Product not found');
        return ok(res, product);
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
    return ok(res, await loadProductDetail(productId));
  } catch (error) {
    await discardUploads();
    return fail(res, error, 'update the product');
  }
}

export default withObservability(handler);
