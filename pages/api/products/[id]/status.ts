import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../../lib/db';
import { withObservability } from '../../../../lib/withObservability';

/**
 * Activate or deactivate a product.
 *
 * This exists because deactivating had become a one-way door (F-91).
 *
 * F-63 changed DELETE /api/products/[id] from a hard delete to `is_active =
 * false`, and told the user the product "can be restored from Inactive
 * Products". It could not be. Both restore paths - the toggle on the product
 * view page and the button on settings/inactive-products - send
 * `PUT /api/products/[id]` with a JSON body, but that route sets
 * `bodyParser: false` and parses multipart form data, so every attempt came
 * back 400 "Product data is required". And had the body parsed, it would still
 * have failed: `is_active` is a SERVER_OWNED_FIELD that `buildProductData`
 * deliberately never maps, so the update would have been rejected as "No
 * changes supplied".
 *
 * Both of those are correct on their own terms. The product FORM has no
 * business setting `is_active`, and the form endpoint has no business parsing
 * JSON. Activation is a state transition, not a field edit, so it gets its own
 * route with its own body parser - the same shape as the DELETE that
 * deactivates.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH' && req.method !== 'PUT') {
    res.setHeader('Allow', ['PATCH', 'PUT']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const productId = parseInt(req.query.id as string, 10);
  if (isNaN(productId)) {
    return res.status(400).json({ message: 'Invalid product ID' });
  }

  const { is_active } = (req.body ?? {}) as { is_active?: unknown };
  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ message: 'is_active must be true or false' });
  }

  try {
    const existing = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, is_active: true }
    });
    if (!existing) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (existing.is_active === is_active) {
      return res.status(200).json({
        status: 'success',
        id: productId,
        is_active,
        message: `Product is already ${is_active ? 'active' : 'inactive'}.`
      });
    }

    const updated = await prisma.product.update({
      where: { id: productId },
      data: { is_active },
      select: { id: true, is_active: true }
    });

    return res.status(200).json({
      status: 'success',
      id: updated.id,
      is_active: updated.is_active,
      message: `Product ${is_active ? 'reactivated' : 'deactivated'}.`
    });
  } catch (error: any) {
    console.error('Product status change failed:', error);
    // The database's own message names tables and constraints and should not
    // leave the server (F-81).
    if (error?.code === 'P2025') {
      return res.status(404).json({ message: 'Product not found' });
    }
    return res.status(500).json({ message: 'Server error' });
  }
}

export default withObservability(handler);
