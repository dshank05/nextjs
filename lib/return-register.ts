import { prisma } from './db';

/**
 * Return registers: sale, Invoice C and purchase returns for a period, one
 * list, with note numbers, the bill, the party, taxable value, GST, extra
 * charges, refund and whether the money has been settled (return complete).
 */
export type ReturnKind = 'sale' | 'salex' | 'purchase';

const pad3 = (v: number) => String(v).padStart(3, '0');
const n = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

const UNION = `
  SELECT 'sale' AS kind, r.id, r.return_date AS d, r.total_amount AS taxable, COALESCE(r.total_tax, 0) AS tax,
         0 AS charges, COALESCE(r.refund_amount, r.total_amount + COALESCE(r.total_tax, 0)) AS refund,
         COALESCE(r.payment_status, 0) AS status, h.id AS bill_id, h.invoice_no AS bill_no,
         h.select_customer AS party_id, c.billing_name AS party, NULL AS note_no,
         (SELECT COUNT(*) FROM sale_return_items x WHERE x.sale_return_id = r.id) AS items
  FROM sale_returns r LEFT JOIN invoice h ON h.id = r.invoice_id LEFT JOIN customer_details c ON c.id = h.select_customer
  UNION ALL
  SELECT 'salex', r.id, r.return_date, r.total_amount, 0, 0, COALESCE(r.refund_amount, r.total_amount),
         COALESCE(r.payment_status, 0), h.id, h.invoice_no, h.select_customer, c.billing_name, NULL,
         (SELECT COUNT(*) FROM salex_return_items x WHERE x.salex_return_id = r.id)
  FROM salex_returns r LEFT JOIN invoicex h ON h.id = r.invoicex_id LEFT JOIN customer_details c ON c.id = h.select_customer
  UNION ALL
  SELECT 'purchase', r.id, r.return_date, r.total_amount, COALESCE(r.total_tax, 0),
         COALESCE(r.packing_forwarding_amount, 0) + COALESCE(r.freight_amount, 0),
         COALESCE(r.refund_amount, r.total_amount + COALESCE(r.total_tax, 0)),
         COALESCE(r.payment_status, 0), p.id, p.invoice_no, r.vendor_id, v.vendor_name, r.debit_note_no,
         (SELECT COUNT(*) FROM purchase_return_items x WHERE x.purchase_return_id = r.id)
  FROM purchase_returns r LEFT JOIN purchase p ON p.id = r.purchase_id LEFT JOIN vendor_details v ON v.id = r.vendor_id`;

export interface ReturnRegisterQuery {
  start: number | null;
  end: number | null;
  kinds: ReturnKind[];
  status?: number | null;
  search?: string;
  sortOrder?: 'asc' | 'desc';
  limit: number;
  skip: number;
}

export async function returnRegister(Q: ReturnRegisterQuery) {
  const where: string[] = [`t.kind IN (${Q.kinds.map(() => '?').join(', ')})`];
  const params: unknown[] = [...Q.kinds];
  if (Q.start != null) { where.push('t.d >= ?'); params.push(Q.start); }
  if (Q.end != null) { where.push('t.d <= ?'); params.push(Q.end); }
  if (Q.status != null) { where.push('t.status = ?'); params.push(Q.status); }
  if (Q.search) { where.push('(t.party LIKE ? OR t.note_no LIKE ?)'); params.push(`%${Q.search}%`, `%${Q.search}%`); }
  const from = `FROM (${UNION}) t WHERE ${where.join(' AND ')}`;
  const dir = Q.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const [rows, sums] = await Promise.all([
    prisma.$queryRawUnsafe(`SELECT t.* ${from} ORDER BY t.d ${dir}, t.kind, t.id ${dir} LIMIT ? OFFSET ?`, ...params, Q.limit, Q.skip) as Promise<any[]>,
    prisma.$queryRawUnsafe(
      `SELECT t.kind, COUNT(*) AS cnt, SUM(t.taxable) AS taxable, SUM(t.tax) AS tax, SUM(t.charges) AS charges, SUM(t.refund) AS refund,
              SUM(CASE WHEN t.status = 1 THEN t.refund ELSE 0 END) AS settled
       ${from} GROUP BY t.kind`, ...params) as Promise<any[]>
  ]);

  const items = rows.map(r => {
    const kind = r.kind as ReturnKind;
    const id = n(r.id);
    const returnNo = kind === 'sale' ? `SR-${pad3(id)}` : kind === 'salex' ? `SXR-${pad3(id)}` : `PR-${pad3(id)}`;
    const d = n(r.d);
    return {
      kind,
      id,
      return_no: returnNo,
      note_no: r.note_no || returnNo,
      date: d,
      formattedDate: new Date(d * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
      party_id: r.party_id == null ? null : n(r.party_id),
      party_name: r.party || (n(r.party_id) === 0 ? 'Other' : 'Unknown'),
      bill_id: r.bill_id == null ? null : n(r.bill_id),
      bill_no: r.bill_no == null ? null : String(r.bill_no),
      items: n(r.items),
      taxable: r2(n(r.taxable)),
      tax: r2(n(r.tax)),
      charges: r2(n(r.charges)),
      refund: r2(n(r.refund)),
      status: n(r.status),
      status_text: n(r.status) === 1 ? 'Complete' : n(r.status) === 2 ? 'Partial' : 'Pending',
      url: kind === 'purchase' ? `/entry/purchasereturn-vendor/${id}` : `/entry/salereturn/${id}?type=${kind === 'sale' ? 'invoice' : 'invoicex'}`
    };
  });

  const byKind: Record<string, any> = {};
  let count = 0;
  for (const s of sums) {
    byKind[s.kind] = { count: n(s.cnt), taxable: r2(n(s.taxable)), tax: r2(n(s.tax)), charges: r2(n(s.charges)), refund: r2(n(s.refund)), settled: r2(n(s.settled)) };
    count += n(s.cnt);
  }
  const all = (f: string) => r2(Object.values(byKind).reduce((a: number, k: any) => a + k[f], 0));
  return {
    items,
    total: count,
    totals: { byKind, taxable: all('taxable'), tax: all('tax'), charges: all('charges'), refund: all('refund'), settled: all('settled'), pending: r2(all('refund') - all('settled')) }
  };
}
