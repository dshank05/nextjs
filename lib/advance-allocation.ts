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

import { customerLedgerService } from './customer-ledger-service';
import { ledgerService } from './ledger-service';

export type Party = 'vendor' | 'customer';

const T = {
  vendor: { payments: 'vendor_payments', allocs: 'payment_allocations', partyFk: 'vendor_id' },
  customer: { payments: 'customer_payments', allocs: 'customer_payment_allocations', partyFk: 'customer_id' }
} as const;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Advance a party can still spend on a bill: money paid but not allocated, less money refunded
 * to (or from) it and not set against a return - the same as the stored account_balance and
 * A2 / A7 (H1, 2026-10-04: these places ADDED the refunds, so a refund given back was spent again).
 */
export function availableAdvance(b: { total_paid: unknown; total_allocated: unknown; total_refunded: unknown; total_refund_allocated: unknown } | null | undefined): number {
  if (!b) return 0;
  return round2(Number(b.total_paid) - Number(b.total_allocated) - (Number(b.total_refunded) - Number(b.total_refund_allocated)));
}

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
  // What each payment gave this bill.
  const released = new Map<number, number>();
  for (const a of allocations) released.set(a.payment_id, round2((released.get(a.payment_id) || 0) + Number(a.allocated_amount)));
  const removedIds: number[] = [];
  const reduced = new Map<number, number>();
  for (const [id, part] of Array.from(released.entries())) {
    const payment = await tx[t.payments].findUnique({ where: { id }, select: { payment_type: true, payment_amount: true } });
    if (!payment) continue;
    const others = await tx[t.allocs].count({ where: { payment_id: id } });
    if (payment.payment_type === 'BILL_SPECIFIC') {
      if (others === 0) {
        paymentsRemoved = round2(paymentsRemoved + Number(payment.payment_amount));
        await tx[t.payments].delete({ where: { id } });
        removedIds.push(id);
      } else {
        // Paid this bill and others: only this bill's share goes (owner, 2026-10-03 - the
        // rollback must be complete). It stays a bill-specific payment for the others.
        paymentsRemoved = round2(paymentsRemoved + part);
        await tx[t.payments].update({ where: { id }, data: { payment_amount: round2(Number(payment.payment_amount) - part) } });
        reduced.set(id, part);
      }
    } else if (payment.payment_type === 'MIXED' && others === 0) {
      await tx[t.payments].update({ where: { id }, data: { payment_type: 'DIRECT' } });
    }
  }
  // A customer payment from the payments screen posts ONE ledger row tagged with the payment,
  // not the bill, so the bill's own ledger delete never finds it: the row goes (or shrinks) with
  // its payment here. The vendor side posts one row per bill, which goes with the bill.
  if (party === 'customer' && (removedIds.length || reduced.size)) {
    let customerId: number | null = null;
    if (removedIds.length) {
      const gone = await tx.customer_ledger.findMany({ where: { transaction_id: { in: removedIds }, transaction_type: 'PAYMENT_RECEIVED', reference_type: 'payment' }, select: { id: true, customer_id: true } });
      if (gone.length) { customerId = gone[0].customer_id; await tx.customer_ledger.deleteMany({ where: { id: { in: gone.map((r: any) => r.id) } } }); }
    }
    for (const [id, part] of Array.from(reduced.entries())) {
      const row = await tx.customer_ledger.findFirst({ where: { transaction_id: id, transaction_type: 'PAYMENT_RECEIVED', reference_type: 'payment' }, select: { id: true, customer_id: true, credit: true } });
      if (!row) continue;
      customerId = row.customer_id;
      await tx.customer_ledger.update({ where: { id: row.id }, data: { credit: round2(Number(row.credit) - part) } });
    }
    if (customerId !== null) await customerLedgerService.recalculateBalancesAfter(customerId, 0, tx);
  }
  return { deallocated, paymentsRemoved };
}

/**
 * A bill lowered below what is allocated to it (owner, 2026-10-03): the allocations shrink to
 * the new total, newest first, and the money over stays with the party as advance - the
 * payments, their ledger rows and total_paid are untouched (the counters move total_allocated
 * only, in the balance handlers). A bill-specific payment left with money over becomes MIXED
 * (DIRECT if nothing is allocated any more). Returns the amount released.
 */
