import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { convertDateToTimestamp, getLocalDateString } from '../../../lib/date-utils'
import { ok, fail, route } from '../../../lib/api/respond'

/**
 * Everything the dashboard needs, in one request.
 *
 * This replaces `stats`, `daily-stats` and `trends`, which between them cost the
 * landing page four round trips and about 1.7 seconds, roughly half of it
 * wasted:
 *
 * - `/trends` was fetched on every load and **never rendered** - 574 ms and
 *   fifteen queries thrown away, with the chart that once consumed it deleted
 *   (D-01).
 * - `daily-stats` was called **twice on mount**, because the Daily Sales and
 *   Daily Purchases panels each fetched the same endpoint with the same default
 *   date (D-02).
 *
 * Also gone with them:
 *
 * - **No raw SQL.** The low-stock count and the last-purchase lookup were
 *   `$queryRaw`. The count carried a missing-parenthesis bug (`A AND B OR C OR D`,
 *   D-04) and the lookup ordered by `REGEXP '^[0-9]+$'` over an `Int` column,
 *   forcing a string conversion of every row and defeating the index (D-05).
 *   Both are plain Prisma now - the field-to-field comparison uses
 *   `prisma.product.fields`, which is what made the raw query unnecessary.
 * - **One low-stock rule.** The dashboard had a fourth definition of "low", and
 *   since `min_stock` is 0 across the catalogue (F-74) its `stock < min_stock`
 *   reduced to `stock < 0` - so the card was reporting the known negative-stock
 *   row (F-73) as low stock, while the report and the products list both said 0
 *   (D-03). It now uses the rule F-70 unified.
 * - **The browser's "today", not the server's.** Dates arrive as YYYY-MM-DD from
 *   the client. With the server in UTC and the business in IST, a server-side
 *   `new Date()` put everything before 05:30 IST on the wrong day (D-09).
 */

/**
 * The one definition of "low stock", matching
 * `pages/api/reports/minimum-stock.ts` and the products list (F-70).
 *
 * `min_stock > 0` matters: a minimum of zero means none was ever set, so the
 * product cannot be below it. Without that clause every product with zero or
 * negative stock counts as low, which is what D-03 was.
 */
const LOW_STOCK_WHERE = {
  // Active products only, like Total Products beside it: an inactive product is
  // not stocked any more, so it is not "low" (SETTINGS_PLAN 17; the minimum-stock
  // report applies the same rule).
  is_active: true,
  stock: { lt: prisma.product.fields.min_stock },
  min_stock: { not: null, gt: 0 },
} as const

/** A whole local day as a unix range, from a YYYY-MM-DD string. */
function dayRange(date: string) {
  const start = convertDateToTimestamp(date)
  return { gte: start, lte: start + 86399 }
}

function readDate(value: unknown, fallback: string): string {
  const raw = Array.isArray(value) ? value[0] : value
  const s = typeof raw === 'string' ? raw.trim() : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    // The client knows its own timezone; the server does not (D-09).
    const today = readDate(req.query.today, getLocalDateString())
    const salesDate = readDate(req.query.salesDate, today)
    const purchasesDate = readDate(req.query.purchasesDate, today)

    const todayRange = dayRange(today)
    const salesRange = dayRange(salesDate)
    const purchasesRange = dayRange(purchasesDate)

    const [
      products,
      lowStock,
      salesCount,
      purchasesCount,
      todaySales,
      todayPurchases,
      salesDayTotal,
      purchasesDayTotal,
      lastSale,
      lastPurchase,
    ] = await Promise.all([
      // Active only. Delete became deactivation in F-63, so a plain count()
      // reports deactivated products as stock on hand (D-08).
      prisma.product.count({ where: { is_active: true } }),
      prisma.product.count({ where: LOW_STOCK_WHERE }),

      // All-time, deliberately: the cards are labelled "Total". Scoping these to
      // the open financial year would match the reports but would change what
      // the number means, which is the owner's call, not a bug fix (D-08).
      prisma.invoice.count(),
      prisma.purchase.count(),

      prisma.invoice.aggregate({ where: { invoice_date: todayRange }, _sum: { total: true } }),
      prisma.purchase.aggregate({ where: { invoice_date: todayRange }, _sum: { total: true } }),

      prisma.invoice.aggregate({ where: { invoice_date: salesRange }, _sum: { total: true } }),
      prisma.purchase.aggregate({ where: { invoice_date: purchasesRange }, _sum: { total: true } }),

      prisma.invoice.findFirst({
        orderBy: { invoice_date: 'desc' },
        select: { total: true, invoice_date: true, invoice_no: true },
      }),
      prisma.purchase.findFirst({
        orderBy: { invoice_date: 'desc' },
        select: { total: true, invoice_date: true, invoice_no: true },
      }),
    ])

    const amount = (r: { _sum: { total: number | null } }) => Number(r._sum.total ?? 0)

    return ok(res, {
      totals: {
        products,
        lowStock,
        sales: salesCount,
        purchases: purchasesCount,
      },
      today: {
        date: today,
        sales: amount(todaySales),
        purchases: amount(todayPurchases),
      },
      salesDay: { date: salesDate, total: amount(salesDayTotal) },
      purchasesDay: { date: purchasesDate, total: amount(purchasesDayTotal) },
      lastSale: lastSale
        ? { amount: Number(lastSale.total), date: lastSale.invoice_date, invoiceNo: lastSale.invoice_no }
        : null,
      lastPurchase: lastPurchase
        ? { amount: Number(lastPurchase.total), date: lastPurchase.invoice_date, invoiceNo: lastPurchase.invoice_no }
        : null,
    })
  } catch (error) {
    return fail(res, error, 'load the dashboard')
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  return route(req, res, { GET: () => handleGet(req, res) })
}

export default withObservability(handler)
