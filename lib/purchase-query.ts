import type { NextApiRequest } from 'next'
import { prisma } from './db'
import { parseListQuery, buildPagination } from './api/list-query'
import { parseDateRange } from './date-utils'

/**
 * The purchase list: one SQL query with the vendor, item count and amount paid
 * joined in, so every filter and sort runs in the database before paging.
 *
 * Before (PURCHASE_PASS2_AUDIT Block C): the page sent `billRef`, `items`,
 * `taxAmount` and `pf` while the API read `billReference`, `itemCount`,
 * `totalTax` and `packingForwardingTotal`, so four filters did nothing (PU-22);
 * the date range ended at 00:00 UTC of the end day (PU-23); sorting by vendor
 * or item count loaded every purchase into memory, and the item-count filter
 * ran after paging (PU-25).
 */

/** Columns of the list query the page may sort by. */
const SORT_COLUMNS = [
  'id', 'invoice_no', 'invoice_date', 'vendor_name', 'item_count', 'total', 'total_tax',
  'packing_forwarding_total', 'payment_status', 'payment_mode', 'bill_reference', 'fy'
]

export interface PurchaseListQuery {
  page: number
  limit: number
  sortBy: string
  sortOrder: 'asc' | 'desc'
  search: string
  invoiceNo: number | null
  vendorId: number | null
  status: 'all' | 0 | 1 | 2 | 'unknown'
  paymentMode: number | null
  billReference: string
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

export function parsePurchaseListQuery(req: NextApiRequest): PurchaseListQuery {
  const list = parseListQuery(req, {
    sortFields: SORT_COLUMNS,
    defaultSort: 'invoice_date',
    defaultOrder: 'desc',
    // The vendor-payment screen asks for up to 1,000 of one vendor's bills.
    maxLimit: 1000
  })
  const q = req.query
  const statusRaw = str(q.status)
  const status = statusRaw === '0' || statusRaw === '1' || statusRaw === '2'
    ? (parseInt(statusRaw, 10) as 0 | 1 | 2)
    : statusRaw === 'unknown' ? 'unknown' : 'all'

  // Whole local days, both ends inclusive (PU-23). Either end may be alone.
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
    vendorId: int(q.vendor),
    status,
    paymentMode: int(q.paymentMode),
    billReference: str(q.billReference),
    itemCount: int(q.itemCount),
    amountMin: float(q.amountMin),
    amountMax: float(q.amountMax),
    totalTax: float(q.totalTax),
    packingTotal: float(q.packingForwardingTotal),
    fy: int(q.fy),
    startDate: start ? range!.startTimestamp : null,
    endDate: end ? range!.endTimestamp : null
  }
}

export async function listPurchases(q: PurchaseListQuery) {
  const where: string[] = []
  const params: unknown[] = []
  const add = (sql: string, ...values: unknown[]) => { where.push(sql); params.push(...values) }

  if (q.invoiceNo !== null) add('t.invoice_no = ?', q.invoiceNo)
  if (q.search) {
    const n = /^\d+$/.test(q.search) ? parseInt(q.search, 10) : null
    if (n !== null) add('(t.invoice_no = ? OR t.notes LIKE ?)', n, `%${q.search}%`)
    else add('t.notes LIKE ?', `%${q.search}%`)
  }
  if (q.fy !== null) add('t.fy = ?', q.fy)
  if (q.vendorId !== null) add('t.vendor_id = ?', q.vendorId)
  if (q.status === 'unknown') add('(t.payment_status IS NULL OR t.payment_status NOT IN (0, 1, 2))')
  else if (q.status !== 'all') add('t.payment_status = ?', q.status)
  if (q.paymentMode !== null) add('t.payment_mode = ?', q.paymentMode)
  if (q.billReference) add('t.bill_reference LIKE ?', `%${q.billReference}%`)
  if (q.itemCount !== null) add('t.item_count = ?', q.itemCount)
  if (q.amountMin !== null) add('t.total >= ?', q.amountMin)
  if (q.amountMax !== null) add('t.total <= ?', q.amountMax)
  if (q.totalTax !== null) add('t.total_tax = ?', q.totalTax)
  if (q.packingTotal !== null) add('t.packing_forwarding_total = ?', q.packingTotal)
  if (q.startDate !== null) add('t.invoice_date >= ?', q.startDate)
  if (q.endDate !== null) add('t.invoice_date <= ?', q.endDate)

  // Vendor 0 is "Other": its name lives on the bill's own snapshot (bill_to).
  // Lines and the snapshot point at the purchase by id (P4-11).
  const base = `
    SELECT p.*,
      COALESCE(v.vendor_name, b.vendor_name, 'Other') AS vendor_name,
      COALESCE(v.address, b.address, '') AS vendor_address,
      COALESCE(v.tax_id, b.gstin, '') AS vendor_gstin,
      (SELECT COUNT(*) FROM purchase_items i WHERE i.purchase_id = p.id) AS item_count,
      (SELECT COALESCE(SUM(a.allocated_amount), 0) FROM payment_allocations a WHERE a.purchase_id = p.id) AS total_paid
    FROM purchase p
    LEFT JOIN vendor_details v ON v.id = p.vendor_id AND p.vendor_id <> 0
    LEFT JOIN bill_to b ON b.purchase_id = p.id`
  const from = `FROM (${base}) t ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`
  // Column and direction come from SORT_COLUMNS and a two-value check, never user text.
  const order = `ORDER BY t.${q.sortBy} ${q.sortOrder}, t.id ${q.sortOrder}`

  const [countRows, rows] = await Promise.all([
    prisma.$queryRawUnsafe(`SELECT COUNT(*) AS count ${from}`, ...params) as Promise<any[]>,
    prisma.$queryRawUnsafe(`SELECT t.* ${from} ${order} LIMIT ? OFFSET ?`, ...params, q.limit, (q.page - 1) * q.limit) as Promise<any[]>
  ])
  const total = Number(countRows[0]?.count ?? 0)

  const purchases = rows.map(r => {
    const totalPaid = Number(r.total_paid || 0)
    const taxable = Number(r.total_taxable_value || 0)
    return {
      id: r.id,
      invoice_no: r.invoice_no,
      bill_reference: r.bill_reference,
      bill_reference_date: r.bill_reference_date ? new Date(r.bill_reference_date).toISOString().slice(0, 10) : null,
      vendor_id: r.vendor_id,
      vendor_name: r.vendor_name,
      vendor_address: r.vendor_address,
      vendor_gstin: r.vendor_gstin,
      taxrate: taxable > 0 ? Number(r.total_tax || 0) / taxable : 0,
      items_total: Number(r.items_total || 0),
      total_taxable_value: taxable,
      total_tax: Number(r.total_tax || 0),
      packing_forwarding_total: Number(r.packing_forwarding_total || 0),
      total: Number(r.total),
      notes: r.notes || '',
      invoice_date: r.invoice_date,
      payment_status: r.payment_status ?? 0,
      payment_mode: r.payment_mode ?? 0,
      fy: r.fy,
      item_count: Number(r.item_count || 0),
      return_status: r.return_status ?? 0,
      total_paid: totalPaid,
      remaining_amount: Number(r.total) - totalPaid
    }
  })

  const pagination = buildPagination(
    { page: q.page, limit: q.limit, skip: 0, take: q.limit, search: '', sortField: q.sortBy, sortOrder: q.sortOrder, sortFellBack: false, isDropdown: false, includeInactive: false },
    total
  )
  return { purchases, pagination }
}
