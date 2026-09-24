import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * One response shape, and one place that decides what leaves the server.
 *
 * Before this, twelve settings endpoints used FIVE different envelopes -
 * `{staff, pagination}`, `{success, data}`, `{status, message}`,
 * `{status, message, data}` and `{financialYears, currentFyId, pagination}` -
 * and `bank-details` used two of them in one file (S-72). A caller could not
 * write one function to read a list or one function to read an error.
 *
 * Every handler also hand-rolled its catch block as
 * `{ message, error: error.message }`, which returns the database's own words -
 * table names, constraint names, and in one Phase 4 case the entire Prisma
 * invocation - to the browser. That is F-81 / F-98 / P4-20 / D-07, found and
 * fixed four separate times already. `fail()` is the fifth fix and the last:
 * it logs everything and returns nothing but a sentence.
 */

/** Prisma error codes worth translating. Anything else is a 500. */
const PRISMA_STATUS: Record<string, { status: number; message: string }> = {
  P2025: { status: 404, message: 'Record not found' },
  P2002: { status: 409, message: 'That value is already in use' },
  P2003: { status: 400, message: 'Referenced record does not exist' },
  P2000: { status: 400, message: 'A value is too long for its column' },
}

export function ok<T>(res: NextApiResponse, body: T) {
  return res.status(200).json(body as any)
}

/**
 * 201 with the created record.
 *
 * Every create in Settings but one answered `{status, message}` with no id, so
 * a caller could not navigate to, highlight or link what it had just made
 * (S-53). Six of them were already fetching the row through a Prisma `select`
 * and discarding it (S-79) - the data was there, it just was not returned.
 */
export function created<T>(res: NextApiResponse, data: T, message: string) {
  return res.status(201).json({ status: 'success', message, data })
}

export function updated<T>(res: NextApiResponse, data: T, message: string) {
  return res.status(200).json({ status: 'success', message, data })
}

export function badRequest(res: NextApiResponse, message: string) {
  return res.status(400).json({ message })
}

export function notFound(res: NextApiResponse, message: string) {
  return res.status(404).json({ message })
}

export function conflict(res: NextApiResponse, message: string) {
  return res.status(409).json({ message })
}

export function methodNotAllowed(res: NextApiResponse, allowed: string[]) {
  res.setHeader('Allow', allowed)
  return res.status(405).json({ message: 'Method not allowed' })
}

/**
 * The only catch block a handler should need.
 *
 * Logs the error in full server-side, then answers with a translated status
 * where Prisma gave us one and a bare sentence otherwise. The raw message never
 * leaves the process.
 */
export function fail(res: NextApiResponse, error: unknown, context: string) {
  console.error(`${context}:`, error)

  const code = (error as any)?.code
  if (typeof code === 'string' && PRISMA_STATUS[code]) {
    const mapped = PRISMA_STATUS[code]
    return res.status(mapped.status).json({ message: mapped.message })
  }

  return res.status(500).json({ message: `Failed to ${context}` })
}

/**
 * Parse a route's `[id]` segment.
 *
 * Four handlers called `parseInt(id)` with no radix and no NaN check, so a
 * missing or junk id reached Prisma as `where: { id: NaN }` and surfaced as a
 * 500 instead of a 400 (S-73, S-80).
 */
export function parseId(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined || value === null || value === '') return null
  const id = parseInt(String(value), 10)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** Route a request by method, with a correct `Allow` header when it matches none. */
export function route(
  req: NextApiRequest,
  res: NextApiResponse,
  handlers: Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', () => unknown>>
) {
  const handler = handlers[req.method as keyof typeof handlers]
  if (!handler) return methodNotAllowed(res, Object.keys(handlers))
  return handler()
}
