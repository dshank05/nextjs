import { prisma } from './db';

/**
 * The customer a sale / Invoice C bill names, for the people & charges reports
 * (commissions, mechanic, staff, transport, P&F) - B-10.
 *
 * Those reports looked the name up in `customer_details`, so a walk-in sale
 * (customer 0, no master row) read "Unknown" and a renamed customer's old bills
 * showed the new name. The bill's own snapshot (`bill_tosales` /
 * `bill_tosalesx.billing_name`) is what the bill says; the sale list and the
 * bill-reference report already read it (lib/sale-query.ts). Same order here:
 * the snapshot, then the master, then "Other" for a walk-in.
 *
 * @returns bill id -> name
 */
export async function saleCustomerNames(
  kind: 'sale' | 'salex',
  bills: Array<{ id: number; select_customer: number | null }>
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (bills.length === 0) return out;
  const db = prisma as any;
  const billTo = kind === 'sale' ? 'bill_tosales' : 'bill_tosalesx';
  const customerIds = Array.from(new Set(bills.map(b => b.select_customer).filter((c): c is number => !!c)));
  const [snapshots, customers] = await Promise.all([
    db[billTo].findMany({
      where: { invoice_no: { in: bills.map(b => b.id) } },
      select: { invoice_no: true, billing_name: true }
    }) as Promise<Array<{ invoice_no: number | null; billing_name: string | null }>>,
    customerIds.length
      ? (db.customer_details.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, billing_name: true }
        }) as Promise<Array<{ id: number; billing_name: string | null }>>)
      : Promise.resolve([] as Array<{ id: number; billing_name: string | null }>)
  ]);
  const snap = new Map(snapshots.map(s => [s.invoice_no, (s.billing_name || '').trim()]));
  const master = new Map(customers.map(c => [c.id, c.billing_name || '']));
  for (const b of bills) {
    const name = snap.get(b.id)
      || (b.select_customer ? master.get(b.select_customer) : '')
      || (b.select_customer ? 'Unknown' : 'Other');
    out.set(b.id, name);
  }
  return out;
}
