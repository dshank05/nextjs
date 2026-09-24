import { prisma } from '../../../../lib/db'
import { withObservability } from '../../../../lib/withObservability'
import { makeStatusRoute } from '../../../../lib/api/status-route'

/** PATCH /api/mechanics/[id]/status — activate or deactivate a mechanic. */
export default withObservability(
  makeStatusRoute({
    label: 'Mechanic',
    find: (id) => prisma.mechanic.findUnique({ where: { id }, select: { id: true, status: true } }),
    update: (id, status) =>
      prisma.mechanic.update({ where: { id }, data: { status }, select: { id: true, status: true } }),
  })
)
