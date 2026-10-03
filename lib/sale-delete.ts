import { prisma } from './db';
import { customerTransactionHandler } from './customer-transaction-handler';
import { SaleKind, SaleError, saleTables } from './sale';

/**
 * Deleting a sale or salex. One function for both kinds - the two routes held
 * copies, and the "Other"-customer half of each was hand-written again.
 *
 * Refused while any return exists (the purchase rule, PU-02): the return put
 * its qty back on the shelf and carries a credit note.
 */
export async function deleteSale(kind: SaleKind, docId: number): Promise<void> {
  const t = saleTables(kind);
  const doc = await (prisma as any)[t.header].findUnique({
    where: { id: docId },
    select: { id: true, invoice_no: true, select_customer: true, payment_status: true, return_status: true }
  });
  if (!doc) throw new SaleError(404, `${t.label} not found`, 'NOT_FOUND');

  const lines = await (prisma as any)[t.items].findMany({ where: { invoice_no: docId }, select: { id: true } });
  const [returnLines, returnDocs] = await Promise.all([
    lines.length
      ? (prisma as any)[t.returnItems].count({ where: { [t.returnItemFk]: { in: lines.map((l: any) => l.id) } } })
      : Promise.resolve(0),
    (prisma as any)[t.returns].count({ where: { [t.returnHeaderFk]: docId } })
  ]);
  if (returnLines > 0 || returnDocs > 0) {
    throw new SaleError(400, 'This bill has returns. Delete its returns first.', 'HAS_RETURNS');
  }

  if (doc.select_customer) {
    const ops = await customerTransactionHandler.handleSaleDelete({
      type: kind,
      invoiceId: docId,
      customerId: doc.select_customer,
      invoiceNo: doc.invoice_no,
      paymentStatus: doc.payment_status ?? 0,
      returnStatus: doc.return_status ?? 0
    });
    await prisma.$transaction(async (tx) => {
      await customerTransactionHandler.executeDeleteInTransaction(tx, ops);
    }, { timeout: 45000 });
    return;
  }

  // "Other": no account, so no ledger or allocations - stock and records only.
  await prisma.$transaction(async (tx: any) => {
    const items = await tx[t.items].findMany({ where: { invoice_no: docId } });
    for (const item of items) {
      const qty = Math.round(Number(item.qty) || 0);
      if (qty) await tx.product.update({ where: { id: item.product_id }, data: { stock: { increment: qty } } });
    }
    await tx[t.items].deleteMany({ where: { invoice_no: docId } });
    await tx[t.billTo].deleteMany({ where: { invoice_no: docId } });
    await tx[t.shipTo].deleteMany({ where: { invoice_no: docId } });
    await tx[t.transport].deleteMany({ where: { invoice_id: docId } });
    if (kind === 'salex') await tx.incexpx.deleteMany({ where: { invoice_id: docId } });
    await tx.customer_payment_allocations.deleteMany({ where: { [t.allocFk]: docId } });
    await tx[t.header].delete({ where: { id: docId } });
  }, { timeout: 45000 });
}
