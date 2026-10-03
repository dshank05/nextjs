import { prisma } from './db';

/**
 * What each customer or vendor owes, or is owed - F-47 settled.
 *
 * The app had four definitions. The customer report used the payment
 * counters (total_allocated - total_paid + total_refunded -
 * total_refund_allocated), which never include a bill's TOTAL - an unpaid
 * bill did not show at all, and an advance showed as a debt. The vendor report
 * used the stored running `balance` of the party's latest ledger row, which is
 * only as good as the order rows were inserted and recalculated in.
 *
 * Source of truth now: the ledger itself, SUM(debit) - SUM(credit), up to the
 * end of the range. The same rows the ledger report shows, so the two always
 * agree. Positive: the customer owes us / we owe the vendor. Negative: credit
 * the other way (an advance, a completed return not yet refunded).
 */
export type OutstandingParty = 'customer' | 'vendor';

const P = {
  customer: {
    ledger: 'customer_ledger', fk: 'customer_id', details: 'customer_details', name: 'billing_name',
    cols: 'd.billing_name AS name, d.contact_no, d.email, d.billing_address AS address, d.billing_city AS city, d.billing_state AS state, d.billing_gstin AS gstin'
  },
  vendor: {
    ledger: 'vendor_ledger', fk: 'vendor_id', details: 'vendor_details', name: 'vendor_name',
    cols: 'd.vendor_name AS name, d.contact_no, d.email, d.address, d.city, d.state, d.tax_id AS gstin'
  }
} as const;

const pad3 = (n: number) => String(n).padStart(3, '0');

/** Where the party's latest ledger row points. */
export function ledgerReference(party: OutstandingParty, r: any): { display: string; url: string | null; type: string } {
  const no = r.reference_no || '';
  switch (r.transaction_type) {
    case 'SALE':
      return r.reference_type === 'salex'
        ? { display: `C-${no}`, url: `/salex/view/${r.reference_id}`, type: 'sale' }
        : { display: `INV-${no}`, url: `/sale/view/${r.reference_id}`, type: 'sale' };
    case 'PURCHASE':
      return { display: no ? `INV-${no}` : String(r.id), url: `/purchases/view/${r.reference_id}`, type: 'purchase' };
    case 'CREDIT_NOTE':
    case 'REFUND':
      return {
        display: no || `SR-${pad3(r.reference_id)}`,
        url: `/entry/salereturn/${r.reference_id}?type=${r.reference_type === 'salex_return' ? 'invoicex' : 'invoice'}`,
        type: 'return'
      };
    case 'DEBIT_NOTE':
      return { display: no || `PR-${pad3(r.reference_id)}`, url: `/entry/purchasereturn-vendor/${r.reference_id}`, type: 'debit_note' };
    case 'PAYMENT_RECEIVED':
      return { display: r.transaction_id ? `PAY-${r.transaction_id}` : 'Payment', url: r.transaction_id ? `/customer-transactions/view/${r.transaction_id}?type=income` : null, type: 'payment' };
    case 'REFUND_PAID':
      return { display: r.transaction_id ? `REF-${r.transaction_id}` : 'Refund', url: r.transaction_id ? `/customer-transactions/view/${r.transaction_id}?type=expense` : null, type: 'refund' };
    case 'PAYMENT':
      return { display: r.transaction_id ? `PAY-${r.transaction_id}` : 'Payment', url: r.transaction_id ? `/vendor-transactions/view/${r.transaction_id}?type=expense` : null, type: 'payment' };
    case 'REFUND_RECEIVED':
      return { display: r.transaction_id ? `REF-${r.transaction_id}` : 'Refund', url: r.transaction_id ? `/vendor-transactions/view/${r.transaction_id}?type=income` : null, type: 'refund' };
    default:
      return { display: no || 'N/A', url: null, type: party === 'customer' ? 'other' : 'unknown' };
  }
}

export interface OutstandingQuery {
  partyId?: number | null;
  search?: string;
  start?: number | null;
  end?: number | null;
  amountMin?: number | null;
  amountMax?: number | null;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit: number;
  skip: number;
}

