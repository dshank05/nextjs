/**
 * Advance money, for vendors and customers alike.
 *
 * When a bill is paid partly or wholly from an advance, the bill used to get a
 * NEW payment row of type BILL_SPECIFIC for the advance portion - money that
 * had been paid long before and was already counted in total_paid. Deleting
 * the bill then deleted that row as "created by this bill" and took it off
 * total_paid a second time (SA-28). Unmarking a bill deleted EVERY payment
 * left without allocations, including the customer's original advance.
 *
 * Now:
 *  - the advance portion is ALLOCATED from the party's existing payments that
 *    still have unallocated money (oldest first); no new row;
 *  - only the money paid with the bill is a new BILL_SPECIFIC payment;
 *  - releasing a bill's allocations deletes only the BILL_SPECIFIC payments it
 *    created, returns MIXED ones to DIRECT, and reports how much payment was
 *    actually removed, so total_paid moves by exactly that (L-26, both sides).
 */

export type Party = 'vendor' | 'customer';

const T = {
  vendor: { payments: 'vendor_payments', allocs: 'payment_allocations', partyFk: 'vendor_id' },
  customer: { payments: 'customer_payments', allocs: 'customer_payment_allocations', partyFk: 'customer_id' }
} as const;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Allocate `amount` of the party's unallocated payments to one bill.
 * `docField` names the bill: { purchase_id: 7 }, { invoice_id: 7 } or { invoicex_id: 7 }.
 *
 * The amount comes from the counters (total_paid - total_allocated, plus
 * unallocated refunds). When the payment rows hold less than that - refund
 * credit, or legacy rows - the rest is recorded as one DIRECT payment row
 * marked as carried advance, so the bill is fully allocated and the counters
 * still agree (total_paid is not raised: the counters already hold it).
 * Returns the amount allocated, always `amount`.
 */
export async function allocateFromAdvance(
  tx: any,
  party: Party,
  partyId: number,
  docField: Record<string, number>,
  amount: number,
  date: number,
  carried: { mode?: number | null; fy: number }
): Promise<number> {
  const t = T[party];
  let need = round2(amount);
  if (need <= 0) return 0;
  const payments = await tx[t.payments].findMany({
    where: { [t.partyFk]: partyId },
    orderBy: [{ payment_date: 'asc' }, { id: 'asc' }],
    select: { id: true, payment_amount: true, payment_type: true, allocations: { select: { allocated_amount: true } } }
  });
  let allocated = 0;
  for (const p of payments) {
    if (need <= 0) break;
    const used = (p.allocations || []).reduce((s: number, a: any) => s + Number(a.allocated_amount), 0);
    const free = round2(Number(p.payment_amount) - used);
    if (free <= 0) continue;
    const take = Math.min(free, need);
    await tx[t.allocs].create({
      data: { payment_id: p.id, ...docField, allocated_amount: take, allocation_date: date, notes: 'Allocated from existing advance balance' }
    });
    if (p.payment_type === 'DIRECT') {
      await tx[t.payments].update({ where: { id: p.id }, data: { payment_type: 'MIXED' } });
    }
    need = round2(need - take);
    allocated = round2(allocated + take);
  }
  if (need > 0) {
    const row = await tx[t.payments].create({
      data: {
        [t.partyFk]: partyId,
        payment_date: date,
        payment_amount: need,
        payment_mode: carried.mode ?? 0,
        payment_type: 'MIXED',
        notes: 'Advance carried in the balance with no payment row (refund credit or older data)',
        fy: carried.fy
      }
    });
    await tx[t.allocs].create({
      data: { payment_id: row.id, ...docField, allocated_amount: need, allocation_date: date, notes: 'Allocated from existing advance balance' }
    });
    allocated = round2(allocated + need);
  }
  return allocated;
}

/**
 * Remove a bill's allocations. A payment left with none: BILL_SPECIFIC (made
 * with this bill) is deleted and counted in `paymentsRemoved`; MIXED (an
 * advance) goes back to DIRECT and stays paid.
 */
export async function releaseAllocations(
  tx: any,
  party: Party,
  where: Record<string, unknown>
): Promise<{ deallocated: number; paymentsRemoved: number }> {
  const t = T[party];
  const allocations = await tx[t.allocs].findMany({ where, select: { payment_id: true, allocated_amount: true } });
  const deallocated = round2(allocations.reduce((s: number, a: any) => s + Number(a.allocated_amount), 0));
  if (!allocations.length) return { deallocated: 0, paymentsRemoved: 0 };
  await tx[t.allocs].deleteMany({ where });

  let paymentsRemoved = 0;
  const ids: number[] = Array.from(new Set(allocations.map((a: any) => a.payment_id as number)));
  for (const id of ids) {
    if ((await tx[t.allocs].count({ where: { payment_id: id } })) > 0) continue;
    const payment = await tx[t.payments].findUnique({ where: { id }, select: { payment_type: true, payment_amount: true } });
    if (!payment) continue;
    if (payment.payment_type === 'BILL_SPECIFIC') {
      paymentsRemoved = round2(paymentsRemoved + Number(payment.payment_amount));
      await tx[t.payments].delete({ where: { id } });
    } else if (payment.payment_type === 'MIXED') {
      await tx[t.payments].update({ where: { id }, data: { payment_type: 'DIRECT' } });
    }
  }
  return { deallocated, paymentsRemoved };
}

/**
 * Money a bill itself brought in: its allocations from BILL_SPECIFIC payments
 * (L-30). Advance it used is not counted - unmarking the bill must leave that
 * paid.
 */
export async function paidWithBill(tx: any, party: Party, where: Record<string, unknown>): Promise<number> {
  const t = T[party];
  const allocations = await tx[t.allocs].findMany({ where, select: { payment_id: true, allocated_amount: true } });
  if (!allocations.length) return 0;
  const ids = Array.from(new Set(allocations.map((a: any) => a.payment_id)));
  const billPayments = await tx[t.payments].findMany({
    where: { id: { in: ids }, payment_type: 'BILL_SPECIFIC' },
    select: { id: true }
  });
  const own = new Set(billPayments.map((p: any) => p.id));
  return round2(allocations.filter((a: any) => own.has(a.payment_id)).reduce((s: number, a: any) => s + Number(a.allocated_amount), 0));
}
