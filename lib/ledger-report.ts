import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from './db'
import { badRequest, fail, methodNotAllowed } from './api/respond'
import { queryInt, reportPage, reportPagination, reportDayRange } from './api/report-query'

/**
 * One party's ledger, a page at a time, with a running balance - vendor and
 * customer alike.
 *
 * Block D of purchase fixed this for vendors (PU-26): the running balance
 * started at 0 on every page and ignored everything before `dateFrom`. The
 * customer copy kept the bug (SA-18), and its zero-row filter compared Decimal
 * objects with 0, so it never filtered. One function now serves both.
 * `openingBalance` is everything before the first row of this page - earlier
 * dates and earlier pages - and each row's balance runs on from it.
 */

const ORDER = [{ transaction_date: 'asc' as const }, { created_at: 'asc' as const }, { id: 'asc' as const }]

const PARTY = {
  vendor: { table: 'vendor_ledger', idField: 'vendor_id', label: 'Vendor' },
  customer: { table: 'customer_ledger', idField: 'customer_id', label: 'Customer' }
} as const

export function ledgerReportRoute(party: keyof typeof PARTY) {
  const P = PARTY[party]
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    try {
      const partyId = queryInt(req, P.idField)
      if (partyId === null) return badRequest(res, `${P.label} ID is required`)
      const table = (prisma as any)[P.table]

      const { page, limit, skip } = reportPage(req, 50, 1000)
      const range = reportDayRange(req)
      const where: any = { [P.idField]: partyId }
      if (range) {
        where.transaction_date = {}
        if (range.start !== null) where.transaction_date.gte = range.start
        if (range.end !== null) where.transaction_date.lte = range.end
      }

      // E-14: zero-value rows (cancelled transactions) are not listed, so they
      // are not paged or counted either - "Page x of y" counted rows that never
      // showed. They move no balance, so the opening is unaffected.
      const listed = { ...where, NOT: { debit: 0, credit: 0 } }
      const [entries, total, beforeRange, earlierPages] = await Promise.all([
        table.findMany({ where: listed, orderBy: ORDER, skip, take: limit }),
        table.count({ where: listed }),
        range?.start != null
          ? table.aggregate({ where: { [P.idField]: partyId, transaction_date: { lt: range.start } }, _sum: { debit: true, credit: true } })
          : Promise.resolve(null),
        skip > 0
          ? table.findMany({ where: listed, orderBy: ORDER, take: skip, select: { debit: true, credit: true } })
          : Promise.resolve([])
      ])

      const openingBalance =
        (beforeRange ? Number(beforeRange._sum.debit || 0) - Number(beforeRange._sum.credit || 0) : 0) +
        (earlierPages as any[]).reduce((s, e) => s + Number(e.debit) - Number(e.credit), 0)

      let running = openingBalance
      const formattedEntries = (entries as any[])
        .map(entry => {
          running += Number(entry.debit) - Number(entry.credit)
          return { entry, balance: running }
        })
        // Zero-value rows (cancelled transactions) still count toward the
        // balance above; they are only left off the page.
        .filter(({ entry }) => Number(entry.debit) !== 0 || Number(entry.credit) !== 0)
        .map(({ entry, balance }) => ({
          id: entry.id,
          date: entry.transaction_date,
          formattedDate: new Date(entry.transaction_date * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
          particulars: entry.notes || '',
          voucherType: entry.transaction_type,
          voucherNo: entry.reference_no || '-',
          debit: Number(entry.debit) || 0,
          credit: Number(entry.credit) || 0,
          balance,
          remarks: entry.notes || '',
          paymentMode: entry.payment_mode,
          transactionType: entry.transaction_type,
          referenceType: entry.reference_type,
          referenceId: entry.reference_id,
          transaction_id: entry.transaction_id
        }))

      return res.status(200).json({ entries: formattedEntries, openingBalance, pagination: reportPagination(page, limit, total) })
    } catch (error) {
      return fail(res, error, `fetch ${party} ledger`)
    }
  }
}
