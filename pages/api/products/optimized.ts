import type { NextApiRequest, NextApiResponse } from 'next'
import products from './index'
import { methodNotAllowed } from '../../../lib/api/respond'

/**
 * Kept as an alias for one release. The product list is `GET /api/products`
 * (lib/product-query.ts); this was the second list endpoint for the same table,
 * with its own parameters, sorts and prices (PQ-20).
 */
export default function optimized(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  return products(req, res)
}

