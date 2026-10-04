import { SaleError } from './sale';

/**
 * The reason each return line is stored with (D-04).
 *
 * The forms list the reasons of their own kind (`/api/return-reasons?type=sale`
 * for sale and Invoice C returns, `purchase` for purchase returns) and the
 * server took whatever id came, defaulting to 1 - a PURCHASE reason - so a sale
 * line left on "Select reason..." was saved as "Incorrect Quantity".
 *
 *  - no reason sent: the first active reason of the kind, by name - the one the
 *    form shows first;
 *  - a reason that is not one of the kind's: refused (INVALID_REASON);
 *  - no reasons of the kind set up at all: the id as sent (1 when none), as before.
 *
 * `kinds[0]` is the kind whose reasons the form offers; Invoice C also accepts
 * the seeded `salex` reasons.
 */
export async function resolveReturnReasons(tx: any, kinds: string[], sent: (number | null)[], label: string): Promise<number[]> {
  const rows: any[] = await tx.return_reasons.findMany({
    where: { type: { in: kinds } },
    select: { id: true, reason_name: true, type: true, status: true }
  });
  if (!rows.length) return sent.map(id => id ?? 1);
  const known = new Set(rows.map(r => r.id));
  const first = rows
    .filter(r => r.type === kinds[0] && (r.status ?? 'Active') === 'Active')
    .sort((a, b) => String(a.reason_name).localeCompare(String(b.reason_name)) || a.id - b.id)[0]
    ?? rows.slice().sort((a, b) => a.id - b.id)[0];
  return sent.map(id => {
    if (id === null) return first.id;
    if (!known.has(id)) throw new SaleError(400, `Pick a ${label} return reason for every line`, 'INVALID_REASON', { return_reason_id: id });
    return id;
  });
}
