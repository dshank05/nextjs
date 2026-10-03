import { prisma } from './db';
import { SaleError } from './sale';

/**
 * Dead stock: units taken out of sellable stock with a reason (DETAILS_PLAN D4).
 * Every change moves product.stock in the same transaction, and the stock check
 * runs inside it. Editing to a larger quantity used to check
 * `stock + old quantity >= increase`, which let stock go negative.
 * Quantities are whole units, like every other stock movement (PU-33).
 */
const whole = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

function checkQuantity(q: number) {
  if (!Number.isFinite(q) || q <= 0) throw new SaleError(400, 'Quantity must be greater than 0', 'VALIDATION');
  if (!Number.isInteger(q)) throw new SaleError(400, 'Quantity must be a whole number of units', 'VALIDATION');
}

const row = (d: any) => ({
  id: d.id,
  product_id: d.product_id,
  product_name: d.product?.product_name || '',
  part_no: d.product?.part_no || '',
  quantity: d.quantity,
  reason: d.reason,
  created_by: d.created_by || '',
  created_at: d.created_at,
  updated_at: d.updated_at,
  formatted_created_at: d.created_at ? new Date(d.created_at).toLocaleDateString('en-IN') : '',
  formatted_updated_at: d.updated_at ? new Date(d.updated_at).toLocaleDateString('en-IN') : ''
});

export function parseDeadstockQuery(q: Record<string, unknown>) {
  const one = (v: unknown) => String((Array.isArray(v) ? v[0] : v) ?? '').trim();
  return {
    page: Math.max(1, parseInt(one(q.page), 10) || 1),
    limit: Math.min(500, Math.max(1, parseInt(one(q.limit), 10) || 50)),
    search: one(q.search),
    sortBy: one(q.sortBy) || 'created_at',
    sortOrder: (one(q.sortOrder) === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'
  };
}

export async function listDeadstock(q: ReturnType<typeof parseDeadstockQuery>) {
  const where: any = {};
  if (q.search) {
    where.OR = [
      { reason: { contains: q.search } },
      { created_by: { contains: q.search } },
      { product: { product_name: { contains: q.search } } },
      { product: { part_no: { contains: q.search } } }
    ];
  }
  const rows = (await prisma.deadstock.findMany({
    where,
    include: { product: { select: { id: true, product_name: true, part_no: true } } }
  })).map(row);
  const keyOf: Record<string, (r: any) => any> = {
    product_name: r => String(r.product_name).toLowerCase(),
    quantity: r => r.quantity,
    reason: r => String(r.reason).toLowerCase(),
    created_by: r => String(r.created_by).toLowerCase(),
    created_at: r => new Date(r.created_at).getTime(),
    updated_at: r => new Date(r.updated_at).getTime(),
    id: r => r.id
  };
  const key = keyOf[q.sortBy] || keyOf.created_at;
  const dir = q.sortOrder === 'asc' ? 1 : -1;
  rows.sort((a, b) => (key(a) < key(b) ? -dir : key(a) > key(b) ? dir : b.id - a.id));
  const total = rows.length;
  const totalPages = Math.ceil(total / q.limit);
  const start = (q.page - 1) * q.limit;
  return {
    deadstock: rows.slice(start, start + q.limit),
    pagination: { page: q.page, limit: q.limit, total, totalPages, hasMore: q.page < totalPages }
  };
}

export async function getDeadstock(id: number) {
  const d = await prisma.deadstock.findUnique({ where: { id }, include: { product: { select: { id: true, product_name: true, part_no: true, stock: true } } } });
  if (!d) throw new SaleError(404, 'Deadstock entry not found', 'NOT_FOUND');
  return { ...row(d), available_stock: (d as any).product?.stock || 0 };
}

export async function createDeadstock(body: any) {
  const productId = parseInt(String(body.product_id), 10);
  const quantity = whole(body.quantity);
  const reason = String(body.reason ?? '').trim();
  if (!productId || !reason) throw new SaleError(400, 'Product ID, quantity, and reason are required', 'VALIDATION');
  checkQuantity(quantity);
  return prisma.$transaction(async (tx: any) => {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, stock: true } });
    if (!product) throw new SaleError(400, 'Product not found', 'VALIDATION');
    if ((Number(product.stock) || 0) < quantity) {
      throw new SaleError(400, `Insufficient stock. Available: ${product.stock || 0}, Requested: ${quantity}`, 'INSUFFICIENT_STOCK');
    }
    const d = await tx.deadstock.create({
      data: { product_id: productId, quantity, reason, created_by: String(body.created_by ?? '').trim() || null },
      include: { product: { select: { id: true, product_name: true, part_no: true } } }
    });
    await tx.product.update({ where: { id: productId }, data: { stock: { decrement: quantity } } });
    return row(d);
  });
}

export async function updateDeadstock(id: number, body: any) {
  const quantity = whole(body.quantity);
  const reason = String(body.reason ?? '').trim();
  if (!reason || body.quantity === undefined || body.quantity === null || body.quantity === '') {
    throw new SaleError(400, 'Quantity and reason are required', 'VALIDATION');
  }
  checkQuantity(quantity);
  return prisma.$transaction(async (tx: any) => {
    const current = await tx.deadstock.findUnique({ where: { id } });
    if (!current) throw new SaleError(404, 'Deadstock entry not found', 'NOT_FOUND');
    const more = quantity - Number(current.quantity);
    if (more > 0) {
      const product = await tx.product.findUnique({ where: { id: current.product_id }, select: { stock: true } });
      // Stock already excludes this entry's units; only the increase has to fit.
      if ((Number(product?.stock) || 0) < more) {
        throw new SaleError(400, `Insufficient stock for increase. Available: ${product?.stock || 0}, Needed: ${more}`, 'INSUFFICIENT_STOCK');
      }
    }
    const d = await tx.deadstock.update({
      where: { id },
      data: { quantity, reason },
      include: { product: { select: { id: true, product_name: true, part_no: true } } }
    });
    if (more !== 0) await tx.product.update({ where: { id: current.product_id }, data: { stock: { decrement: more } } });
    return row(d);
  });
}

export async function deleteDeadstock(id: number) {
  return prisma.$transaction(async (tx: any) => {
    const current = await tx.deadstock.findUnique({ where: { id } });
    if (!current) throw new SaleError(404, 'Deadstock entry not found', 'NOT_FOUND');
    await tx.product.update({ where: { id: current.product_id }, data: { stock: { increment: current.quantity } } });
    await tx.deadstock.delete({ where: { id } });
    return { returned_quantity: current.quantity, product_id: current.product_id };
  });
}
