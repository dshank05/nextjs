import { SaleError } from './sale';

/**
 * Checking a payment's allocations, for customers and vendors alike, on create
 * and on edit. The browser sends decisions; the server decides what is
 * allowed (§11).
 *
 * Before this:
 *  - customer create capped each allocation at the bill TOTAL, ignoring what
 *    other payments had already put on it, so a bill could be paid twice over;
 *  - vendor create ran the CUSTOMER validator, which looks for invoice ids and
 *    skipped every purchase allocation - nothing was checked at all;
 *  - edit checked nothing on either side;
 *  - the payment type was whatever the form said ('RECEIPT' by default on the
 *    customer side), while the counters, the ledger and the advance model all
 *    branch on it.
 *
 * Each allocation names its bill by kind ({ invoice_id } | { invoicex_id } for
 * customers, { purchase_id } for vendors): sale and Invoice C ids overlap.
 */
export type PaymentParty = 'customer' | 'vendor';
export type BillKind = 'sale' | 'salex' | 'purchase';
export type PaymentType = 'DIRECT' | 'BILL_SPECIFIC' | 'MIXED';

export interface CheckedAllocation {
  kind: BillKind;
  id: number;
  amount: number;
  notes: string | null;
  /** the column the allocation row stores the bill in */
  field: 'invoice_id' | 'invoicex_id' | 'purchase_id';
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const BILLS = {
  sale: { table: 'invoice', field: 'invoice_id', owner: 'select_customer', allocs: 'customer_payment_allocations', label: 'Invoice' },
  salex: { table: 'invoicex', field: 'invoicex_id', owner: 'select_customer', allocs: 'customer_payment_allocations', label: 'Invoice C' },
  purchase: { table: 'purchase', field: 'purchase_id', owner: 'vendor_id', allocs: 'payment_allocations', label: 'Bill' }
} as const;

/**
 * The type a payment is stored as. Nothing allocated: DIRECT (an advance).
 * Part allocated: MIXED. Fully allocated: BILL_SPECIFIC, unless the payment
 * is an advance (asked as MIXED or DIRECT) - an advance that has been used up
 * stays an advance, so deleting the bill does not delete the money (the same
 * rule allocateFromAdvance follows).
 */
export function derivePaymentType(requested: unknown, amount: number, allocated: number): PaymentType {
  if (allocated <= 0.005) return 'DIRECT';
  if (allocated < amount - 0.005) return 'MIXED';
  return requested === 'MIXED' || requested === 'DIRECT' ? 'MIXED' : 'BILL_SPECIFIC';
}

export async function checkPaymentAllocations(
  db: any,
  party: PaymentParty,
  partyId: number,
  amountRaw: unknown,
  raw: unknown,
  opts: { requestedType?: unknown; excludePaymentId?: number } = {}
): Promise<{ allocations: CheckedAllocation[]; allocated: number; amount: number; paymentType: PaymentType }> {
  const amount = r2(Number(amountRaw));
  if (!Number.isFinite(amount) || amount <= 0) throw new SaleError(400, 'Enter a payment amount above zero', 'VALIDATION');
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) throw new SaleError(400, 'Allocations must be a list', 'VALIDATION');

  const wanted: CheckedAllocation[] = [];
  for (const a of (raw as any[]) || []) {
    const value = Number(a?.allocated_amount);
    if (!Number.isFinite(value) || value < 0) throw new SaleError(400, 'Allocation amounts must be numbers', 'VALIDATION');
    // Below half a paisa is nothing (C-06): Auto Allocate's float residue
    // (1.1e-13) was stored as a ₹0 allocation - and a ₹0 vendor ledger row.
    if (r2(value) === 0) continue;
    let kind: BillKind;
    let id: number;
    if (party === 'vendor') {
      kind = 'purchase';
      id = parseInt(a?.purchase_id);
    } else if (a?.invoicex_id) {
      kind = 'salex';
      id = parseInt(a.invoicex_id);
      if (a?.invoice_id) throw new SaleError(400, 'An allocation names one bill: invoice_id or invoicex_id, not both', 'VALIDATION');
    } else {
      kind = 'sale';
      id = parseInt(a?.invoice_id);
    }
    if (!Number.isInteger(id) || id <= 0) {
      throw new SaleError(400, party === 'vendor' ? 'Each allocation needs its purchase_id' : 'Each allocation needs invoice_id or invoicex_id', 'VALIDATION');
    }
    if (wanted.some(w => w.kind === kind && w.id === id)) throw new SaleError(400, 'The same bill was allocated twice', 'DUPLICATE_BILL');
    wanted.push({ kind, id, amount: r2(value), notes: a?.notes || null, field: BILLS[kind].field });
  }

  const allocated = r2(wanted.reduce((s, w) => s + w.amount, 0));
  if (allocated > amount + 0.005) {
    throw new SaleError(400, `Allocated ₹${allocated} is more than the payment of ₹${amount}`, 'OVER_ALLOCATED');
  }

  for (const w of wanted) {
    const b = BILLS[w.kind];
    const bill = await db[b.table].findUnique({ where: { id: w.id }, select: { id: true, invoice_no: true, total: true, [b.owner]: true } });
    if (!bill) throw new SaleError(400, `${b.label} ${w.id} not found`, 'UNKNOWN_BILL');
    if ((bill[b.owner] ?? null) !== partyId) {
      throw new SaleError(400, `${b.label} ${bill.invoice_no} is not this ${party}'s`, 'FOREIGN_BILL');
    }
    const others = await db[b.allocs].findMany({
      where: { [b.field]: w.id, ...(opts.excludePaymentId ? { NOT: { payment_id: opts.excludePaymentId } } : {}) },
      select: { allocated_amount: true }
    });
    const paid = r2(others.reduce((s: number, o: any) => s + Number(o.allocated_amount), 0));
    const open = r2(Number(bill.total || 0) - paid);
    if (w.amount > open + 0.005) {
      throw new SaleError(400, `${b.label} ${bill.invoice_no} has ₹${Math.max(0, open)} left to pay; ₹${w.amount} was allocated`, 'OVER_BILL',
        { bill: bill.invoice_no, outstanding: Math.max(0, open), requested: w.amount });
    }
  }

  return { allocations: wanted, allocated, amount, paymentType: derivePaymentType(opts.requestedType, amount, allocated) };
}

/** The allocation row columns for a checked allocation. */
export const allocationRow = (paymentId: number, a: CheckedAllocation, date: number) => ({
  payment_id: paymentId,
  ...(a.kind === 'purchase'
    ? { purchase_id: a.id }
    : { invoice_id: a.kind === 'sale' ? a.id : null, invoicex_id: a.kind === 'salex' ? a.id : null }),
  allocated_amount: a.amount,
  allocation_date: date,
  notes: a.notes
});
