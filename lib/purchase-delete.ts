import { prisma } from './db'
import { transactionHandler } from './transaction-handler'
import { SaleError } from './sale'

/**
 * Deleting a purchase (DELETE /api/purchases/[id]), moved out of the route
 * (BILLS_PLAN B1). Refused while the bill has returns (PU-02), and - new,
 * owner 2026-10-03 - when its units are no longer all in stock: taking them
 * out again would leave stock below zero, the way a sale refuses to sell what
 * is not there.
 */
export async function deletePurchase(purchaseId: number): Promise<void> {
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    select: { invoice_no: true, fy: true, payment_status: true, vendor_id: true, return_status: true }
  })
  if (!purchase) throw new SaleError(404, 'Purchase not found', 'NOT_FOUND')

  const lines = await prisma.purchaseitems.findMany({
    where: { purchase_id: purchaseId },
    select: { id: true, product_id: true, qty: true }
  })
  const [returnLines, returnDocs] = await Promise.all([
    lines.length ? prisma.purchase_return_items.count({ where: { purchase_item_id: { in: lines.map(l => l.id) } } }) : Promise.resolve(0),
    prisma.purchase_returns.count({ where: { purchase_id: purchaseId } })
  ])
  if (returnLines > 0 || returnDocs > 0) {
    throw new SaleError(400, 'This purchase has returns. Delete its returns first.', 'HAS_RETURNS')
  }

  const out = new Map<number, number>()
  for (const l of lines) if (l.product_id && l.qty) out.set(l.product_id, (out.get(l.product_id) || 0) + l.qty)

  const ops = await transactionHandler.handlePurchaseDelete({
    purchaseId,
    vendorId: purchase.vendor_id as number,
    invoiceNo: purchase.invoice_no,
    fy: purchase.fy,
    paymentStatus: purchase.payment_status ?? 0,
    returnStatus: purchase.return_status ?? 0
  })
  await prisma.$transaction(async (tx: any) => {
    await assertStockCovers(tx, out, (name, have, need) =>
      `Cannot delete this purchase: only ${have} of "${name}" is in stock and the purchase brought in ${need}. Some of it has been sold.`)
    await transactionHandler.executeDeleteInTransaction(tx, ops)
  }, { timeout: 45000 })
}

/**
 * Taking `need` units per product back out of stock must not leave any product
 * below zero. Read inside the transaction that then moves the stock.
 */
export async function assertStockCovers(
  tx: any,
  need: Map<number, number>,
  message: (name: string, have: number, need: number) => string
): Promise<void> {
  const ids = Array.from(need.keys()).filter(id => (need.get(id) || 0) > 0)
  if (!ids.length) return
  const products = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, product_name: true, stock: true } })
  for (const p of products) {
    const have = Number(p.stock) || 0
    const want = Math.round(need.get(p.id) || 0)
    if (want > have) {
      throw new SaleError(400, message(p.product_name, have, want), 'INSUFFICIENT_STOCK',
        { product_id: p.id, product_name: p.product_name, available: have, requested: want })
    }
  }
}
