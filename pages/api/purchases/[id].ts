import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { transactionHandler } from '../../../lib/transaction-handler'
import { loadPurchaseDetail } from '../../../lib/purchase-read'
import { updatePurchase, PurchaseEditError } from '../../../lib/purchase-edit'
import { ok, badRequest, notFound, fail, parseId, route } from '../../../lib/api/respond'
import { withObservability } from '../../../lib/withObservability'

/**
 * GET / PUT / DELETE one purchase. The work lives in lib/purchase-read.ts and
 * lib/purchase-edit.ts; this file only routes and answers.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const purchaseId = parseId(req.query.id)
  if (purchaseId === null) return badRequest(res, 'Invalid purchase ID')

  return route(req, res, {
    GET: () => getPurchase(purchaseId, res),
    PUT: () => putPurchase(purchaseId, req, res),
    DELETE: () => deletePurchase(purchaseId, res)
  })
}

async function getPurchase(purchaseId: number, res: NextApiResponse) {
  try {
    const purchase = await loadPurchaseDetail(purchaseId)
    if (!purchase) return notFound(res, 'Purchase not found')
    return ok(res, purchase)
  } catch (error) {
    return fail(res, error, 'fetch purchase')
  }
}

async function putPurchase(purchaseId: number, req: NextApiRequest, res: NextApiResponse) {
  try {
    await updatePurchase(purchaseId, req.body)
    return res.status(200).json({ status: 'success', message: 'Purchase updated successfully' })
  } catch (error: any) {
    if (error instanceof PurchaseEditError) {
      return res.status(error.httpStatus).json({
        status: 'failure',
        message: error.clientMessage,
        error_code: error.code,
        ...(error.detail ? { item: error.detail } : {})
      })
    }
    if (error?.code === 'P2002') {
      console.error('update purchase:', error)
      return res.status(409).json({
        status: 'failure',
        message: 'That purchase conflicts with an existing record. Check the invoice number for this financial year.'
      })
    }
    if (error?.code === 'P2003') {
      console.error('update purchase:', error)
      return res.status(400).json({ status: 'failure', message: 'A selected vendor, staff member or product does not exist' })
    }
    return fail(res, error, 'update purchase')
  }
}

async function deletePurchase(purchaseId: number, res: NextApiResponse) {
  try {
    const purchase = await prisma.purchase.findUnique({
      where: { id: purchaseId },
      select: { invoice_no: true, fy: true, payment_status: true, vendor_id: true, return_status: true }
    })
    if (!purchase) return notFound(res, 'Purchase not found')

    // Refused while any return exists, partial or full (PU-02/03): the return
    // already took its qty out of stock and may carry a refund. Counted from
    // the return lines and the return headers, not return_status.
    const lines = await prisma.purchaseitems.findMany({
      where: { invoice_no: purchase.invoice_no, fy: purchase.fy },
      select: { id: true }
    })
    const [returnLines, returnDocs] = await Promise.all([
      lines.length
        ? prisma.purchase_return_items.count({ where: { purchase_item_id: { in: lines.map(l => l.id) } } })
        : Promise.resolve(0),
      prisma.purchase_returns.count({ where: { purchase_id: purchaseId } })
    ])
    if (returnLines > 0 || returnDocs > 0) {
      return res.status(400).json({ message: 'This purchase has returns. Delete its returns first.', error_code: 'HAS_RETURNS' })
    }

    const ops = await transactionHandler.handlePurchaseDelete({
      purchaseId,
      vendorId: purchase.vendor_id as number,
      invoiceNo: purchase.invoice_no,
      fy: purchase.fy,
      paymentStatus: purchase.payment_status ?? 0,
      returnStatus: purchase.return_status ?? 0
    })
    await prisma.$transaction(async (tx) => {
      await transactionHandler.executeDeleteInTransaction(tx, ops)
    }, { timeout: 45000 })

    return res.status(200).json({ success: true, message: 'Purchase deleted successfully' })
  } catch (error) {
    return fail(res, error, 'delete purchase')
  }
}

export default withObservability(handler)
