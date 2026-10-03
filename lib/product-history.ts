import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from './db';
import { ok, badRequest, fail, parseId, methodNotAllowed } from './api/respond';
import type { ProductTransactionRow } from '../types/products';

/**
 * The product view's five "last five" tables, from one module (PQ-21).
 *
 * They were five endpoint files, two pairs of which differed only in table
 * names. Rules that now hold in one place:
 * - dates are ISO strings, formatted once in the browser (PQ-01);
 * - sale and salex lines store the HEADER's primary key in `invoice_no`, so the
 *   header is found by id (PQ-02);
 * - purchase lines carry the human invoice number and the financial year, and
 *   the number repeats across years, so the header is matched on both (PQ-03).
 */

export type HistoryKind = 'sales' | 'salex' | 'purchases' | 'sale-returns' | 'purchase-returns';

const LIMIT = 5;
const iso = (unix: number | null | undefined) => (unix ? new Date(Number(unix) * 1000).toISOString() : null);

const row = (i: number, r: Omit<ProductTransactionRow, 'sn' | 'amount'>): ProductTransactionRow => ({
  sn: i + 1,
  ...r,
  amount: Number(r.qty || 0) * Number(r.rate || 0)
});

async function customers(ids: (number | null | undefined)[]) {
  const list = ids.filter((id): id is number => !!id);
  const rows = list.length
    ? await prisma.customer_details.findMany({ where: { id: { in: list } }, select: { id: true, billing_name: true } })
    : [];
  return new Map(rows.map((c) => [c.id, c.billing_name]));
}

async function vendors(ids: (number | null | undefined)[]) {
  const list = ids.filter((id): id is number => !!id);
  const rows = list.length
    ? await prisma.vendor_details.findMany({ where: { id: { in: list } }, select: { id: true, vendor_name: true } })
    : [];
  return new Map(rows.map((v) => [v.id, v.vendor_name]));
}

/** Sales or salex: the two families are the same shape on different tables. */
async function saleHistory(productId: number, x: boolean): Promise<ProductTransactionRow[]> {
  const items: any[] = await ((x ? prisma.invoice_itemsx : prisma.invoiceitems) as any).findMany({
    where: { product_id: productId, qty: { gt: 0 } },
    orderBy: { invoice_date: 'desc' },
    take: LIMIT
  });
  const headers: any[] = await ((x ? prisma.invoicex : prisma.invoice) as any).findMany({
    where: { id: { in: items.map((i) => i.invoice_no) } },
    select: { id: true, invoice_no: true, select_customer: true }
  });
  const byId = new Map(headers.map((h) => [h.id, h]));
  const names = await customers(headers.map((h) => h.select_customer));
  return items.map((item, i) => {
    const header = byId.get(item.invoice_no);
    return row(i, {
      invoice_number: header?.invoice_no?.toString() || '-',
      customer: (header && names.get(header.select_customer)) || '-',
      qty: item.qty || 0,
      rate: item.rate || 0,
      date: iso(item.invoice_date)
    });
  });
}

async function purchaseHistory(productId: number): Promise<ProductTransactionRow[]> {
  const items = await prisma.purchaseitems.findMany({
    where: { product_id: productId, qty: { gt: 0 } },
    orderBy: { invoice_date: 'desc' },
    take: LIMIT,
    // Each line's own bill, by id (P4-11).
    include: { purchase: { select: { bill_reference: true, invoice_date: true } } }
  });
  const names = await vendors(items.map((i) => i.vendor_id));
  return items.map((item, i) => {
    const header = item.purchase;
    return row(i, {
      invoice_number: item.invoice_no?.toString() || '-',
      bill_reference: header?.bill_reference || '-',
      vendor: (item.vendor_id && names.get(item.vendor_id)) || '-',
      qty: item.qty || 0,
      rate: item.rate || 0,
      date: iso(header?.invoice_date)
    });
  });
}

async function saleReturnHistory(productId: number): Promise<ProductTransactionRow[]> {
  const lines = await prisma.invoiceitems.findMany({ where: { product_id: productId }, select: { id: true } });
  const items = lines.length
    ? await prisma.sale_return_items.findMany({
        where: { invoice_item_id: { in: lines.map((l) => l.id) }, return_qty: { gt: 0 } },
        orderBy: { sale_return_id: 'desc' },
        take: LIMIT
      })
    : [];
  const returns = await prisma.sale_returns.findMany({
    where: { id: { in: items.map((i) => i.sale_return_id) } },
    select: { id: true, return_date: true, invoice_id: true }
  });
  const invoices = await prisma.invoice.findMany({
    where: { id: { in: returns.map((r) => r.invoice_id) } },
    select: { id: true, select_customer: true }
  });
  const returnById = new Map(returns.map((r) => [r.id, r]));
  const invoiceById = new Map(invoices.map((v) => [v.id, v]));
  const names = await customers(invoices.map((v) => v.select_customer));
  return items.map((item, i) => {
    const ret = returnById.get(item.sale_return_id);
    const invoice = ret ? invoiceById.get(ret.invoice_id) : undefined;
    return row(i, {
      voucher_number: ret?.id?.toString() || '-',
      customer: (invoice && names.get(invoice.select_customer)) || '-',
      qty: item.return_qty || 0,
      rate: item.unit_price || 0,
      date: iso(ret?.return_date)
    });
  });
}

async function purchaseReturnHistory(productId: number): Promise<ProductTransactionRow[]> {
  const lines = await prisma.purchaseitems.findMany({ where: { product_id: productId }, select: { id: true } });
  const items = lines.length
    ? await prisma.purchase_return_items.findMany({
        where: { purchase_item_id: { in: lines.map((l) => l.id) }, return_qty: { gt: 0 } },
        orderBy: { purchase_return_id: 'desc' },
        take: LIMIT
      })
    : [];
  const returns = await prisma.purchase_returns.findMany({
    where: { id: { in: items.map((i) => i.purchase_return_id) } },
    select: { id: true, return_date: true, purchase_id: true }
  });
  const purchases = await prisma.purchase.findMany({
    where: { id: { in: returns.map((r) => r.purchase_id) } },
    select: { id: true, vendor_id: true }
  });
  const returnById = new Map(returns.map((r) => [r.id, r]));
  const purchaseById = new Map(purchases.map((p) => [p.id, p]));
  const names = await vendors(purchases.map((p) => p.vendor_id));
  return items.map((item, i) => {
    const ret = returnById.get(item.purchase_return_id);
    const purchase = ret ? purchaseById.get(ret.purchase_id) : undefined;
    return row(i, {
      voucher_number: ret?.id?.toString() || '-',
      vendor: (purchase?.vendor_id && names.get(purchase.vendor_id)) || '-',
      qty: Number(item.return_qty || 0),
      rate: Number(item.unit_price || 0),
      date: iso(ret?.return_date as any)
    });
  });
}

export function productHistory(kind: HistoryKind, productId: number): Promise<ProductTransactionRow[]> {
  switch (kind) {
    case 'sales': return saleHistory(productId, false);
    case 'salex': return saleHistory(productId, true);
    case 'purchases': return purchaseHistory(productId);
    case 'sale-returns': return saleReturnHistory(productId);
    case 'purchase-returns': return purchaseReturnHistory(productId);
  }
}

/** The route for one kind: GET only, id from the path, errors through fail(). */
export function historyRoute(kind: HistoryKind) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    const id = parseId(req.query.id);
    if (id === null) return badRequest(res, 'Invalid product ID');
    try {
      return ok(res, await productHistory(kind, id));
    } catch (error) {
      return fail(res, error, `load product ${kind}`);
    }
  };
}
