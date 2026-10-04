// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { store } from '../support/dbstub.js';
import { customerTransactionHandler as h } from '../../../lib/customer-transaction-handler';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const reset = () => {
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(store, {
    customer_details: [
      { id: 1, total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 },
      { id: 2, total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }],
    invoice: [{ id: 5, invoice_no: 5, select_customer: 1, total: 100, payment_status: 1 }],
    invoicex: [{ id: 5, invoice_no: 9, select_customer: 2, total: 50, payment_status: 0 }],
    customer_ledger: [
      { id: 1, customer_id: 1, transaction_type: 'SALE', reference_type: 'sale', reference_id: 5, debit: 100, credit: 0, balance: 100 },
      { id: 2, customer_id: 1, transaction_type: 'PAYMENT_RECEIVED', reference_type: 'sale', reference_id: 5, debit: 0, credit: 100, balance: 0, transaction_id: 70 },
      { id: 3, customer_id: 2, transaction_type: 'SALE', reference_type: 'salex', reference_id: 5, debit: 50, credit: 0, balance: 50 }],
    customer_payments: [{ id: 70, customer_id: 1, payment_amount: 100, payment_type: 'BILL_SPECIFIC' }],
    customer_payment_allocations: [{ id: 1, payment_id: 70, invoice_id: 5, invoicex_id: null, allocated_amount: 100 }],
    customer_balance_logs: [],
  });
};
const edit = async (p) => { const ops = await h.handleSaleEdit({ fy: 4, invoiceNo: '9', paymentMode: 1, paymentDate: 2000,
  currentBalance: { total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }, ...p }); await h.executeInTransaction(store.__tx || require_tx(), ops); return ops; };
import { prisma } from '../support/dbstub.js';
const require_tx = () => prisma;
const saleRows = () => store.customer_ledger.filter(r => r.reference_type === 'sale');
test('sale numbering and walk-in', async () => {
  // SA-01: salex 0->1 must allocate to invoicex 5 and write a salex-labelled credit
  reset();
  await edit({ type: 'salex', oldStatus: 0, newStatus: 1, oldTotal: 50, newTotal: 50, customerId: 2, invoiceId: 5 });
  const a = store.customer_payment_allocations.filter(x => x.id !== 1);
  ok('salex paid: allocation on invoicex, not invoice', a.length === 1 && a[0].invoicex_id === 5 && !a[0].invoice_id, a);
  const pay = store.customer_ledger.find(r => r.customer_id === 2 && r.transaction_type === 'PAYMENT_RECEIVED');
  ok('salex paid: PAYMENT_RECEIVED labelled salex', pay && pay.reference_type === 'salex', pay);
  ok('salex paid: payment is a credit (SA-34)', pay && pay.credit === 50 && pay.debit === 0, pay);
  ok('sale rows of customer 1 untouched', saleRows().length === 2 && saleRows()[0].debit === 100, saleRows());

  // SA-01: salex amount change updates the salex row only
  reset();
  await edit({ type: 'salex', oldStatus: 0, newStatus: 0, oldTotal: 50, newTotal: 60, customerId: 2, invoiceId: 5 });
  ok('salex amount: salex SALE row = 60', store.customer_ledger.find(r => r.id === 3).debit === 60, store.customer_ledger);
  ok('salex amount: sale SALE row still 100', store.customer_ledger.find(r => r.id === 1).debit === 100);

  // SA-02: sale 1->0 removes the sale's allocation (and only the sale's)
  reset();
  store.customer_payment_allocations.push({ id: 2, payment_id: 71, invoice_id: null, invoicex_id: 5, allocated_amount: 50 });
  store.customer_payments.push({ id: 71, customer_id: 2, payment_amount: 50 });
  await edit({ type: 'sale', oldStatus: 1, newStatus: 0, oldTotal: 100, newTotal: 100, customerId: 1, invoiceId: 5, hasPaymentLedger: true, isTypeA: true, totalAllocated: 100 });
  ok('sale unmark: its allocation removed', !store.customer_payment_allocations.some(x => x.invoice_id === 5), store.customer_payment_allocations);
  ok('sale unmark: salex allocation kept', store.customer_payment_allocations.some(x => x.invoicex_id === 5));
  ok('sale unmark: orphan payment row removed', !store.customer_payments.some(p => p.id === 70), store.customer_payments);
  ok('sale unmark: PAYMENT_RECEIVED gone', !store.customer_ledger.some(r => r.id === 2), store.customer_ledger);

  // SA-03: payment / refund edits write the right column
  const pe = await h.handleCustomerPaymentEdit({ paymentId: 70, customerId: 1, oldAmount: 100, newAmount: 80, oldAllocations: [], newAllocations: [], paymentMode: 1, paymentDate: 1, paymentType: 'DIRECT', fy: 4 });
  ok('payment edit writes credit', pe.ledgerUpdates[0].data.credit === 80 && pe.ledgerUpdates[0].data.debit === undefined, pe.ledgerUpdates);
  const re = await h.handleCustomerRefundEdit({ refundId: 3, customerId: 1, oldAmount: 10, newAmount: 20, oldAllocations: [], newAllocations: [], refundMode: 1, refundDate: 1, refundType: 'DIRECT', fy: 4 });
  ok('refund edit writes debit', re.ledgerUpdates[0].data.debit === 20 && re.ledgerUpdates[0].data.credit === undefined, re.ledgerUpdates);

  // a ChangeSet without a type is refused rather than guessed
  let threw = false; try { await h.handleSaleEdit({ oldStatus: 0, newStatus: 0, oldTotal: 1, newTotal: 2, customerId: 1, invoiceId: 5, fy: 4, invoiceNo: '1' }); } catch { threw = true; }
  ok('missing type refused', threw);
  expect(FAILED).toEqual([]);
}, 170000);
