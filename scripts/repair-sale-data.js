/**
 * Repairs the data left behind by the Phase 5 Block 0 bugs (docs/SALE_AUDIT.md).
 *
 *   node scripts/repair-sale-data.js              dry run - prints what it would do
 *   node scripts/repair-sale-data.js --apply      fixes 1 and 2 (no renumbering)
 *   node scripts/repair-sale-data.js --apply --renumber
 *                                                 also renumbers colliding sales
 *
 * 1. SA-04 - sales stamped with the calendar year as `fy`.
 *    The form sent new Date().getFullYear() (2026) and the API stored it. `fy`
 *    is a financial_year id. Each such sale gets the fy its own lines carry
 *    (the server always stamped lines with the real current FY); failing that,
 *    the financial year whose dates contain the invoice date.
 *    Because the counter never saw these sales, a real-fy sale may already hold
 *    the same number. Those are listed. With --renumber the LATER one (higher
 *    id) takes the next free number in that year, and its ledger rows'
 *    reference_no follow. Renumbering changes a printed number - only do it if
 *    the duplicate has not been sent to the customer, or reissue it.
 *
 * 2. SA-03 / SA-34 - customer ledger rows in the wrong column.
 *    PAYMENT_RECEIVED is a credit and REFUND a debit everywhere they are
 *    created; marking a bill paid through an edit, and editing a payment or
 *    refund amount, wrote the opposite column. Each wrong row is moved to the
 *    right column (an edited row holds the new amount in the wrong column and
 *    the stale one in the right column; the new amount wins). Running
 *    balances are then recomputed for every customer touched.
 *
 * 3. Report only - things that need a person:
 *    - SA-01: ledger rows / allocations that point at a sale owned by a
 *      different customer (salex edits wrote into the sale with the same id)
 *    - SA-02: payment allocations still attached to bills marked Unpaid
 *
 * Safe to run more than once. Run on the test database first; back up before
 * running on live.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const RENUMBER = process.argv.includes('--renumber');
const q = (sql, ...p) => prisma.$queryRawUnsafe(sql, ...p);
const x = (sql, ...p) => (APPLY ? prisma.$executeRawUnsafe(sql, ...p) : Promise.resolve(0));
const n = (v) => Number(v || 0);
const step = (s) => console.log(`\n== ${s}`);

async function fyForDate(ts, years) {
  const d = new Date(Number(ts) * 1000);
  const hit = years.find(y => y.start_date && y.end_date &&
    d >= new Date(y.start_date) && d <= new Date(new Date(y.end_date).getTime() + 86399999));
  return hit ? hit.id : null;
}

async function recalcCustomer(customerId) {
  const rows = await q('SELECT id, debit, credit FROM customer_ledger WHERE customer_id = ? ORDER BY id ASC', customerId);
  let running = 0;
  for (const r of rows) {
    running = running + n(r.debit) - n(r.credit);
    await x('UPDATE customer_ledger SET balance = ? WHERE id = ?', running, r.id);
  }
  return running;
}

(async () => {
  const db = (await q('SELECT DATABASE() AS d'))[0].d;
  console.log(`Database: ${db}   mode: ${APPLY ? 'APPLY' : 'dry run'}${RENUMBER ? ' + renumber' : ''}`);

  // ------------------------------------------------------------------ 1
  step('1. SA-04 - sales whose fy is not a financial_year id');
  const years = await q('SELECT id, fy, start_date, end_date FROM financial_year');
  const ids = new Set(years.map(y => Number(y.id)));
  const bad = (await q('SELECT id, invoice_no, fy, invoice_date FROM invoice ORDER BY id ASC'))
    .filter(r => !ids.has(Number(r.fy)));
  console.log(`  ${bad.length} sale(s) to fix`);

  const unresolved = [];
  for (const s of bad) {
    const lineFy = await q('SELECT fy, COUNT(*) AS c FROM invoice_items WHERE invoice_no = ? GROUP BY fy ORDER BY c DESC', s.id);
    let target = lineFy.map(r => Number(r.fy)).find(f => ids.has(f)) ?? null;
    if (target === null) target = await fyForDate(s.invoice_date, years);
    if (target === null) { unresolved.push(s); continue; }

    const clash = await q('SELECT id, invoice_no FROM invoice WHERE fy = ? AND invoice_no = ? AND id <> ?', target, s.invoice_no, s.id);
    console.log(`  sale id ${s.id} #${s.invoice_no}: fy ${s.fy} -> ${target}${clash.length ? `  CLASHES with sale id ${clash.map(c => c.id).join(', ')}` : ''}`);
    await x('UPDATE invoice SET fy = ? WHERE id = ?', target, s.id);

    if (clash.length) {
      // The later sale (higher id) gives up the number.
      const loser = Math.max(s.id, ...clash.map(c => Number(c.id)));
      if (RENUMBER) {
        const max = await q('SELECT COALESCE(MAX(invoice_no), 0) AS m FROM invoice WHERE fy = ?', target);
        const next = n(max[0].m) + 1;
        console.log(`    renumber sale id ${loser} -> #${next}`);
        await x('UPDATE invoice SET invoice_no = ? WHERE id = ?', next, loser);
        await x(`UPDATE customer_ledger SET reference_no = ? WHERE reference_type = 'sale' AND reference_id = ?`, String(next), loser);
      } else {
        console.log(`    sale id ${loser} needs a new number (rerun with --renumber)`);
      }
    }
  }
  if (unresolved.length) {
    console.log(`  ${unresolved.length} sale(s) could not be placed in a year - set them by hand:`);
    unresolved.forEach(s => console.log(`    id ${s.id} #${s.invoice_no} fy ${s.fy} date ${new Date(Number(s.invoice_date) * 1000).toISOString().slice(0, 10)}`));
  }

  // ------------------------------------------------------------------ 2
  step('2. SA-03 / SA-34 - ledger rows in the wrong column');
  const wrongPay = await q(`SELECT id, customer_id, debit, credit, reference_type, reference_id FROM customer_ledger
                            WHERE transaction_type = 'PAYMENT_RECEIVED' AND debit > 0`);
  const wrongRef = await q(`SELECT id, customer_id, debit, credit, reference_type, reference_id FROM customer_ledger
                            WHERE transaction_type = 'REFUND' AND credit > 0`);
  console.log(`  ${wrongPay.length} PAYMENT_RECEIVED row(s) carrying a debit, ${wrongRef.length} REFUND row(s) carrying a credit`);
  const touched = new Set();
  for (const r of wrongPay) {
    console.log(`  ledger ${r.id} (customer ${r.customer_id}, ${r.reference_type} ${r.reference_id}): debit ${n(r.debit)} credit ${n(r.credit)} -> credit ${n(r.debit)}`);
    await x('UPDATE customer_ledger SET credit = debit, debit = 0 WHERE id = ?', r.id);
    touched.add(Number(r.customer_id));
  }
  for (const r of wrongRef) {
    console.log(`  ledger ${r.id} (customer ${r.customer_id}): debit ${n(r.debit)} credit ${n(r.credit)} -> debit ${n(r.credit)}`);
    await x('UPDATE customer_ledger SET debit = credit, credit = 0 WHERE id = ?', r.id);
    touched.add(Number(r.customer_id));
  }
  for (const c of Array.from(touched)) {
    const bal = await recalcCustomer(c);
    console.log(`  customer ${c}: balances recomputed${APPLY ? `, closing ${bal.toFixed(2)}` : ''}`);
  }

  // ------------------------------------------------------------------ 3
  step('3. Report only');
  const crossLedger = await q(`SELECT l.id, l.customer_id, l.transaction_type, l.reference_id, i.select_customer
                               FROM customer_ledger l JOIN invoice i ON i.id = l.reference_id
                               WHERE l.reference_type = 'sale' AND i.select_customer <> l.customer_id`);
  console.log(`  SA-01 ledger rows on a sale of another customer: ${crossLedger.length}`);
  crossLedger.slice(0, 50).forEach(r => console.log(`    ledger ${r.id} ${r.transaction_type}: customer ${r.customer_id}, sale id ${r.reference_id} belongs to ${r.select_customer}`));

  const crossAlloc = await q(`SELECT a.id, a.invoice_id, p.customer_id, i.select_customer, a.allocated_amount
                              FROM customer_payment_allocations a
                              JOIN customer_payments p ON p.id = a.payment_id
                              JOIN invoice i ON i.id = a.invoice_id
                              WHERE i.select_customer <> p.customer_id`);
  console.log(`  SA-01 allocations to a sale of another customer: ${crossAlloc.length}`);
  crossAlloc.slice(0, 50).forEach(r => console.log(`    allocation ${r.id}: payment of customer ${r.customer_id} on sale id ${r.invoice_id} (customer ${r.select_customer}), ${n(r.allocated_amount)}`));

  for (const [table, col] of [['invoice', 'invoice_id'], ['invoicex', 'invoicex_id']]) {
    const left = await q(`SELECT d.id, d.invoice_no, SUM(a.allocated_amount) AS amt FROM ${table} d
                          JOIN customer_payment_allocations a ON a.${col} = d.id
                          WHERE d.payment_status = 0 GROUP BY d.id, d.invoice_no`);
    console.log(`  SA-02 ${table} marked Unpaid but still allocated: ${left.length}`);
    left.slice(0, 50).forEach(r => console.log(`    ${table} id ${r.id} #${r.invoice_no}: ${n(r.amt)} allocated`));
  }

  console.log(APPLY ? '\nDone.' : '\nDry run - nothing changed. Rerun with --apply.');
})()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
