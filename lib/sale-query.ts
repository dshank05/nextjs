import type { NextApiRequest } from 'next'
import { prisma } from './db'
import { parseListQuery, buildPagination } from './api/list-query'
import { parseDateRange } from './date-utils'
import { SaleKind, saleTables } from './sale'

/**
 * The sale and salex lists: one SQL query each, with the customer name, item
 * count and amount paid joined in, so every filter and sort runs in the
 * database before paging - lib/purchase-query.ts for the customer side.
 *
 * Before (docs/SALE_AUDIT.md SA-20, SA-25, SA-26): status 2 (Partial) was
 * ignored; the item-count filter was ">=" and ran after paging; sorting by
 * customer or item count loaded every bill; the salex "Invoice No" filter
 * matched the row id; the date range ended at 00:00 of the end day; and the
 * list had no `remaining_amount`, which the customer-payment screen filters
 * on, so it offered no sale bills at all (SA-35).
 */

const SORT_COLUMNS = [
  'id', 'invoice_no', 'invoice_date', 'customer_name', 'item_count', 'total', 'total_tax',
  'packing_forwarding_total', 'payment_status', 'payment_mode', 'bill_reference', 'fy', 'notes'
]

export interface SaleListQuery {
  page: number
  limit: number
  sortBy: string
  sortOrder: 'asc' | 'desc'
  search: string
  invoiceNo: number | null
  customerId: number | null
  status: 'all' | 0 | 1 | 2 | 'unknown'
  paymentMode: number | null
  billReference: string
  notes: string
  itemCount: number | null
  amountMin: number | null
  amountMax: number | null
  totalTax: number | null
  packingTotal: number | null
  fy: number | null
  startDate: number | null
  endDate: number | null
}

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v)
const str = (v: unknown) => String(first(v) ?? '').trim()
const int = (v: unknown) => { const s = str(v); if (!s) return null; const n = parseInt(s, 10); return Number.isFinite(n) ? n : null }
const float = (v: unknown) => { const s = str(v); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null }
/** The current name, or the one an older caller still sends. */
const either = (q: any, name: string, legacy: string) => (str(q[name]) !== '' ? q[name] : q[legacy])

export function parseSaleListQuery(req: NextApiRequest): SaleListQuery {
  const list = parseListQuery(req, {
    sortFields: SORT_COLUMNS,
    defaultSort: 'invoice_date',
    defaultOrder: 'desc',
    // The customer-payment screen asks for up to 1,000 of one customer's bills.
    maxLimit: 1000
  })
  const q = req.query
  const statusRaw = str(q.status)
  const status = statusRaw === '0' || statusRaw === '1' || statusRaw === '2'
    ? (parseInt(statusRaw, 10) as 0 | 1 | 2)
    : statusRaw === 'unknown' ? 'unknown' : 'all'

  // Whole local days, both ends inclusive. Either end may be alone.
  const start = str(q.startDate)
  const end = str(q.endDate)
  const range = start || end ? parseDateRange(start || end, end || start) : null

  return {
    page: list.page,
    limit: list.limit,
    sortBy: list.sortField,
    sortOrder: list.sortOrder,
    search: list.search,
    invoiceNo: int(q.uid),
    customerId: int(q.customer),
    status,
    paymentMode: int(q.paymentMode),
    billReference: str(either(q, 'billReference', 'billRef')),
    notes: str(q.notes),
    itemCount: int(either(q, 'itemCount', 'items')),
    amountMin: float(q.amountMin),
    amountMax: float(q.amountMax),
    totalTax: float(either(q, 'totalTax', 'taxAmount')),
    packingTotal: float(either(q, 'packingForwardingTotal', 'pf')),
    fy: int(q.fy),
    startDate: start ? range!.startTimestamp : null,
    endDate: end ? range!.endTimestamp : null
  }
}

