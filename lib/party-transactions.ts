import { prisma } from './db';
import { parseDateRange, convertDateToTimestamp } from './date-utils';

/**
 * The Customer Transaction and Vendor Transaction lists: one party's payments
 * and refunds as one list, newest or oldest first, with the period's totals.
 * Both routes were copies of each other with the same faults:
 *
 *  - the payment-mode filter was applied as `payment_mode` to the refunds too,
 *    a column refunds do not have (it is `refund_mode`): filtering by mode with
 *    "All" types was a 500;
 *  - a date range needed both ends;
 *  - there were no totals, so the screen could only add up the page it showed;
 *  - each request ended with `prisma.$disconnect()` on the shared client.
 *
 * Customer: payments are INCOME, refunds EXPENSE. Vendor: the other way round.
 */
export type TxParty = 'customer' | 'vendor';

const P = {
  customer: {
    payments: 'customer_payments', refunds: 'customer_refunds', partyFk: 'customer_id',
    relation: 'customer', nameField: 'billing_name', nameKey: 'customer_name', idKey: 'customer_id',
    payment: 'INCOME', refund: 'EXPENSE'
  },
  vendor: {
    payments: 'vendor_payments', refunds: 'vendor_refunds', partyFk: 'vendor_id',
    relation: 'vendor', nameField: 'vendor_name', nameKey: 'vendor_name', idKey: 'vendor_id',
    payment: 'EXPENSE', refund: 'INCOME'
  }
} as const;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pad3 = (n: number) => String(n).padStart(3, '0');
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as string | undefined;

function dateWhere(from?: string, to?: string) {
  if (from && to) {
    const { startTimestamp, endTimestamp } = parseDateRange(from, to);
    return { gte: startTimestamp, lte: endTimestamp };
  }
  if (from) return { gte: convertDateToTimestamp(from.split('T')[0]) };
  if (to) return { lte: parseDateRange(to, to).endTimestamp };
  return undefined;
}

export async function listPartyTransactions(party: TxParty, q: Record<string, unknown>) {
  const p = P[party];
  const db = prisma as any;
  const partyId = parseInt(one(q[p.partyFk]) || '');
  const mode = one(q.payment_mode);
  const kindFilter = one(q.payment_type);
  const type = (one(q.type) || 'all').toLowerCase();
  const page = Math.max(1, parseInt(one(q.page) || '1') || 1);
  const limit = Math.min(1000, Math.max(1, parseInt(one(q.limit) || '50') || 50));
  const sortBy = one(q.sortBy) || 'date';
  const sortOrder = one(q.sortOrder) === 'asc' ? 'asc' : 'desc';
  const dates = dateWhere(one(q.dateFrom), one(q.dateTo));
  const modeNum = mode !== undefined && mode !== '' ? parseInt(mode) : null;

  const base: any = Number.isInteger(partyId) ? { [p.partyFk]: partyId } : {};
  const want = (direction: string) => type === 'all' || type === direction.toLowerCase();

  const rows: any[] = [];
  if (want(p.payment)) {
    const where: any = { ...base };
    if (dates) where.payment_date = dates;
    if (modeNum !== null) where.payment_mode = modeNum;
    if (kindFilter) where.payment_type = kindFilter;
    const payments = await db[p.payments].findMany({
      where,
      include: {
        [p.relation]: { select: { id: true, [p.nameField]: true } },
        allocations: {
          include: party === 'customer'
            ? { invoice: { select: { invoice_no: true } }, invoicex: { select: { invoice_no: true } } }
            : { purchase: { select: { invoice_no: true } } }
        }
      }
    });
    for (const x of payments) {
      rows.push({
        id: x.id,
        transaction_type: p.payment,
        [p.idKey]: x[p.partyFk],
        [p.nameKey]: x[p.relation]?.[p.nameField] || 'Unknown',
        date: x.payment_date,
        amount: Number(x.payment_amount),
        payment_mode: x.payment_mode,
        payment_type: x.payment_type || 'BILL_SPECIFIC',
        notes: x.notes,
        invoice_numbers: (x.allocations || []).map((a: any) =>
          a.invoicex ? `C-${a.invoicex.invoice_no}` : a.invoice ? `INV-${a.invoice.invoice_no}` : a.purchase ? `INV-${a.purchase.invoice_no}` : 'N/A'),
        allocations_count: (x.allocations || []).length,
        fy: x.fy,
        created_at: x.created_at
      });
    }
  }
  if (want(p.refund)) {
    const where: any = { ...base };
    if (dates) where.refund_date = dates;
    if (modeNum !== null) where.refund_mode = modeNum;
    if (kindFilter) where.refund_type = kindFilter;
    const refunds = await db[p.refunds].findMany({
      where,
      include: {
        [p.relation]: { select: { id: true, [p.nameField]: true } },
        allocations: {
          include: party === 'customer'
            ? { sale_return: { select: { id: true } }, salex_return: { select: { id: true } } }
            : { return: { select: { id: true, debit_note_no: true } } }
        }
      }
    });
    for (const x of refunds) {
      rows.push({
        id: x.id,
        transaction_type: p.refund,
        [p.idKey]: x[p.partyFk],
        [p.nameKey]: x[p.relation]?.[p.nameField] || 'Unknown',
        date: x.refund_date,
        amount: Number(x.refund_amount),
        payment_mode: x.refund_mode,
        payment_type: x.refund_type || 'DIRECT',
        notes: x.notes,
        invoice_numbers: (x.allocations || []).map((a: any) =>
          a.sale_return ? `SR-${pad3(a.sale_return.id)}` : a.salex_return ? `SXR-${pad3(a.salex_return.id)}`
            : a.return ? (a.return.debit_note_no || `PR-${pad3(a.return.id)}`) : ''),
        allocations_count: (x.allocations || []).length,
        fy: x.fy,
        created_at: x.created_at
      });
    }
  }

  const key = (t: any) => {
    switch (sortBy) {
      case 'id': return t.id;
      case 'amount': return t.amount;
      case 'type': return t.transaction_type;
      case 'customer_name': case 'vendor_name': return String(t[p.nameKey]).toLowerCase();
      default: return t.date;
    }
  };
  rows.sort((a, b) => {
    const x = key(a), y = key(b);
    const c = x < y ? -1 : x > y ? 1 : (a.date - b.date) || (a.id - b.id);
    return sortOrder === 'desc' ? -c : c;
  });

  const income = r2(rows.filter(t => t.transaction_type === 'INCOME').reduce((s, t) => s + t.amount, 0));
  const expense = r2(rows.filter(t => t.transaction_type === 'EXPENSE').reduce((s, t) => s + t.amount, 0));
  const total = rows.length;
  return {
    success: true,
    data: rows.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    // Over the whole filtered set, not the page shown.
    totals: { income, expense, net: r2(income - expense), count: total }
  };
}
