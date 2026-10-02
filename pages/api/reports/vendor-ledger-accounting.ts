import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { badRequest, fail, methodNotAllowed } from '../../../lib/api/respond'
import { withObservability } from '../../../lib/withObservability'
import { queryInt, reportPage, reportPagination, reportDayRange } from '../../../lib/api/report-query'

/**
 * One vendor's ledger, a page at a time, with a running balance.
 *
 * The running balance started at 0 on every page and ignored everything
 * before `dateFrom`, so page 2 onward and any dated view showed the wrong
 * balance on every row (PU-26). `openingBalance` is now everything that comes
 * before the first row of this page - earlier dates and earlier pages - and
 * each row's balance runs on from it. The page's client re-runs the balance
 * after merging adjustments and starts from the same opening figure.
 */

// Display order. "Before this page" means before it in exactly this order.
const ORDER = [{ transaction_date: 'asc' as const }, { created_at: 'asc' as const }, { id: 'asc' as const }]

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  try {
    const vendorId = queryInt(req, 'vendor_id')
    if (vendorId === null) return badRequest(res, 'Vendor ID is required')

    const { page, limit, skip } = reportPage(req, 50, 1000)
    const range = reportDayRange(req)

    const where: any = { vendor_id: vendorId }
    if (range) {
      where.transaction_date = {}
      if (range.start !== null) where.transaction_date.gte = range.start
      if (range.end !== null) where.transaction_date.lte = range.end
    }

    const [entries, total, beforeRange, earlierPages] = await Promise.all([
      prisma.vendor_ledger.findMany({ where, orderBy: ORDER, skip, take: limit }),
      prisma.vendor_ledger.count({ where }),
      range?.start != null
        ? prisma.vendor_ledger.aggregate({
            where: { vendor_id: vendorId, transaction_date: { lt: range.start } },
            _sum: { debit: true, credit: true }
          })
        : Promise.resolve(null),
      skip > 0
        ? prisma.vendor_ledger.findMany({ where, orderBy: ORDER, take: skip, select: { debit: true, credit: true } })
        : Promise.resolve([] as { debit: number; credit: number }[])
    ])

    const openingBalance =
      (beforeRange ? Number(beforeRange._sum.debit || 0) - Number(beforeRange._sum.credit || 0) : 0) +
      earlierPages.reduce((s, e) => s + Number(e.debit) - Number(e.credit), 0)

    let running = openingBalance
    const formattedEntries = entries
      .map(entry => {
        running += Number(entry.debit) - Number(entry.credit)
        return { entry, balance: running }
      })
      // Zero-value rows (cancelled transactions) still count toward the balance
      // above; they are only left off the page.
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

    return res.status(200).json({
      entries: formattedEntries,
      openingBalance,
      pagination: reportPagination(page, limit, total)
    })
  } catch (error) {
    return fail(res, error, 'fetch vendor ledger')
  }
}

export default withObservability(handler)
