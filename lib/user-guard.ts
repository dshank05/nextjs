import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../pages/api/auth/[...nextauth]'
import { prisma } from './db'
import { USER_STATUS_ACTIVE } from '../types/settings'

/**
 * Why deactivating this account must be refused, or null when it may go ahead
 * (owner, 2026-10-03). Two rules, on both paths that can deactivate (the status
 * toggle and the edit form):
 *  - nobody may deactivate the account they are signed in with - they would be
 *    locked out mid-session;
 *  - the last active account may not be deactivated - nobody could sign in.
 */
export async function deactivationRefusal(req: NextApiRequest, res: NextApiResponse, userId: number): Promise<string | null> {
  const session: any = await getServerSession(req, res, authOptions).catch(() => null)
  if (session?.user?.id && String(session.user.id) === String(userId)) {
    return 'You cannot deactivate the account you are signed in with'
  }
  const othersActive = await prisma.user.count({ where: { status: USER_STATUS_ACTIVE, id: { not: userId } } })
  if (othersActive === 0) {
    return 'At least one active user is needed: this is the last one'
  }
  return null
}