export async function listSales(kind: SaleKind, q: SaleListQuery) {
  const t = saleTables(kind)
  const where: string[] = []
  const params: unknown[] = []
  const add = (sql: string, ...values: unknown[]) => { where.push(sql); params.push(...values) }

  if (q.invoiceNo !== null) add('t.invoice_no = ?', q.invoiceNo)
  if (q.search) {
    const n = /^\d+$/.test(q.search) ? parseInt(q.search, 10) : null
    if (n !== null) add('(t.invoice_no = ? OR t.notes LIKE ? OR t.customer_name LIKE ?)', n, `%${q.search}%`, `%${q.search}%`)
    else add('(t.notes LIKE ? OR t.customer_name LIKE ?)', `%${q.search}%`, `%${q.search}%`)
  }
  if (q.fy !== null) add('t.fy = ?', q.fy)
  if (q.customerId !== null) add('t.select_customer = ?', q.customerId)
  if (q.status === 'unknown') add('(t.payment_status IS NULL OR t.payment_status NOT IN (0, 1, 2))')
  else if (q.status !== 'all') add('t.payment_status = ?', q.status)
  if (q.paymentMode !== null) add('t.payment_mode = ?', q.paymentMode)
  if (q.billReference) add('t.bill_reference LIKE ?', `%${q.billReference}%`)
  if (q.notes) add('t.notes LIKE ?', `%${q.notes}%`)
  if (q.itemCount !== null) add('t.item_count = ?', q.itemCount)
  if (q.amountMin !== null) add('t.total >= ?', q.amountMin)
  if (q.amountMax !== null) add('t.total <= ?', q.amountMax)
  if (q.totalTax !== null) add('t.total_tax = ?', q.totalTax)
  if (q.packingTotal !== null) add('t.packing_forwarding_total = ?', q.packingTotal)
  if (q.startDate !== null) add('t.invoice_date >= ?', q.startDate)
  if (q.endDate !== null) add('t.invoice_date <= ?', q.endDate)

  // Table names come from SALE_TABLES, never from the request. The bill's own
  // snapshot names the customer first (what the bill says), then the master.
  const base = `
    SELECT d.*,
      COALESCE(NULLIF(b.billing_name, ''), c.billing_name, 'Other') AS customer_name,
      COALESCE(NULLIF(b.billing_address, ''), c.billing_address, '') AS customer_address,
      COALESCE(NULLIF(b.billing_gstin, ''), c.billing_gstin, '') AS customer_gstin,
      (SELECT COUNT(*) FROM ${t.items} i WHERE i.invoice_no = d.id) AS item_count,
      (SELECT COALESCE(SUM(a.allocated_amount), 0) FROM customer_payment_allocations a WHERE a.${t.allocFk} = d.id) AS total_paid
    FROM ${t.header} d
    LEFT JOIN customer_details c ON c.id = d.select_customer AND d.select_customer <> 0
    LEFT JOIN ${t.billTo} b ON b.invoice_no = d.id`
  const from = `FROM (${base}) t ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`
  const order = `ORDER BY t.${q.sortBy} ${q.sortOrder}, t.id ${q.sortOrder}`

  const [countRows, rows] = await Promise.all([
    prisma.$queryRawUnsafe(`SELECT COUNT(*) AS count ${from}`, ...params) as Promise<any[]>,
    prisma.$queryRawUnsafe(`SELECT t.* ${from} ${order} LIMIT ? OFFSET ?`, ...params, q.limit, (q.page - 1) * q.limit) as Promise<any[]>
  ])
  const total = Number(countRows[0]?.count ?? 0)

  const sales = rows.map(r => {
    const totalPaid = Number(r.total_paid || 0)
    const billTotal = Number(r.total || 0)
    return {
      id: r.id,
      type: kind,
      invoice_no: r.invoice_no,
      select_customer: r.select_customer ?? 0,
      customer_name: r.customer_name,
      customer_address: r.customer_address,
      customer_gstin: r.customer_gstin,
      bill_reference: r.bill_reference || '',
      items_total: Number(r.items_total || 0),
      discount: Number(r.discount || 0),
      freight: Number(r.freight || 0),
      total_taxable_value: Number(r.total_taxable_value || 0),
      total_tax: Number(r.total_tax || 0),
      packing_forwarding_total: Number(r.packing_forwarding_total || 0),
      total: billTotal,
      notes: r.notes || '',
      invoice_date: r.invoice_date,
      formattedDate: new Date(r.invoice_date * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
      payment_status: r.payment_status ?? 0,
      payment_mode: r.payment_mode ?? 0,
      return_status: r.return_status ?? 0,
      fy: r.fy,
      item_count: Number(r.item_count || 0),
      total_paid: totalPaid,
      remaining_amount: billTotal - totalPaid,
      outstanding_amount: billTotal - totalPaid
    }
  })

  const pagination = buildPagination(
    { page: q.page, limit: q.limit, skip: 0, take: q.limit, search: '', sortField: q.sortBy, sortOrder: q.sortOrder, sortFellBack: false, isDropdown: false, includeInactive: false },
    total
  )
  return { sales, pagination }
}