export async function trimAllocations(tx: any, party: Party, where: Record<string, unknown>, newTotal: number): Promise<number> {
  const t = T[party];
  const allocations = await tx[t.allocs].findMany({ where, orderBy: { id: 'desc' }, select: { id: true, payment_id: true, allocated_amount: true } });
  let excess = round2(allocations.reduce((s: number, a: any) => s + Number(a.allocated_amount), 0) - newTotal);
  if (excess <= 0.005) return 0;
  const released = excess;
  const touched = new Set<number>();
  for (const a of allocations) {
    if (excess <= 0.005) break;
    const cut = Math.min(excess, Number(a.allocated_amount));
    if (cut >= Number(a.allocated_amount) - 0.005) await tx[t.allocs].delete({ where: { id: a.id } });
    else await tx[t.allocs].update({ where: { id: a.id }, data: { allocated_amount: round2(Number(a.allocated_amount) - cut) } });
    excess = round2(excess - cut);
    touched.add(a.payment_id);
  }
  for (const id of Array.from(touched)) {
    const payment = await tx[t.payments].findUnique({ where: { id }, select: { payment_type: true } });
    if (!payment || payment.payment_type !== 'BILL_SPECIFIC') continue;
    const left = await tx[t.allocs].count({ where: { payment_id: id } });
    await tx[t.payments].update({ where: { id }, data: { payment_type: left > 0 ? 'MIXED' : 'DIRECT' } });
    await postAsPaymentRow(tx, party, id);
  }
  return released;
}

/**
 * A bill-specific payment that has just become MIXED / DIRECT (H2 = A-01, 2026-10-04): its
 * ledger row(s) were tagged to the bill(s) it paid, so deleting or unmarking a bill took the
 * row with it while the payment (now partly advance) and total_paid stayed. It now takes the
 * shape a MIXED / DIRECT payment from the payments screen has - ONE row tagged 'payment' for
 * the whole payment amount - so a later delete / unmark of a bill leaves it alone and only a
 * delete of the payment itself (by transaction_id) removes it.
 *
 * The first existing row is re-tagged in place (it keeps its id and date, so the stored running
 * balance keeps its entry order - F-02 untouched) and the payment's other rows (one per bill on
 * the vendor side) are folded into it. Customer side: a payment already has one row; only its
 * tag moves. A payment with no row carrying its id (legacy) is left as it is.
 */
async function postAsPaymentRow(tx: any, party: Party, paymentId: number): Promise<void> {
  const t = T[party];
  const payment = await tx[t.payments].findUnique({
    where: { id: paymentId },
    select: { id: true, payment_amount: true, payment_mode: true, payment_type: true, [t.partyFk]: true, allocations: { select: { allocated_amount: true } } }
  });
  if (!payment) return;
  const partyId = Number(payment[t.partyFk]);
  const amount = round2(Number(payment.payment_amount));
  const allocated = round2((payment.allocations || []).reduce((s: number, a: any) => s + Number(a.allocated_amount), 0));
  const notes = payment.payment_type === 'DIRECT'
    ? `Advance payment ₹${amount} (bill lowered, kept as advance)`
    : `Payment ₹${amount} (₹${allocated} allocated, ₹${round2(amount - allocated)} advance)`;
  if (party === 'vendor') {
    const rows = await tx.vendor_ledger.findMany({
      where: { vendor_id: partyId, transaction_id: paymentId, transaction_type: 'PAYMENT' },
      orderBy: { id: 'asc' },
      select: { id: true }
    });
    if (!rows.length) return;
    await tx.vendor_ledger.update({
      where: { id: rows[0].id },
      data: { reference_type: 'payment', reference_id: paymentId, reference_no: String(paymentId), debit: 0, credit: amount, payment_mode: payment.payment_mode, notes }
    });
    if (rows.length > 1) await tx.vendor_ledger.deleteMany({ where: { id: { in: rows.slice(1).map((r: any) => r.id) } } });
    await ledgerService.recalculateBalancesAfter(partyId, 0, tx);
  } else {
    const rows = await tx.customer_ledger.findMany({
      where: { customer_id: partyId, transaction_id: paymentId, transaction_type: 'PAYMENT_RECEIVED' },
      orderBy: { id: 'asc' },
      select: { id: true }
    });
    if (!rows.length) return;
    await tx.customer_ledger.update({
      where: { id: rows[0].id },
      data: { reference_type: 'payment', reference_id: paymentId, reference_no: `PAY-${String(paymentId).padStart(3, '0')}`, debit: 0, credit: amount, payment_mode: payment.payment_mode, notes }
    });
    if (rows.length > 1) await tx.customer_ledger.deleteMany({ where: { id: { in: rows.slice(1).map((r: any) => r.id) } } });
    await customerLedgerService.recalculateBalancesAfter(partyId, 0, tx);
  }
}

