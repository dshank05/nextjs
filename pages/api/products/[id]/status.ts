import { prisma } from '../../../../lib/db';
import { withObservability } from '../../../../lib/withObservability';
import { makeStatusRoute } from '../../../../lib/api/status-route';

/**
 * PATCH /api/products/[id]/status — activate or deactivate a product, with
 * `{ status: 'Active' | 'Inactive' }` like every settings resource (PQ-33).
 * Activation is a state transition, not a field edit, so it is not part of the
 * product form's PUT (F-91). The column is a boolean; the route speaks status.
 */
const asStatus = (row: { id: number; is_active: boolean | null }) => ({
  id: row.id,
  status: row.is_active === false ? 'Inactive' : 'Active'
});

export default withObservability(
  makeStatusRoute({
    label: 'Product',
    find: async (id) => {
      const row = await prisma.product.findUnique({ where: { id }, select: { id: true, is_active: true } });
      return row ? asStatus(row) : null;
    },
    update: async (id, status) =>
      asStatus(
        await prisma.product.update({
          where: { id },
          data: { is_active: status === 'Active' },
          select: { id: true, is_active: true }
        })
      )
  })
);
