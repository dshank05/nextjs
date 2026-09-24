import { prisma } from '../../../../lib/db'
import { withObservability } from '../../../../lib/withObservability'
import { makeStatusRoute } from '../../../../lib/api/status-route'

/** PATCH /api/staff/[id]/status — activate or deactivate a staff member. */
export default withObservability(
  makeStatusRoute({
    label: 'Staff member',
    find: (id) => prisma.staff.findUnique({ where: { id }, select: { id: true, status: true } }),
    update: (id, status) =>
      prisma.staff.update({ where: { id }, data: { status }, select: { id: true, status: true } }),
  })
)
