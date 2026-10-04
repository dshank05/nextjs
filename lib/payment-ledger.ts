import { ledgerService } from './ledger-service'
import { customerLedgerService } from './customer-ledger-service'

/**
 * A payment's / refund's ledger rows, rebuilt from the document as it now
 * stands (2026-10-04, review C: C-01, C-03, C-04, C-05).
 *
 * The edit routes used to patch the rows: an amount change wrote the new
 * amount on EVERY row of the payment (a vendor Bill Specific payment has one
 * row per bill, so the ledger counted it once per bill - C-01), an allocation
 * change never moved a row off the bill it no longer pays (C-03), and the mode
 * and notes never reached the rows at all (C-04, C-05).
 *
 * Here the rows are worked out from the document, its allocations and the
 * per-party conventions, exactly as the create routes post them:
 *  - vendor payment: BILL_SPECIFIC -> one PAYMENT row per allocated bill
 *    (reference 'purchase', the bill's share, the bill's status); MIXED /
 *    DIRECT -> one PAYMENT row tagged 'payment' for the whole amount;
 *  - customer payment: one PAYMENT_RECEIVED row for the whole amount, tagged
 *    'payment' - or still with its bill when it is that bill's own payment
 *    (Bill Specific, one allocation, to the bill the row names);
 *  - vendor refund: one REFUND_RECEIVED row per (legacy) return allocation
 *    and one tagged 'payment' for what is not allocated;
 *  - customer refund: one REFUND_PAID row tagged 'refund' for the amount.
 * Existing rows are reused (same id, so the ledger order and a note typed on
 * the ledger screen survive), extra rows are deleted, missing ones created,
 * and the running balance is rebuilt from the start when an amount moved or a
 * row went (new rows are appended from the latest balance, as on create).
 *
 * Call it inside the transaction, AFTER the document, its allocations and the
 * statuses of its bills / returns are written: it reads them back.
 *
 * Notes on the rows: a note typed on the ledger screen (one that is neither
 * the document's old notes nor text the app generates) is kept. Otherwise the
 * row follows the document's notes when they change, and generated text is
 * regenerated when the row's amount or bill changes.
 */

