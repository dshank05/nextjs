import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from './db'
import { fail, methodNotAllowed, notFound } from './api/respond'
import { queryInt, queryString, reportPage, reportPagination, reportDayRange } from './api/report-query'

/**
 * The balance-change log of one vendor or customer, or (get_balance=true) the
 * party's four counters - one route for both.
 *
 * The customer copy loaded every log with no paging or date range, returned
 * Decimals raw and answered an unknown customer with 200 (SA-29). The vendor
 * copy was paged in Block D, but its page sums the LOADED rows to audit the
 * counters, so beyond 50 logs it reported a discrepancy that was not there.
 * `totals` is now the sum per column over every matching log, from the
 * database.
 */

const PARTY = {
  vendor: { logs: 'vendor_balance_logs', master: 'vendor_details', idField: 'vendor_id', relation: 'vendor', nameField: 'vendor_name', label: 'Vendor' },
  customer: { logs: 'customer_balance_logs', master: 'customer_details', idField: 'customer_id', relation: 'customer', nameField: 'billing_name', label: 'Customer' }
} as const

const COLUMNS = ['total_paid', 'total_allocated', 'total_refunded', 'total_refund_allocated'] as const

export function balanceLogRoute(party: keyof typeof PARTY) {
  const P = PARTY[party]
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    try {
      const db = prisma as any
      const partyId = queryInt(req, P.idField)

      if (queryString(req, 'get_balance') === 'true' && partyId !== null) {
        const row = await db[P.master].findUnique({
          where: { id: partyId },
          select: Object.fromEntries(COLUMNS.map(c => [c, true]))
        })
        if (!row) return notFound(res, `${P.label} not found`)
        return res.status(200).json({ success: true, balance: Object.fromEntries(COLUMNS.map(c => [c, Number(row[c] || 0)])) })
      }

      const { page, limit, skip } = reportPage(req)
      const where: any = {}
      if (partyId !== null) where[P.idField] = partyId
      const column = queryString(req, 'column_name')
      if (column) where.column_name = column
      const source = queryString(req, 'source_type')
      if (source) where.source_type = source
      const range = reportDayRange(req)
      if (range) {
        where.created_at = {}
        if (range.start !== null) where.created_at.gte = new Date(range.start * 1000)
        if (range.end !== null) where.created_at.lte = new Date((range.end + 1) * 1000 - 1)
      }

      const [logs, total, sums] = await Promise.all([
        db[P.logs].findMany({
          where,
          include: { [P.relation]: { select: { id: true, [P.nameField]: true } } },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          skip,
          take: limit
        }),
        db[P.logs].count({ where }),
        db[P.logs].groupBy({ by: ['column_name'], where, _sum: { change_amount: true } })
      ])

      return res.status(200).json({
        success: true,
        data: logs.map((log: any) => ({
          id: log.id,
          [P.idField]: log[P.idField],
          party_name: log[P.relation]?.[P.nameField] || 'Unknown',
          [`${party}_name`]: log[P.relation]?.[P.nameField] || 'Unknown',
          column_name: log.column_name,
          change_amount: Number(log.change_amount),
          old_value: Number(log.old_value),
          new_value: Number(log.new_value),
          source_type: log.source_type,
          source_id: log.source_id,
          reference_no: log.reference_no || '',
          created_at: log.created_at,
          created_by: log.created_by,
          notes: log.notes || ''
        })),
        totals: Object.fromEntries(COLUMNS.map(c => [c, Number(sums.find((s: any) => s.column_name === c)?._sum.change_amount || 0)])),
        pagination: reportPagination(page, limit, total)
      })
    } catch (error) {
      return fail(res, error, `fetch ${party} balance logs`)
    }
  }
}
