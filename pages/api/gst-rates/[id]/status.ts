import { prisma } from '../../../../lib/db'
import { withObservability } from '../../../../lib/withObservability'
import { makeStatusRoute } from '../../../../lib/api/status-route'

/**
 * PATCH /api/gst-rates/[id]/status — activate or deactivate a GST rate.
 *
 * Replaces the status-only branch buried in the full-update PUT, which only
 * fired when all four other fields happened to be absent (S-66).
 */
export default withObservability(
  makeStatusRoute({
    label: 'GST rate',
    find: (id) => prisma.gst_tax_rate.findUnique({ where: { id }, select: { id: true, status: true } }),
    update: (id, status) =>
      prisma.gst_tax_rate.update({ where: { id }, data: { status }, select: { id: true, status: true } }),
  })
)
