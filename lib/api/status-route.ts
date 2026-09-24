import type { NextApiRequest, NextApiResponse } from 'next'
import { isRecordStatus, type RecordStatus } from '../../types/settings'
import { ok, badRequest, notFound, fail, parseId, methodNotAllowed } from './respond'

/**
 * One shape for activating and deactivating a settings record.
 *
 * Every resource had invented its own, and none of them agreed:
 *
 * - **warehouses** took the id in the query with a body of `{status}` for the
 *   toggle, and in the body for the edit - the same route, two contracts, and
 *   the body one silently discarded `status` (S-19, S-20).
 * - **racks** had to resend `rack_number` alongside `{id, status}`, with the
 *   comment "Include current rack_number as required by API". It was not
 *   required; the handler treats every field as optional (S-63).
 * - **gst-rates** hid a status-only branch inside its full-update PUT that only
 *   fires when all four other fields are absent, *and* offered a status dropdown
 *   in the edit form, so a rate had two ways to change status (S-66).
 * - **states** has no status column at all and hard-deletes instead (S-71).
 *
 * `products/[id]/status.ts` already got this right for F-91, and the reasoning
 * there applies to all of them: **activation is a state transition, not a field
 * edit.** A form has no business setting it, and an endpoint that edits fields
 * has no business inferring it from which fields are missing.
 *
 * Setting a record to the status it already has is a success, not an error -
 * two operators pressing Deactivate should not produce a failure for the second.
 */
export function makeStatusRoute(opts: {
  /** Used in messages: "Warehouse not found", "Warehouse deactivated." */
  label: string
  /**
   * The dynamic segment holding the id. Defaults to `id`; warehouses must use
   * `warehouseId`, because Next.js will not allow two differently-named dynamic
   * segments at the same level and `[warehouseId]/racks.ts` was there first.
   */
  idParam?: string
  find: (id: number) => Promise<{ id: number; status: string | null } | null>
  update: (id: number, status: RecordStatus) => Promise<{ id: number; status: string | null }>
}) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'PATCH' && req.method !== 'PUT') {
      return methodNotAllowed(res, ['PATCH', 'PUT'])
    }

    const id = parseId(req.query[opts.idParam ?? 'id'])
    if (id === null) {
      return badRequest(res, `A valid ${opts.label.toLowerCase()} ID is required`)
    }

    const { status } = (req.body ?? {}) as { status?: unknown }
    if (!isRecordStatus(status)) {
      return badRequest(res, "status must be 'Active' or 'Inactive'")
    }

    try {
      const existing = await opts.find(id)
      if (!existing) {
        return notFound(res, `${opts.label} not found`)
      }

      if (existing.status === status) {
        return ok(res, {
          status: 'success',
          message: `${opts.label} is already ${status.toLowerCase()}.`,
          data: existing,
        })
      }

      const row = await opts.update(id, status)
      return ok(res, {
        status: 'success',
        message: `${opts.label} ${status === 'Active' ? 'activated' : 'deactivated'}.`,
        data: row,
      })
    } catch (error) {
      return fail(res, error, `change the ${opts.label.toLowerCase()} status`)
    }
  }
}
