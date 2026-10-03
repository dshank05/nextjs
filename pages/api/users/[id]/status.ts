import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../../lib/db'
import { withObservability } from '../../../../lib/withObservability'
import { ok, badRequest, notFound, fail, parseId, methodNotAllowed } from '../../../../lib/api/respond'
import {
  USER_STATUS_ACTIVE,
  USER_STATUS_INACTIVE,
  userStatusLabel,
} from '../../../../types/settings'
import { deactivationRefusal } from '../../../../lib/user-guard'

/**
 * PATCH /api/users/[id]/status - activate or deactivate an account.
 *
 * S-28: the Users page had no deactivate action at all. Status could only be
 * changed by opening the edit modal and picking from a dropdown - and until
 * S-25 that silently did nothing, because `parseInt("0") || 10` put the account
 * straight back to Active.
 *
 * This mirrors `lib/api/status-route.ts` rather than using it, because `user`
 * is the one settings model that stores status as a number (10 / 0) instead of
 * the 'Active' / 'Inactive' strings. That difference is real and load-bearing -
 * it is what made S-25 a bug - so it is handled explicitly here rather than
 * hidden behind a cast.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH' && req.method !== 'PUT') {
    return methodNotAllowed(res, ['PATCH', 'PUT'])
  }

  const id = parseId(req.query.id)
  if (id === null) return badRequest(res, 'A valid user ID is required')

  const { status } = (req.body ?? {}) as { status?: unknown }

  // Accept the number or the label, so a caller does not have to know that this
  // one model counts instead of naming.
  let next: number | null = null
  if (status === USER_STATUS_ACTIVE || status === String(USER_STATUS_ACTIVE) || status === 'Active') {
    next = USER_STATUS_ACTIVE
  } else if (status === USER_STATUS_INACTIVE || status === String(USER_STATUS_INACTIVE) || status === 'Inactive') {
    next = USER_STATUS_INACTIVE
  }

  if (next === null) {
    return badRequest(
      res,
      `status must be ${USER_STATUS_ACTIVE} (Active) or ${USER_STATUS_INACTIVE} (Inactive)`
    )
  }

  try {
    const existing = await prisma.user.findUnique({
      where: { id },
      select: { id: true, status: true },
    })
    if (!existing) return notFound(res, 'User not found')

    if (existing.status === next) {
      return ok(res, {
        status: 'success',
        message: `User is already ${userStatusLabel(next).toLowerCase()}.`,
        data: existing,
      })
    }

    if (next === USER_STATUS_INACTIVE) {
      const refusal = await deactivationRefusal(req, res, id)
      if (refusal) return res.status(409).json({ message: refusal })
    }

    const row = await prisma.user.update({
      where: { id },
      data: { status: next, updated_at: Math.floor(Date.now() / 1000) },
      select: { id: true, status: true },
    })

    return ok(res, {
      status: 'success',
      message: `User ${next === USER_STATUS_ACTIVE ? 'activated' : 'deactivated'}.`,
      data: row,
    })
  } catch (error) {
    return fail(res, error, 'change the user status')
  }
}

export default withObservability(handler)
