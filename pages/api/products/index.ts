import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { validateProduct, findConflictingPartNo, buildProductData, partNoConflictMessage, buildProductName } from '../../../lib/product';
import { withObservability } from '../../../lib/withObservability';
import { parseProductForm, readProductData, uploadProductFile, deleteProductFile } from '../../../lib/product-files';
import { created, ok, badRequest, fail } from '../../../lib/api/respond';
import { listResponse } from '../../../lib/api/list-query';
import { parseProductListQuery, listProducts } from '../../../lib/product-query';

// ---------------------
// GET handler: the product list (lib/product-query.ts)
// ---------------------
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { products, pagination } = await listProducts(parseProductListQuery(req));
    return ok(res, listResponse(products, pagination, 'products'));
  } catch (error) {
    return fail(res, error, 'load products');
  }
}

// ---------------------
// POST handler: Create product
// ---------------------
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const uploaded: string[] = [];
  try {
    const { fields, files } = await parseProductForm(req);
    const productData = readProductData(fields);
    if (!productData) return badRequest(res, 'Product data is missing or not valid JSON');

    // Validate before uploading anything (F-104); same rules as update (F-79).
    const failure = await validateProduct(productData, { partial: false });
    if (failure) return res.status(failure.status).json({ message: failure.message });

    const partNoConflict = await findConflictingPartNo(productData.part_no);
    if (partNoConflict) return badRequest(res, partNoConflictMessage(productData.part_no, partNoConflict));

    const fileUrls: { pic: string | null; barcode: string | null } = { pic: null, barcode: null };
    for (const [field, column] of [['image', 'pic'], ['barcode', 'barcode']] as const) {
      const file = files[field]?.[0];
      if (!file) continue;
      try {
        const url = await uploadProductFile(file);
        uploaded.push(url);
        fileUrls[column] = url;
      } catch (uploadError) {
        // Create the product without the file rather than not at all.
        console.error(`${field} upload failed:`, uploadError);
      }
    }

    const data: any = await buildProductData(productData, { partial: false });
    // Opening stock is the starting stock - here, at creation, only (F-75).
    data.stock = data.opening_stock;
    data.pic = fileUrls.pic;
    data.barcode = fileUrls.barcode;

    // The name needs the new id: insert and name in one transaction (PQ-12, F-105).
    const product = await prisma.$transaction(async (tx) => {
      const row = await tx.product.create({ data: { ...data, product_name: '' } });
      const name = await buildProductName(row.id, data);
      return tx.product.update({ where: { id: row.id }, data: { product_name: name, display_name: name } });
    });

    return created(res, { id: product.id, product_name: product.product_name, part_no: product.part_no }, 'Product created');
  } catch (error) {
    await Promise.all(uploaded.map(deleteProductFile));
    return fail(res, error, 'create the product');
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