/**
 * The payment mode picked on a paid / part-paid bill's edit form (M1 = A-05 / B-03, 2026-10-04):
 * the bill's own payments follow it - the BILL_SPECIFIC payments allocated to this bill and to
 * no other (made with it), and their ledger rows (by transaction_id). A payment shared with
 * other bills, or an advance the bill used, is the payments screen's to change and is left
 * alone. Dates are not touched. Returns the ids of the payments changed.
 */
export async function setOwnPaymentsMode(tx: any, party: Party, where: Record<string, unknown>, mode: number): Promise<number[]> {
  const t = T[party];
  const allocations = await tx[t.allocs].findMany({ where, select: { payment_id: true } });
  const ids = Array.from(new Set<number>(allocations.map((a: any) => a.payment_id)));
  const changed: number[] = [];
  for (const id of ids) {
    const payment = await tx[t.payments].findUnique({ where: { id }, select: { payment_type: true, payment_mode: true } });
    if (!payment || payment.payment_type !== 'BILL_SPECIFIC' || payment.payment_mode === mode) continue;
    const all = await tx[t.allocs].findMany({ where: { payment_id: id }, select: { payment_id: true, ...Object.fromEntries(Object.keys(where).map(k => [k, true])) } });
    const own = all.every((a: any) => Object.entries(where).every(([k, v]) => a[k] === v));
    if (!own) continue;
    await tx[t.payments].update({ where: { id }, data: { payment_mode: mode } });
    if (party === 'vendor') await tx.vendor_ledger.updateMany({ where: { transaction_id: id, transaction_type: 'PAYMENT' }, data: { payment_mode: mode } });
    else await tx.customer_ledger.updateMany({ where: { transaction_id: id, transaction_type: 'PAYMENT_RECEIVED' }, data: { payment_mode: mode } });
    changed.push(id);
  }
  return changed;
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

const LOGS = {
  vendor: { table: 'vendor_balance_logs', partyFk: 'vendor_id' },
  customer: { table: 'customer_balance_logs', partyFk: 'customer_id' }
} as const;

/**
 * What a completed return added to the party's refund counters, so deleting
 * the return can take exactly that back off.
 *
 * Completing a return raises total_refunded and total_refund_allocated with no
 * refund row behind it; deleting it only reversed refund ALLOCATIONS (none),
 * so both counters stayed up forever (both sides). The amounts come from the
 * balance log rows written under the return's note number; a return older
 * than the logs falls back to its refund amount on both columns.
 */
export async function returnCounterAmounts(
  tx: any,
  party: Party,
  partyId: number,
  references: string[],
  fallback: number
): Promise<{ refunded: number; allocated: number }> {
  const l = LOGS[party];
  const refs = references.filter(Boolean);
  const rows = refs.length
    ? await tx[l.table].findMany({
        where: { [l.partyFk]: partyId, reference_no: { in: refs }, column_name: { in: ['total_refunded', 'total_refund_allocated'] } },
        select: { column_name: true, change_amount: true, source_type: true }
      })
    : [];
  if (!rows.length) return { refunded: round2(fallback), allocated: round2(fallback) };
  // Net of every row under the number, earlier reversals included: MySQL can
  // hand a deleted return's id to a new one, and the old one's rows net to 0.
  const sum = (c: string) => Math.max(0, round2(rows.filter((r: any) => r.column_name === c).reduce((s: number, r: any) => s + Number(r.change_amount), 0)));
  return { refunded: sum('total_refunded'), allocated: sum('total_refund_allocated') };
}
