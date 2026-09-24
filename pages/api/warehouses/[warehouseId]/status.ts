import { prisma } from '../../../../lib/db'
import { withObservability } from '../../../../lib/withObservability'
import { makeStatusRoute } from '../../../../lib/api/status-route'

/**
 * PATCH /api/warehouses/[warehouseId]/status - activate or deactivate.
 *
 * Replaces the two disagreeing PUT contracts on /api/warehouses, one of which
 * accepted `status`, answered 200, and threw it away (S-19, S-20).
 */
export default withObservability(
  makeStatusRoute({
    label: 'Warehouse',
    idParam: 'warehouseId',
    find: (id) => prisma.warehouse.findUnique({ where: { id }, select: { id: true, status: true } }),
    update: (id, status) =>
      prisma.warehouse.update({ where: { id }, data: { status }, select: { id: true, status: true } }),
  })
)
