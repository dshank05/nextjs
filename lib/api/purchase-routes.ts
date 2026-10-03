import type { NextApiRequest, NextApiResponse } from 'next'
import { ok, badRequest, notFound, fail, parseId, route } from './respond'
import { listResponse } from './list-query'
import { SaleError } from '../sale'
import { PurchaseEditError, updatePurchase } from '../purchase-edit'
import { createPurchase } from '../purchase-create'
import { deletePurchase } from '../purchase-delete'
import { loadPurchaseDetail } from '../purchase-read'
import { listPurchases, parsePurchaseListQuery } from '../purchase-query'

/**
 * The purchase API routes (BILLS_PLAN B1), the shape of lib/api/sale-routes.ts:
 * the route files are one line each and the work lives in lib/purchase-*.ts.
 * Every response shape is the one the routes gave before.
 */

/** A refusal with its own message; Prisma conflicts translated; anything else a bare 500. */
export function answerPurchaseError(res: NextApiResponse, error: any, context: string) {
  if (error instanceof SaleError || error instanceof PurchaseEditError) {
    return res.status(error.httpStatus).json({
      status: 'failure',
      message: error.clientMessage,
      error_code: error.code,
      ...(error.detail ? { item: error.detail } : {})
    })
  }
  if (error?.code === 'P2002') {
    console.error(`${context}:`, error)
    return res.status(409).json({
      status: 'failure',
      message: 'That purchase conflicts with an existing record. Check the invoice number for this financial year.',
      error_code: 'DUPLICATE_RECORD'
    })
  }
  if (error?.code === 'P2003') {
    console.error(`${context}:`, error)
    return res.status(400).json({ status: 'failure', message: 'A selected vendor, staff member or product does not exist' })
  }
  return fail(res, error, context)
}

/** /api/purchases: list (GET) and create (POST). */
export async function purchaseCollectionRoute(req: NextApiRequest, res: NextApiResponse) {
  return route(req, res, {
    GET: async () => {
      try {
        const { purchases, pagination } = await listPurchases(parsePurchaseListQuery(req))
        return res.status(200).json(listResponse(purchases, pagination, 'purchases'))
      } catch (error) {
        return fail(res, error, 'fetch purchases')
      }
    },
    POST: async () => {
      try {
        const purchase = await createPurchase(req.body)
        return res.status(201).json({ message: 'Purchase created successfully', purchase })
      } catch (error) {
        return answerPurchaseError(res, error, 'create purchase')
      }
    }
  })
}

/** /api/purchases/[id]: read, edit, delete. */
export async function purchaseDocumentRoute(req: NextApiRequest, res: NextApiResponse) {
  const id = parseId(req.query.id)
  if (id === null) return badRequest(res, 'Invalid purchase ID')
  return route(req, res, {
    GET: async () => {
      try {
        const purchase = await loadPurchaseDetail(id)
        if (!purchase) return notFound(res, 'Purchase not found')
        return ok(res, purchase)
      } catch (error) {
        return fail(res, error, 'fetch purchase')
      }
    },
    PUT: async () => {
      try {
        await updatePurchase(id, req.body)
        return res.status(200).json({ status: 'success', message: 'Purchase updated successfully' })
      } catch (error) {
        return answerPurchaseError(res, error, 'update purchase')
      }
    },
    DELETE: async () => {
      try {
        await deletePurchase(id)
        return res.status(200).json({ success: true, message: 'Purchase deleted successfully' })
      } catch (error) {
        return answerPurchaseError(res, error, 'delete purchase')
      }
    }
  })
}
