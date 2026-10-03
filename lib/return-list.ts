import { prisma } from './db';
import { parseDateRange } from './date-utils';

/**
 * Sale-return and purchase-return lists, one implementation (RETURNS_PLAN R0).
 *
 * The two list routes had drifted: the sale list filtered "Return Status" on a
 * text column no code updates, searched only the return id and notes (so a
 * customer name or an invoice number found nothing), ignored Items Qty and
 * Payment Mode, and sorted three of its columns by date. The purchase list had
 * most of that right. Both now read every return of the party kind, join the
 * bill and party, filter, sort and page here - return volumes are small, and a
 * filter on a joined field cannot be paged in the database anyway.
 *
 * Response rows keep the fields each screen and PendingReturnsHint read.
 */
export type ReturnParty = 'customer' | 'vendor';

export interface ReturnListQuery {
  page: number;
  limit: number;
  search: string;
  party: string;          // id, or part of a name
  status: number | null;  // payment_status: 0 pending refund, 1 refunded
  dateFrom: string;
  dateTo: string;
  amountMin: number | null;
  amountMax: number | null;
  fy: number | null;
  invoiceNo: string;
  itemCount: number | null;
  paymentMode: number | null;
  packingTotal: number | null;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

const one = (v: unknown) => String((Array.isArray(v) ? v[0] : v) ?? '').trim();
const intOrNull = (v: unknown) => { const s = one(v); return /^-?\d+$/.test(s) ? parseInt(s, 10) : null; };
const numOrNull = (v: unknown) => { const s = one(v); const n = Number(s); return s !== '' && Number.isFinite(n) ? n : null; };

/** Old screens sent 'Completed' / 'Pending' for the sale list; numbers for purchase. */
function parseStatus(v: unknown): number | null {
  const s = one(v).toLowerCase();
  if (!s || s === 'all') return null;
  if (s === 'completed' || s === 'complete' || s === 'refunded' || s === 'paid') return 1;
  if (s === 'pending' || s === 'unpaid' || s === 'incomplete') return 0;
  return intOrNull(s);
}

export function parseReturnListQuery(party: ReturnParty, q: Record<string, unknown>): ReturnListQuery {
  const page = Math.max(1, intOrNull(q.page) ?? 1);
  const limit = Math.min(1000, Math.max(1, intOrNull(q.limit) ?? 50));
  return {
    page,
    limit,
    search: one(q.search),
    party: one(party === 'customer' ? (q.customer ?? q.customer_id) : (q.vendor ?? q.vendor_id)),
    status: parseStatus(q.status),
    dateFrom: one(q.dateFrom),
    dateTo: one(q.dateTo),
    amountMin: numOrNull(q.amountMin),
    amountMax: numOrNull(q.amountMax),
    fy: intOrNull(q.fy),
    invoiceNo: one(q.uid ?? q.invoiceNo),
    itemCount: intOrNull(q.itemCount),
    paymentMode: intOrNull(q.paymentMode),
    packingTotal: party === 'vendor' ? numOrNull(q.packingForwardingTotal) : null,
    sortBy: one(q.sortBy) || 'return_date',
    sortOrder: one(q.sortOrder) === 'asc' ? 'asc' : 'desc'
  };
}

const pad3 = (n: number) => String(n).padStart(3, '0');
const dayText = (ts: number | null | undefined) => {
  if (!ts) return null;
  const d = new Date(ts * 1000);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString('en-IN');
};

/** Which kind a typed return number names: SR-12 sale, SXR-12 Invoice C, PR-12 purchase. */
function searchedId(search: string): { id: number; kind: string | null } | null {
  const m = search.match(/^(SXR|SR|PR)-?0*(\d+)$/i);
  if (m) return { id: parseInt(m[2], 10), kind: m[1].toUpperCase() };
  if (/^\d+$/.test(search)) return { id: parseInt(search, 10), kind: null };
  return null;
}

async function customerRows(where: any) {
  const [sale, salex] = await Promise.all([
    prisma.sale_returns.findMany({ where }),
    prisma.salex_returns.findMany({ where })
  ]);
  const saleIds = sale.map(r => r.id);
  const salexIds = salex.map(r => r.id);
  const [bills, billsX, lines, linesX]: any[][] = await Promise.all([
    sale.length ? prisma.invoice.findMany({ where: { id: { in: Array.from(new Set(sale.map(r => r.invoice_id))) } }, select: { id: true, invoice_no: true, select_customer: true } }) : [],
    salex.length ? prisma.invoicex.findMany({ where: { id: { in: Array.from(new Set(salex.map(r => r.invoicex_id))) } }, select: { id: true, invoice_no: true, select_customer: true } }) : [],
    saleIds.length ? prisma.sale_return_items.findMany({ where: { sale_return_id: { in: saleIds } }, select: { sale_return_id: true } }) : [],
    salexIds.length ? prisma.salex_return_items.findMany({ where: { salex_return_id: { in: salexIds } }, select: { salex_return_id: true } }) : []
  ]);
  const billMap = new Map(bills.map(b => [b.id, b]));
  const billXMap = new Map(billsX.map(b => [b.id, b]));
  const partyIds = Array.from(new Set([...bills, ...billsX].map(b => b.select_customer).filter(Boolean)));
  const customers: any[] = partyIds.length
    ? await prisma.customer_details.findMany({ where: { id: { in: partyIds } }, select: { id: true, billing_name: true, billing_gstin: true } })
    : [];
  const customerMap = new Map(customers.map(c => [c.id, c]));
  const count = (list: any[], key: string) => {
    const m = new Map<number, number>();
    for (const l of list) m.set(l[key], (m.get(l[key]) || 0) + 1);
    return m;
  };
  const saleCount = count(lines, 'sale_return_id');
  const salexCount = count(linesX, 'salex_return_id');

  const row = (r: any, kind: 'invoice' | 'invoicex') => {
    const salex = kind === 'invoicex';
    const billId = salex ? r.invoicex_id : r.invoice_id;
    const bill = salex ? billXMap.get(billId) : billMap.get(billId);
    const customer = bill ? customerMap.get(bill.select_customer) : undefined;
    const totalTax = salex ? 0 : (r.total_tax || 0);
    return {
      id: r.id,
      invoice_id: billId,
      invoice_type: kind,
      return_no: `${salex ? 'SXR' : 'SR'}-${pad3(r.id)}`,
      party_id: bill?.select_customer ?? 0,
      customer_id: bill?.select_customer ?? 0,
      customer_name: customer?.billing_name || 'Unknown Customer',
      customer_gstin: customer?.billing_gstin || '',
      party_name: customer?.billing_name || 'Unknown Customer',
      invoice_no: bill?.invoice_no?.toString() || 'N/A',
      total_amount: r.total_amount || 0,
      total_tax: totalTax,
      refund_amount: r.refund_amount || ((r.total_amount || 0) + totalTax),
      status: r.status || 'Pending',
      payment_status: r.payment_status ?? 0,
      payment_mode: r.payment_mode ?? 1,
      payment_date: r.payment_date,
      return_date: r.return_date,
      formattedDate: dayText(r.return_date),
      item_count: (salex ? salexCount : saleCount).get(r.id) || 0,
      notes: r.notes || '',
      fy: r.fy,
      created_at: r.created_at,
      updated_at: r.updated_at
    };
  };
  return [...sale.map(r => row(r, 'invoice')), ...salex.map(r => row(r, 'invoicex'))];
}

async function vendorRows(where: any) {
  const returns = await prisma.purchase_returns.findMany({ where });
  const ids = returns.map(r => r.id);
  const [vendors, lines, refunds] = await Promise.all([
    prisma.vendor_details.findMany({
      where: { id: { in: Array.from(new Set(returns.map(r => r.vendor_id).filter((v): v is number => v != null))) } },
      select: { id: true, vendor_name: true, tax_id: true, address: true }
    }),
    ids.length ? prisma.purchase_return_items.findMany({ where: { purchase_return_id: { in: ids } }, select: { purchase_return_id: true, purchase_item_id: true } }) : [],
    ids.length ? prisma.refund_allocations.findMany({ where: { return_id: { in: ids } }, select: { return_id: true, allocated_amount: true } }) : []
  ]);
  const purchaseLines = lines.length
    ? await prisma.purchaseitems.findMany({ where: { id: { in: Array.from(new Set(lines.map(l => l.purchase_item_id))) } }, select: { id: true, purchase_id: true } })
    : [];
  const purchaseIds = Array.from(new Set([
    ...purchaseLines.map(l => l.purchase_id),
    ...returns.map(r => r.purchase_id).filter((v): v is number => v != null)
  ]));
  const purchases = purchaseIds.length
    ? await prisma.purchase.findMany({ where: { id: { in: purchaseIds } }, select: { id: true, invoice_no: true } })
    : [];
  const vendorMap = new Map(vendors.map(v => [v.id, v]));
  const lineToPurchase = new Map(purchaseLines.map(l => [l.id, l.purchase_id]));
  const purchaseNo = new Map(purchases.map(p => [p.id, p.invoice_no]));
  const billsOf = new Map<number, Set<number>>();
  const itemCount = new Map<number, number>();
  for (const l of lines) {
    itemCount.set(l.purchase_return_id, (itemCount.get(l.purchase_return_id) || 0) + 1);
    const pid = lineToPurchase.get(l.purchase_item_id);
    const no = pid != null ? purchaseNo.get(pid) : undefined;
    if (no != null) {
      if (!billsOf.has(l.purchase_return_id)) billsOf.set(l.purchase_return_id, new Set());
      billsOf.get(l.purchase_return_id)!.add(no);
    }
  }
  const refunded = new Map<number, number>();
  for (const a of refunds) refunded.set(a.return_id, (refunded.get(a.return_id) || 0) + Number(a.allocated_amount || 0));

  return returns.map(r => {
    const vendor = r.vendor_id != null ? vendorMap.get(r.vendor_id) : undefined;
    const nos = Array.from(billsOf.get(r.id) || []).sort((a, b) => a - b);
    const invoiceNo = nos.length ? nos.join(', ') : (r.purchase_id != null ? purchaseNo.get(r.purchase_id)?.toString() : undefined);
    const refundAmount = r.refund_amount || ((r.total_amount || 0) + (r.total_tax || 0));
    return {
      id: r.id,
      return_no: `PR-${pad3(r.id)}`,
      debit_note_no: r.debit_note_no || null,
      invoice_no: invoiceNo,
      party_id: r.vendor_id ?? 0,
      vendor_id: r.vendor_id ?? 0,
      vendor_name: vendor?.vendor_name || 'Unknown Vendor',
      vendor_gstin: vendor?.tax_id || '',
      vendor_address: vendor?.address || '',
      party_name: vendor?.vendor_name || 'Unknown Vendor',
      total_amount: r.total_amount || 0,
      total_tax: r.total_tax || 0,
      refund_amount: refundAmount,
      status: r.status ?? 1,
      payment_status: r.payment_status ?? 0,
      payment_mode: r.payment_mode ?? 1,
      payment_date: r.payment_date,
      return_date: r.return_date,
      formattedDate: dayText(r.return_date),
      item_count: itemCount.get(r.id) || 0,
      packing_forwarding_total: Number(r.packing_forwarding_amount || 0),
      notes: r.notes || '',
      fy: r.fy,
      created_at: r.created_at,
      updated_at: r.updated_at,
      total_refunded: refunded.get(r.id) || 0,
      remaining_refund: refundAmount - (refunded.get(r.id) || 0)
    };
  });
}

const SORT: Record<string, (r: any) => string | number> = {
  id: r => r.id,
  return_no: r => r.id,
  invoice_no: r => { const n = parseInt(String(r.invoice_no ?? ''), 10); return Number.isNaN(n) ? -1 : n; },
  customer_name: r => String(r.party_name).toLowerCase(),
  vendor_name: r => String(r.party_name).toLowerCase(),
  party_name: r => String(r.party_name).toLowerCase(),
  item_count: r => r.item_count,
  total_amount: r => r.total_amount,
  total_tax: r => r.total_tax,
  return_date: r => r.return_date || 0,
  payment_mode: r => r.payment_mode ?? 0,
  status: r => r.payment_status ?? 0,
  payment_status: r => r.payment_status ?? 0,
  fy: r => r.fy ?? 0,
  packing_forwarding_total: r => r.packing_forwarding_total || 0,
  packing_forwarding_amount: r => r.packing_forwarding_total || 0
};

export async function listReturns(party: ReturnParty, q: ReturnListQuery) {
  // Filters on the return's own columns go to the database.
  const where: any = {};
  if (q.fy !== null) where.fy = q.fy;
  if (q.status !== null) where.payment_status = q.status;
  if (q.paymentMode !== null) where.payment_mode = q.paymentMode;
  if (q.amountMin !== null || q.amountMax !== null) {
    where.total_amount = {};
    if (q.amountMin !== null) where.total_amount.gte = q.amountMin;
    if (q.amountMax !== null) where.total_amount.lte = q.amountMax;
  }
  if (q.dateFrom || q.dateTo) {
    const { startTimestamp, endTimestamp } = parseDateRange(q.dateFrom || '1970-01-01', q.dateTo || '2999-12-31');
    where.return_date = {};
    if (q.dateFrom) where.return_date.gte = startTimestamp;
    if (q.dateTo) where.return_date.lte = endTimestamp;
  }
  if (q.packingTotal !== null) where.packing_forwarding_amount = q.packingTotal;
  const partyId = /^\d+$/.test(q.party) ? parseInt(q.party, 10) : null;
  if (party === 'vendor' && partyId !== null) where.vendor_id = partyId;

  let rows: any[] = party === 'customer' ? await customerRows(where) : await vendorRows(where);

  // Filters on joined fields.
  if (q.party) {
    rows = partyId !== null
      ? rows.filter(r => r.party_id === partyId)
      : rows.filter(r => r.party_name.toLowerCase().includes(q.party.toLowerCase()));
  }
  if (q.search) {
    const hit = searchedId(q.search);
    const text = q.search.toLowerCase();
    rows = rows.filter(r => {
      if (hit) {
        if (hit.kind === null) return r.id === hit.id;
        const kindOk = hit.kind === 'PR' ? party === 'vendor' : hit.kind === 'SXR' ? r.invoice_type === 'invoicex' : r.invoice_type === 'invoice';
        return kindOk && r.id === hit.id;
      }
      return r.party_name.toLowerCase().includes(text)
        || (r.notes || '').toLowerCase().includes(text)
        || (r.debit_note_no || '').toLowerCase().includes(text);
    });
  }
  if (q.invoiceNo) {
    rows = rows.filter(r => String(r.invoice_no ?? '').split(',').some(n => n.trim().includes(q.invoiceNo)));
  }
  if (q.itemCount !== null) rows = rows.filter(r => r.item_count === q.itemCount);

  const key = SORT[q.sortBy] || SORT.return_date;
  const dir = q.sortOrder === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const x = key(a), y = key(b);
    if (x < y) return -dir;
    if (x > y) return dir;
    // Ties: newest first, sale before Invoice C - a stable order across pages.
    return (b.id - a.id) || (String(a.invoice_type || '') < String(b.invoice_type || '') ? -1 : 1);
  });

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / q.limit));
  const start = (q.page - 1) * q.limit;
  return {
    returns: rows.slice(start, start + q.limit).map(({ party_id, party_name, ...r }) => r),
    pagination: { page: q.page, limit: q.limit, total, totalPages, hasMore: q.page < totalPages }
  };
}