export async function partyOutstanding(party: OutstandingParty, q: OutstandingQuery) {
  const p = P[party];
  const inner: string[] = [];
  const params: unknown[] = [];
  if (q.end != null) { inner.push('l.transaction_date <= ?'); params.push(q.end); }
  if (q.partyId != null) { inner.push(`l.${p.fk} = ?`); params.push(q.partyId); }

  const having: string[] = ['ABS(SUM(l.debit) - SUM(l.credit)) >= 0.005'];
  const havingParams: unknown[] = [];
  // With a start date: parties with activity in the range.
  if (q.start != null) { having.push('MAX(l.transaction_date) >= ?'); havingParams.push(q.start); }
  if (q.amountMin != null) { having.push('SUM(l.debit) - SUM(l.credit) >= ?'); havingParams.push(q.amountMin); }
  if (q.amountMax != null) { having.push('SUM(l.debit) - SUM(l.credit) <= ?'); havingParams.push(q.amountMax); }

  const outer: string[] = [];
  const outerParams: unknown[] = [];
  if (q.search) { outer.push(`d.${p.name} LIKE ?`); outerParams.push(`%${q.search}%`); }

  const grouped = `
    SELECT l.${p.fk} AS party_id, ROUND(SUM(l.debit) - SUM(l.credit), 2) AS balance, MAX(l.transaction_date) AS last_date
    FROM ${p.ledger} l ${inner.length ? 'WHERE ' + inner.join(' AND ') : ''}
    GROUP BY l.${p.fk} HAVING ${having.join(' AND ')}`;
  const from = `FROM (${grouped}) g LEFT JOIN ${p.details} d ON d.id = g.party_id ${outer.length ? 'WHERE ' + outer.join(' AND ') : ''}`;
  const all = [...params, ...havingParams, ...outerParams];
  const sort = q.sortBy === 'customer_name' || q.sortBy === 'vendor_name' ? 'name'
    : q.sortBy === 'transaction_date' ? 'g.last_date' : 'g.balance';
  const dir = q.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const [countRows, rows] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN g.balance > 0 THEN g.balance ELSE 0 END), 0) AS owed,
              COALESCE(SUM(CASE WHEN g.balance < 0 THEN -g.balance ELSE 0 END), 0) AS credit ${from}`, ...all) as Promise<any[]>,
    prisma.$queryRawUnsafe(
      `SELECT g.party_id, g.balance, g.last_date, ${p.cols} ${from} ORDER BY ${sort} ${dir}, g.party_id ${dir} LIMIT ? OFFSET ?`,
      ...all, q.limit, q.skip) as Promise<any[]>
  ]);

  // Each party's latest row (inside the range) for the "last transaction" column.
  const ids = rows.map(r => Number(r.party_id));
  const latest = ids.length
    ? await (prisma as any)[p.ledger].findMany({
        where: { [p.fk]: { in: ids }, ...(q.end != null ? { transaction_date: { lte: q.end } } : {}) },
        orderBy: [{ transaction_date: 'desc' }, { id: 'desc' }],
        select: { id: true, [p.fk]: true, transaction_date: true, transaction_type: true, reference_type: true, reference_id: true, reference_no: true, transaction_id: true }
      })
    : [];
  const lastOf = new Map<number, any>();
  for (const r of latest) if (!lastOf.has(r[p.fk])) lastOf.set(r[p.fk], r);

  const items = rows.map(r => {
    const id = Number(r.party_id);
    const last = lastOf.get(id);
    const ref = last ? ledgerReference(party, last) : { display: 'N/A', url: null, type: '' };
    const date = last?.transaction_date ?? Number(r.last_date) ?? 0;
    return {
      id,
      [p.fk]: id,
      [`${party}_name`]: r.name || (id === 0 ? 'Other' : `Unknown ${party}`),
      balance: Number(r.balance),
      transaction_date: date,
      formattedDate: date ? new Date(date * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
      last_transaction_type: last?.transaction_type || 'N/A',
      reference_display: ref.display,
      reference_url: ref.url,
      reference_type: ref.type,
      [party]: r.name != null
        ? { [p.name]: r.name, contact_no: r.contact_no, email: r.email, address: r.address, city: r.city, state: r.state, gstin: r.gstin, ...(party === 'vendor' ? { tax_id: r.gstin } : {}) }
        : null
    };
  });

  const c = countRows[0] || {};
  return {
    items,
    total: Number(c.count ?? 0),
    totals: { owed: Number(c.owed ?? 0), credit: Number(c.credit ?? 0) }
  };
}
