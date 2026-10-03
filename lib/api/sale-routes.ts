import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../pages/api/auth/[...nextauth]'
import { prisma } from '../db'
import { getCurrentFinancialYear } from '../financial-year'
import { ok, badRequest, notFound, fail, parseId, route } from './respond'
import { listResponse } from './list-query'
import { SaleKind, SaleError, saleTables } from '../sale'
import { createSale } from '../sale-create'
import { updateSale } from '../sale-edit'
import { deleteSale } from '../sale-delete'
import { loadSaleDetail } from '../sale-read'
import { listSales, parseSaleListQuery } from '../sale-query'

/**
 * The sale and salex API routes. Both kinds answer the same way, so the six
 * route files are one line each; the work lives in lib/sale-*.ts.
 */

async function signedIn(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

/** A refusal with its own message; Prisma conflicts translated; anything else a bare 500. */
function answerError(res: NextApiResponse, error: any, context: string) {
  if (error instanceof SaleError) {
    return res.status(error.httpStatus).json({
      status: 'failure',
      message: error.clientMessage,
      error_code: error.code,
      ...(error.detail ? { item: error.detail } : {})
    })
  }
  if (error?.code === 'P2002') {
    console.error(`${context}:`, error)
    return res.status(409).json({ message: 'That bill conflicts with an existing record. Check the invoice number for this financial year.', error_code: 'DUPLICATE_RECORD' })
  }
  if (error?.code === 'P2003') {
    console.error(`${context}:`, error)
    return res.status(400).json({ message: 'A selected customer, staff member, mechanic or product does not exist' })
  }
  return fail(res, error, context)
}

/** /api/sales and /api/salex: list (GET) and create (POST). */
export function saleCollectionRoute(kind: SaleKind) {
  const t = saleTables(kind)
  const legacyKey = kind === 'sale' ? 'sales' : 'salexs'
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (!(await signedIn(req, res))) return
    return route(req, res, {
      GET: async () => {
        try {
          const { sales, pagination } = await listSales(kind, parseSaleListQuery(req))
          return res.status(200).json(listResponse(sales, pagination, legacyKey))
        } catch (error) {
          return fail(res, error, `fetch ${kind} list`)
        }
      },
      POST: async () => {
        try {
          const created = await createSale(kind, req.body)
          return res.status(201).json({
            message: `${t.label} created successfully`,
            sale: created,
            invoice: created,
            data: created
          })
        } catch (error) {
          return answerError(res, error, `create ${kind}`)
        }
      }
    })
  }
}

/** /api/sales/[id] and /api/salex/[id]: read, edit, delete. */
export function saleDocumentRoute(kind: SaleKind) {
  const t = saleTables(kind)
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (!(await signedIn(req, res))) return
    const id = parseId(req.query.id)
    if (id === null) return badRequest(res, `Invalid ${t.label} ID`)
    return route(req, res, {
      GET: async () => {
        try {
          const doc = await loadSaleDetail(kind, id)
          if (!doc) return notFound(res, `${t.label} not found`)
          return ok(res, doc)
        } catch (error) {
          return fail(res, error, `fetch ${kind}`)
        }
      },
      PUT: async () => {
        try {
          const updated = await updateSale(kind, id, req.body)
          return res.status(200).json({
            status: 'success',
            message: `${t.label} updated successfully`,
            sale: { id: updated.id, invoice_no: updated.invoice_no, total: updated.total }
          })
        } catch (error) {
          return answerError(res, error, `update ${kind}`)
        }
      },
      DELETE: async () => {
        try {
          await deleteSale(kind, id)
          return res.status(200).json({ success: true, message: `${t.label} deleted successfully`, sale_id: id })
        } catch (error) {
          return answerError(res, error, `delete ${kind}`)
        }
      }
    })
  }
}

/**
 * The last number in the CURRENT financial year, as the counter sees it. The
 * forms asked the list for `sort=-invoice_no`, which it never supported, so the
 * preview was the latest-dated bill + 1 (SA-16). Purchase has the same route.
 */
export function saleLastInvoiceRoute(kind: SaleKind) {
  const t = saleTables(kind)
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (!(await signedIn(req, res))) return
    return route(req, res, {
      GET: async () => {
        try {
          const fy = await getCurrentFinancialYear()
          const last = await (prisma as any)[t.header].findFirst({
            where: { fy },
            orderBy: { invoice_no: 'desc' },
            select: { invoice_no: true }
          })
          const lastInvoiceNumber = last?.invoice_no || 0
          return ok(res, { lastInvoiceNumber, fy, nextInvoiceNumber: lastInvoiceNumber + 1 })
        } catch (error) {
          return fail(res, error, `fetch last ${kind} number`)
        }
      }
    })
  }
}
