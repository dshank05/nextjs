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
    select: { invoice_no: true, fy: true, payment_status: true, vendor_id: true, return_status: true, invoice_date: true }
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
    await restoreLatestPurchase(tx, Array.from(out.keys()), purchase.invoice_date)
  }, { timeout: 45000 })
}

/**
 * The product's latest purchase rate and date after a purchase is deleted (A-09, owner: delete
 * rolls back completely). Create / edit set them from the newest bill; the deleted bill may have
 * been it, so a product whose last_purchase_date is that bill's date takes them from its newest
 * remaining purchase line, or none when no purchase of it is left. A product whose date is
 * another bill's (newer, or a value set elsewhere) is left alone.
 */
export async function restoreLatestPurchase(tx: any, productIds: number[], deletedDate: number | null): Promise<void> {
  if (deletedDate === null || deletedDate === undefined) return
  for (const productId of productIds) {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, last_purchase_date: true } })
    if (!product || product.last_purchase_date === null || Number(product.last_purchase_date) !== Number(deletedDate)) continue
    const newest = await tx.purchaseitems.findFirst({
      where: { product_id: productId },
      orderBy: [{ invoice_date: 'desc' }, { id: 'desc' }],
      select: { rate: true, invoice_date: true }
    })
    await tx.product.update({
      where: { id: productId },
      data: newest
        ? { latest_purchase_rate: newest.rate, last_purchase_date: newest.invoice_date }
        : { latest_purchase_rate: null, last_purchase_date: null }
    })
  }
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
