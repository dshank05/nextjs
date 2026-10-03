import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../db'
import { badRequest, fail, parseId, route } from './respond'

/**
 * PATCH /api/vendor-ledger/[id] and /api/customer-ledger/[id]: a ledger row's
 * note. Notes do not touch money, so there is no balance work.
 *
 * The customer route did not exist - the customer ledger page's note edit
 * called it and got a 404 (SA-36). The vendor route opened its own
 * PrismaClient and returned raw error text.
 */
export function ledgerNoteRoute(table: 'vendor_ledger' | 'customer_ledger') {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    const id = parseId(req.query.id)
    if (id === null) return badRequest(res, 'Invalid ledger entry ID')
    return route(req, res, {
      PATCH: async () => {
        const notes = req.body?.notes
        if (notes === undefined || notes === null) return badRequest(res, 'Notes field is required in request body')
        try {
          const updated = await (prisma as any)[table].update({
            where: { id },
            data: { notes: String(notes).trim() },
            select: { id: true, notes: true, updated_at: true }
          })
          return res.status(200).json({ success: true, data: updated })
        } catch (error) {
          return fail(res, error, `update ${table} note`)
        }
      }
    })
  }
}