export interface LedgerRebuildOptions {
  /** the document's notes before the edit (to tell a ledger-screen note from the document's) */
  oldNotes?: string | null
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const blank = (s: unknown) => (typeof s === 'string' ? s.trim() : '') === ''
const text = (s: unknown) => (typeof s === 'string' ? s : '')

/** Text the app writes itself on payment / refund rows (create, edit, bill create). */
const GENERATED = /^(Payment ₹|Direct advance payment ₹|Payment #\d+ updated to|Refund #\d+ updated to|Direct refund received ₹|Refund received ₹|Unallocated refund received ₹|Customer payment receipt$|Customer refund payment$)/

interface Wanted {
  reference_type: string
  reference_id: number
  reference_no: string
  amount: number
  payment_status: number | null
  generated: string
}

interface Doc {
  partyId: number
  date: number
  mode: number | null
  notes: string | null
  fy: number
}

type Side = 'vendor' | 'customer'

/**
 * Bring `existing` rows in line with `wanted`. `amountCol` is the column the
 * money sits in (credit for payments, debit for refunds).
 */
async function reconcile(
  tx: any,
  side: Side,
  doc: Doc,
  existing: any[],
  wanted: Wanted[],
  amountCol: 'credit' | 'debit',
  base: { transaction_type: string; transaction_id: number },
  opts: LedgerRebuildOptions
): Promise<boolean> {
  const table = side === 'vendor' ? tx.vendor_ledger : tx.customer_ledger
  const otherCol = amountCol === 'credit' ? 'debit' : 'credit'
  const notesChanged = opts.oldNotes !== undefined && text(opts.oldNotes) !== text(doc.notes)
  const pairs: Array<[any | null, Wanted]> = []
  const free = [...existing].sort((a, b) => a.id - b.id)

  // Same bill / return first, then any row left over (it moves), then new rows.
  const left: Wanted[] = []
  for (const w of wanted) {
    const i = free.findIndex(r => r.reference_type === w.reference_type && Number(r.reference_id) === w.reference_id)
    if (i >= 0) pairs.push([free.splice(i, 1)[0], w])
    else left.push(w)
  }
  for (const w of left) pairs.push([free.length ? free.shift() : null, w])

  const noteFor = (row: any | null, w: Wanted): string => {
    const own = blank(doc.notes) ? w.generated : (doc.notes as string)
    if (!row) return own
    const typed = !blank(row.notes) && !GENERATED.test(row.notes) && text(row.notes) !== text(opts.oldNotes ?? doc.notes)
    if (typed) return row.notes                                   // a ledger-screen remark (or the "Other" vendor's name)
    const moved = r2(Number(row[amountCol])) !== w.amount || row.reference_type !== w.reference_type || Number(row.reference_id) !== w.reference_id
    if (notesChanged) return own
    if (moved && (blank(row.notes) || GENERATED.test(row.notes))) return own
    return row.notes
  }

  // Rows kept: updated in place. Then rows no longer wanted go. The running
  // balance is rebuilt from the start only when an amount moved or a row went;
  // new rows come last, each from the latest (now right) balance, as on create.
  let changed = false
  let rebalance = false
  const creates: Array<[string, Wanted]> = []
  for (const [row, w] of pairs) {
    const notes = noteFor(row, w)
    if (!row) { creates.push([notes, w]); continue }
    const data: any = {}
    const set = (k: string, v: any, same: (a: any, b: any) => boolean = (a, b) => a === b) => { if (!same(row[k], v)) data[k] = v }
    const sameMoney = (a: any, b: any) => r2(Number(a || 0)) === r2(Number(b || 0))
    set(amountCol, w.amount, sameMoney)
    set(otherCol, 0, sameMoney)
    if (amountCol in data || otherCol in data) rebalance = true
    set('reference_type', w.reference_type)
    set('reference_id', w.reference_id, (a, b) => Number(a) === b)
    set('reference_no', w.reference_no)
    set('transaction_date', doc.date)
    set('payment_date', doc.date)
    if (doc.mode !== null && doc.mode !== undefined) set('payment_mode', doc.mode)
    if (w.payment_status !== null) set('payment_status', w.payment_status)
    set('notes', notes)
    if (Object.keys(data).length) {
      await table.update({ where: { id: row.id }, data })
      changed = true
    }
  }
  for (const row of free) {
    await table.delete({ where: { id: row.id } })
    changed = rebalance = true
  }
  if (rebalance) {
    if (side === 'vendor') await ledgerService.recalculateBalancesAfter(doc.partyId, 0, tx)
    else await customerLedgerService.recalculateBalancesAfter(doc.partyId, 0, tx)
  }
  for (const [notes, w] of creates) {
    const entry: any = {
      [side === 'vendor' ? 'vendor_id' : 'customer_id']: doc.partyId,
      transaction_date: doc.date,
      transaction_type: base.transaction_type,
      reference_type: w.reference_type,
      reference_id: w.reference_id,
      reference_no: w.reference_no,
      payment_mode: doc.mode ?? undefined,
      payment_status: w.payment_status ?? undefined,
      payment_date: doc.date,
      [amountCol]: w.amount,
      [otherCol]: 0,
      notes,
      fy: doc.fy,
      transaction_id: base.transaction_id
    }
    if (side === 'vendor') await ledgerService.createEntry(entry, tx)
    else await customerLedgerService.createEntry(entry, tx)
    changed = true
  }
  return changed
}

const docOf = (partyId: number, d: any, prefix: 'payment' | 'refund'): Doc => ({
  partyId,
  date: d[`${prefix}_date`],
  mode: d[`${prefix}_mode`] === null || d[`${prefix}_mode`] === undefined ? null : Number(d[`${prefix}_mode`]),
  notes: d.notes ?? null,
  fy: d.fy
})

/**
 * A vendor payment's PAYMENT rows from the payment and its allocations
 * (per bill for BILL_SPECIFIC, one row tagged 'payment' otherwise). Returns
 * whether any row changed. Also the tool for a payment whose type changed
 * elsewhere (a lowered bill turning its payment MIXED).
 */
export async function rebuildVendorPaymentLedger(tx: any, paymentId: number, opts: LedgerRebuildOptions = {}): Promise<boolean> {
  const p = await tx.vendor_payments.findUnique({ where: { id: paymentId } })
  if (!p) return false
  const allocs = (await tx.payment_allocations.findMany({ where: { payment_id: paymentId }, orderBy: { id: 'asc' } }))
    .filter((a: any) => r2(Number(a.allocated_amount)) > 0)
  const amount = r2(Number(p.payment_amount))
  const allocated = r2(allocs.reduce((s: number, a: any) => s + Number(a.allocated_amount), 0))
  const wanted: Wanted[] = []
  if (p.payment_type === 'BILL_SPECIFIC' && allocs.length) {
    for (const a of allocs) {
      const bill = await tx.purchase.findUnique({ where: { id: a.purchase_id }, select: { id: true, invoice_no: true, payment_status: true } })
      const share = r2(Number(a.allocated_amount))
      const status = bill?.payment_status ?? null
      wanted.push({
        reference_type: 'purchase',
        reference_id: a.purchase_id,
        reference_no: String(bill?.invoice_no ?? a.purchase_id),
        amount: share,
        payment_status: status,
        generated: `Payment ₹${share} for bill INV-${bill?.invoice_no ?? a.purchase_id} via Payment #${paymentId}${status === 2 ? ' (Partial)' : ''}`
      })
    }
  } else {
    wanted.push({
      reference_type: 'payment',
      reference_id: paymentId,
      reference_no: String(paymentId),
      amount,
      payment_status: null,
      generated: allocated > 0
        ? `Payment ₹${amount} (₹${allocated} allocated, ₹${r2(amount - allocated)} advance)`
        : `Direct advance payment ₹${amount}`
    })
  }
  const existing = await tx.vendor_ledger.findMany({ where: { transaction_id: paymentId, transaction_type: 'PAYMENT' }, orderBy: { id: 'asc' } })
  return reconcile(tx, 'vendor', docOf(p.vendor_id, p, 'payment'), existing, wanted, 'credit',
    { transaction_type: 'PAYMENT', transaction_id: paymentId }, opts)
}

/**
 * A customer payment's PAYMENT_RECEIVED row: one, for the whole amount. It
 * stays tagged with its bill only while it is that bill's own payment.
 */
export async function rebuildCustomerPaymentLedger(tx: any, paymentId: number, opts: LedgerRebuildOptions = {}): Promise<boolean> {
  const p = await tx.customer_payments.findUnique({ where: { id: paymentId } })
  if (!p) return false
  const allocs = (await tx.customer_payment_allocations.findMany({ where: { payment_id: paymentId }, orderBy: { id: 'asc' } }))
    .filter((a: any) => r2(Number(a.allocated_amount)) > 0)
  const existing = await tx.customer_ledger.findMany({ where: { transaction_id: paymentId, transaction_type: 'PAYMENT_RECEIVED' }, orderBy: { id: 'asc' } })
  const amount = r2(Number(p.payment_amount))
  const tagged = existing.find((r: any) => r.reference_type === 'sale' || r.reference_type === 'salex')
  const only = allocs.length === 1 ? allocs[0] : null
  const ownBill = tagged && only && p.payment_type === 'BILL_SPECIFIC' &&
    (tagged.reference_type === 'sale' ? only.invoice_id : only.invoicex_id) === Number(tagged.reference_id)
  const wanted: Wanted = ownBill
    ? {
        reference_type: tagged.reference_type,
        reference_id: Number(tagged.reference_id),
        reference_no: tagged.reference_no,
        amount,
        payment_status: 1,
        generated: `Payment ₹${amount} for ${tagged.reference_type} INV-${tagged.reference_no} via Payment #${paymentId}`
      }
    : {
        reference_type: 'payment',
        reference_id: paymentId,
        reference_no: `PAY-${String(paymentId).padStart(3, '0')}`,
        amount,
        payment_status: 1,
        generated: 'Customer payment receipt'
      }
  return reconcile(tx, 'customer', docOf(p.customer_id, p, 'payment'), existing, [wanted], 'credit',
    { transaction_type: 'PAYMENT_RECEIVED', transaction_id: paymentId }, opts)
}

/**
 * A vendor refund's REFUND_RECEIVED rows: one per (legacy) return allocation
 * for its share, and one tagged 'payment' for what is not allocated.
 */
export async function rebuildVendorRefundLedger(tx: any, refundId: number, opts: LedgerRebuildOptions = {}): Promise<boolean> {
  const f = await tx.vendor_refunds.findUnique({ where: { id: refundId } })
  if (!f) return false
  const allocs = (await tx.refund_allocations.findMany({ where: { refund_id: refundId }, orderBy: { id: 'asc' } }))
    .filter((a: any) => r2(Number(a.allocated_amount)) > 0)
  const amount = r2(Number(f.refund_amount))
  const wanted: Wanted[] = []
  for (const a of allocs) {
    const ret = await tx.purchase_returns.findUnique({ where: { id: a.return_id }, select: { id: true, debit_note_no: true, payment_status: true } })
    const share = r2(Number(a.allocated_amount))
    const status = ret?.payment_status ?? null
    wanted.push({
      reference_type: 'purchase_return',
      reference_id: a.return_id,
      reference_no: ret?.debit_note_no ?? String(a.return_id),
      amount: share,
      payment_status: status,
      generated: `Refund received ₹${share} for return ${ret?.debit_note_no ?? a.return_id} via Refund #${refundId}${status === 2 ? ' (Partial)' : ''}`
    })
  }
  const rest = r2(amount - wanted.reduce((s, w) => s + w.amount, 0))
  if (rest > 0.005) {
    wanted.push({
      reference_type: 'payment',
      reference_id: refundId,
      reference_no: String(refundId),
      amount: rest,
      payment_status: null,
      generated: allocs.length ? `Unallocated refund received ₹${rest} (from Refund #${refundId})` : `Direct refund received ₹${amount}`
    })
  }
  const existing = await tx.vendor_ledger.findMany({ where: { transaction_id: refundId, transaction_type: 'REFUND_RECEIVED' }, orderBy: { id: 'asc' } })
  return reconcile(tx, 'vendor', docOf(f.vendor_id, f, 'refund'), existing, wanted, 'debit',
    { transaction_type: 'REFUND_RECEIVED', transaction_id: refundId }, opts)
}

/** A customer refund's REFUND_PAID row: one, tagged 'refund', for the amount. */
export async function rebuildCustomerRefundLedger(tx: any, refundId: number, opts: LedgerRebuildOptions = {}): Promise<boolean> {
  const f = await tx.customer_refunds.findUnique({ where: { id: refundId } })
  if (!f) return false
  const existing = await tx.customer_ledger.findMany({
    where: { transaction_id: refundId, reference_type: 'refund', transaction_type: { in: ['REFUND_PAID', 'REFUND'] } },
    orderBy: { id: 'asc' }
  })
  const amount = r2(Number(f.refund_amount))
  return reconcile(tx, 'customer', docOf(f.customer_id, f, 'refund'), existing, [{
    reference_type: 'refund',
    reference_id: refundId,
    reference_no: `REF-${String(refundId).padStart(3, '0')}`,
    amount,
    payment_status: 1,
    generated: 'Customer refund payment'
  }], 'debit', { transaction_type: 'REFUND_PAID', transaction_id: refundId }, opts)
}
