/**
 * Reconciliation assertions (Phase 4; A7-A11 added 2026-10-03 for the
 * customer side, sale payments, returns, payments / refunds, dead stock and
 * the party masters; A12-A14 the same day: documents to ledger, ledger to
 * documents, balance logs; A15-A16 on 2026-10-04: each payment / refund to its
 * own ledger rows, the allocation counters to the allocations).
 *
 * Run after EVERY step. These are the definition of "the step was clean".
 * Read-only: this script never writes.
 *
 *   node scripts/audit-assert.js            all assertions
 *   node scripts/audit-assert.js A1 A4      only those
 *
 * Exit code 0 if everything passed, 1 otherwise, so it can gate a commit.
 * require('./audit-assert').run(ids, { quiet }) returns the results instead.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TOL = 0.01;
// Half a paisa: a 0.01 payment is a real part payment (A3 / A8), not rounding noise.
const PAISA = 0.005;
const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const money = (v) => num(v).toFixed(2);
const near = (a, b) => Math.abs(num(a) - num(b)) <= TOL;

const results = [];
const QUIET = { on: false };
const say = (...a) => { if (!QUIET.on) console.log(...a); };
function report(id, title, failures, checked) {
  results.push({ id, title, failures, checked });
  if (QUIET.on) return;
  // An assertion that examined nothing has not passed - it has abstained (L-38).
  // Every Phase 4 suite cleans up after itself, so the baseline holds zero
  // ledger rows and A2/A3/A4 were quietly reporting PASS over an empty set.
  // That is why L-36 - a purchase edit corrupting the ledger balance - survived
  // four green suites. The twin harness already draws this distinction for a
  // transition that emits nothing; the assertions need it too.
  const head = failures.length > 0 ? 'FAIL' : checked === 0 ? 'EMPTY' : 'PASS';
  console.log(`\n[${head}] ${id} — ${title}   (${checked} checked, ${failures.length} failing)`);
  for (const f of failures.slice(0, 15)) console.log('        ' + f);
  if (failures.length > 15) console.log(`        ... and ${failures.length - 15} more`);
}

/* ------------------------------------------------------------------ A1 */
/** product.stock must equal opening_stock plus every movement against it. */
async function A1() {
  const rows = await prisma.$queryRaw`
    SELECT p.id, p.product_name, p.stock, p.opening_stock,
      COALESCE((SELECT SUM(pi.qty) FROM purchase_items pi WHERE pi.product_id = p.id), 0)      AS purchased,
      COALESCE((SELECT SUM(ii.qty) FROM invoice_items ii WHERE ii.product_id = p.id), 0)       AS sold,
      COALESCE((SELECT SUM(ix.qty) FROM invoice_itemsx ix WHERE ix.product_id = p.id), 0)      AS soldx,
      COALESCE((SELECT SUM(d.quantity) FROM deadstock d WHERE d.product_id = p.id), 0)         AS dead,
      COALESCE((SELECT SUM(sri.return_qty) FROM sale_return_items sri
                JOIN invoice_items ii2 ON ii2.id = sri.invoice_item_id
                WHERE ii2.product_id = p.id), 0)                                               AS ret_sale,
      COALESCE((SELECT SUM(xri.return_qty) FROM salex_return_items xri
                JOIN invoice_itemsx ix2 ON ix2.id = xri.invoice_itemx_id
                WHERE ix2.product_id = p.id), 0)                                               AS ret_salex,
      COALESCE((SELECT SUM(pri.return_qty) FROM purchase_return_items pri
                JOIN purchase_items pi2 ON pi2.id = pri.purchase_item_id
                WHERE pi2.product_id = p.id), 0)                                               AS ret_purchase
    FROM product p`;

  const failures = [];
  for (const r of rows) {
    const expected =
      num(r.opening_stock) + num(r.purchased) - num(r.sold) - num(r.soldx) - num(r.dead) +
      num(r.ret_sale) + num(r.ret_salex) - num(r.ret_purchase);
    if (!near(r.stock, expected)) {
      failures.push(
        `product ${r.id} "${String(r.product_name).trim().slice(0, 40)}": stock=${num(r.stock)} expected=${expected} ` +
        `(open ${num(r.opening_stock)} +buy ${num(r.purchased)} -sell ${num(r.sold)} -sellx ${num(r.soldx)} ` +
        `-dead ${num(r.dead)} +retS ${num(r.ret_sale)} +retX ${num(r.ret_salex)} -retP ${num(r.ret_purchase)})`
      );
    }
  }
  report('A1', 'product.stock reconciles to its movements', failures, rows.length);
}

/* ------------------------------------------------------------------ A2 */
/**
 * The vendor ledger's stored running balance must match a DATE-ORDERED
 * recomputation, and vendor_details.account_balance must agree with its own
 * component columns.
 *
 * Date-ordered rather than insertion-ordered is the whole point: the stored
 * balance is computed from the previous row by id (F-02), so a backdated entry
 * makes the stored column meaningless. This assertion is what detects that.
 */
async function A2() {
  const vendors = await prisma.vendor_details.findMany({
    select: {
      id: true, vendor_name: true, account_balance: true,
      total_paid: true, total_allocated: true,
      total_refunded: true, total_refund_allocated: true
    }
  });
  const failures = [];
  let checked = 0;

  for (const v of vendors) {
    const entries = await prisma.vendor_ledger.findMany({
      where: { vendor_id: v.id },
      orderBy: [{ transaction_date: 'asc' }, { id: 'asc' }],
      select: { id: true, transaction_date: true, transaction_type: true, debit: true, credit: true, balance: true }
    });
    if (entries.length === 0) continue;
    checked++;

    let running = 0;
    for (const e of entries) {
      running += num(e.debit) - num(e.credit);
      if (!near(e.balance, running)) {
        failures.push(
          `vendor ${v.id} ledger row ${e.id} (${e.transaction_type}): stored balance=${money(e.balance)} ` +
          `date-ordered=${money(running)}`
        );
      }
    }
    // NOTE (L-37). This used to compare account_balance against the ledger's
    // closing balance. They are different quantities and agree only at zero:
    //
    //   vendor_ledger closing  = purchases - debit notes - payments + refunds
    //                          = OUTSTANDING PAYABLE
    //   account_balance        = total_paid - total_allocated
    //                            - total_refunded + total_refund_allocated
    //                          = UNALLOCATED ADVANCE
    //
    // Purchases never enter account_balance, which is why an unpaid purchase
    // left the ledger at 236 while account_balance stayed 0 - correct
    // behaviour, wrongly asserted. What IS worth asserting is that the stored
    // account_balance agrees with its own component columns, since every writer
    // maintains it by increment and a missed increment would show up here.
    const components =
      num(v.total_paid) - num(v.total_allocated) -
      num(v.total_refunded) + num(v.total_refund_allocated);
    if (!near(v.account_balance, components)) {
      failures.push(
        `vendor ${v.id} "${v.vendor_name}": account_balance=${money(v.account_balance)} ` +
        `but its components give ${money(components)} ` +
        `(paid ${money(v.total_paid)} - allocated ${money(v.total_allocated)} ` +
        `- refunded ${money(v.total_refunded)} + refundAllocated ${money(v.total_refund_allocated)})`
      );
    }
  }
  report('A2', 'vendor ledger reconciles date-ordered, and to vendor_details', failures, checked);
}

/* ------------------------------------------------------------------ A3 */
/** What payment_status claims must match what is actually allocated. */
async function A3() {
  const rows = await prisma.$queryRaw`
    SELECT p.id, p.invoice_no, p.total, p.payment_status,
           COALESCE((SELECT SUM(pa.allocated_amount) FROM payment_allocations pa
                     WHERE pa.purchase_id = p.id), 0) AS allocated
    FROM purchase p`;

  const failures = [];
  for (const r of rows) {
    const alloc = num(r.allocated);
    const total = num(r.total);
    const st = r.payment_status;
    if (st === 0 && alloc > PAISA) {
      failures.push(`purchase ${r.id} (inv ${r.invoice_no}): status Unpaid but ₹${money(alloc)} allocated`);
    } else if (st === 1 && !near(alloc, total)) {
      failures.push(`purchase ${r.id} (inv ${r.invoice_no}): status Paid but allocated ₹${money(alloc)} of ₹${money(total)}`);
    } else if (st === 2 && (alloc < PAISA || alloc >= total - TOL)) {
      failures.push(`purchase ${r.id} (inv ${r.invoice_no}): status Partial but allocated ₹${money(alloc)} of ₹${money(total)}`);
    }
  }
  report('A3', 'payment_status agrees with payment_allocations', failures, rows.length);
}

/* ------------------------------------------------------------------ A4 */
/**
 * Purchase arithmetic. Holds by construction only once the server recomputes
 * tax (P4-12); until then this is the assertion that catches a client that got
 * its own sums wrong.
 *
 * Freight is part of the total since 2026-10-03 (owner, BILLS_PLAN Q1); bills
 * saved before that carry it outside the total, and no data was changed, so
 * either form is accepted. The total is rounded to the rupee (F-34).
 */
async function A4() {
  const rows = await prisma.purchase.findMany({
    select: {
      id: true, invoice_no: true, total: true, items_total: true,
      packing_forwarding_total: true, total_tax: true,
      total_cgst: true, total_sgst: true, total_igst: true, freight: true
    }
  });

  const failures = [];
  for (const r of rows) {
    const expected = num(r.items_total) + num(r.packing_forwarding_total) + num(r.total_tax);
    // The total is rounded to the rupee (F-34), so it may sit up to 50 paise off its parts.
    const roundedNear = (a, b) => Math.abs(num(a) - num(b)) <= 0.5 + TOL;
    if (!roundedNear(r.total, expected + num(r.freight)) && !roundedNear(r.total, expected)) {
      failures.push(
        `purchase ${r.id} (inv ${r.invoice_no}): total=${money(r.total)} but items ${money(r.items_total)} ` +
        `+ packing ${money(r.packing_forwarding_total)} + tax ${money(r.total_tax)} + freight ${money(r.freight)} = ${money(expected + num(r.freight))}`
      );
    }
    const split = num(r.total_cgst) + num(r.total_sgst) + num(r.total_igst);
    if (!near(split, r.total_tax)) {
      failures.push(
        `purchase ${r.id} (inv ${r.invoice_no}): cgst+sgst+igst=${money(split)} but total_tax=${money(r.total_tax)}`
      );
    }
    // A purchase is either intra-state (CGST+SGST, no IGST) or inter-state
    // (IGST only). Both populated at once means the split was never decided.
    if (num(r.total_igst) > TOL && (num(r.total_cgst) > TOL || num(r.total_sgst) > TOL)) {
      failures.push(`purchase ${r.id} (inv ${r.invoice_no}): has IGST AND CGST/SGST together`);
    }
  }
  report('A4', 'purchase totals and tax split are internally consistent', failures, rows.length);
}

/* ------------------------------------------------------------------ A5 */
/** Basic sanity, and the duplicate-number condition P4-02/P4-05 are about. */
async function A5() {
  const failures = [];

  const bad = await prisma.$queryRaw`
    SELECT id, invoice_no, total FROM purchase
    WHERE total IS NULL OR total < 0 OR total != total`;
  for (const r of bad) failures.push(`purchase ${r.id} (inv ${r.invoice_no}): total is ${r.total}`);

  const dupSameFy = await prisma.$queryRaw`
    SELECT fy, invoice_no, COUNT(*) c FROM purchase GROUP BY fy, invoice_no HAVING c > 1`;
  for (const r of dupSameFy) {
    failures.push(`DUPLICATE within FY ${r.fy}: invoice_no ${r.invoice_no} used ${r.c} times — F-08/P4-05`);
  }

  const negStock = await prisma.$queryRaw`
    SELECT id, product_name, stock FROM product WHERE stock < 0`;
  for (const r of negStock) {
    failures.push(`product ${r.id} "${String(r.product_name).trim().slice(0, 40)}": negative stock ${r.stock} — F-73/F-110`);
  }

  report('A5', 'no impossible totals, no duplicate invoice_no within an FY, no negative stock', failures, 3);
}

/* ------------------------------------------------------------------ A6 */
/**
 * Orphans and drift: allocations without a purchase, and lines / snapshots
 * whose copied invoice number disagrees with the purchase they point at.
 */
async function A6() {
  const failures = [];

  // Since P4-11 lines and snapshots point at their purchase by id with a
  // foreign key, so an orphan cannot exist. What can still go wrong is the
  // copied printed number drifting from the bill it belongs to.
  const driftItems = await prisma.$queryRaw`
    SELECT pi.id, pi.invoice_no, pi.fy, p.invoice_no AS p_no, p.fy AS p_fy
    FROM purchase_items pi JOIN purchase p ON p.id = pi.purchase_id
    WHERE pi.invoice_no <> p.invoice_no OR pi.fy <> p.fy`;
  for (const r of driftItems) {
    failures.push(`purchase_items ${r.id}: carries ${r.invoice_no}/${r.fy} but belongs to purchase ${r.p_no}/${r.p_fy}`);
  }

  const driftBillTo = await prisma.$queryRaw`
    SELECT b.id, b.invoice_no, b.fy, p.invoice_no AS p_no, p.fy AS p_fy
    FROM bill_to b JOIN purchase p ON p.id = b.purchase_id
    WHERE b.invoice_no <> p.invoice_no OR NOT (b.fy <=> p.fy)`;
  for (const r of driftBillTo) {
    failures.push(`bill_to ${r.id}: carries ${r.invoice_no}/${r.fy} but belongs to purchase ${r.p_no}/${r.p_fy}`);
  }

  const orphanAlloc = await prisma.$queryRaw`
    SELECT pa.id, pa.purchase_id FROM payment_allocations pa
    WHERE NOT EXISTS (SELECT 1 FROM purchase p WHERE p.id = pa.purchase_id)`;
  for (const r of orphanAlloc) failures.push(`payment_allocations ${r.id}: purchase ${r.purchase_id} is gone`);

  report('A6', 'no orphaned items, billing snapshots or allocations', failures, 4);
}

/* ------------------------------------------------------------------ A7 */
/**
 * The customer side of A2. customer-ledger-service keeps the stored running
 * balance in row (id) order, so that is what is checked here - a row whose
 * balance disagrees means a write skipped the recalculation. The reports do
 * not read the stored column (outstanding is the ledger sum, F-47).
 * customer_details.account_balance must agree with its component columns.
 */
async function A7() {
  const q = (sql, ...p) => prisma.$queryRawUnsafe(sql, ...p);
  const customers = await q(`SELECT id, billing_name, account_balance, total_paid, total_allocated, total_refunded, total_refund_allocated FROM customer_details`);
  const rows = await q(`SELECT id, customer_id, transaction_date, transaction_type, debit, credit, balance FROM customer_ledger ORDER BY customer_id, id`);
  const byCustomer = new Map();
  for (const r of rows) {
    if (!byCustomer.has(num(r.customer_id))) byCustomer.set(num(r.customer_id), []);
    byCustomer.get(num(r.customer_id)).push(r);
  }
  const failures = [];
  let checked = 0;
  for (const c of customers) {
    const entries = byCustomer.get(num(c.id)) || [];
    if (entries.length) {
      checked++;
      let running = 0;
      for (const e of entries) {
        running += num(e.debit) - num(e.credit);
        if (!near(e.balance, running)) {
          failures.push(`customer ${c.id} ledger row ${e.id} (${e.transaction_type}): stored balance=${money(e.balance)} running total=${money(running)}`);
        }
      }
    }
    const components = num(c.total_paid) - num(c.total_allocated) - num(c.total_refunded) + num(c.total_refund_allocated);
    if (!near(c.account_balance, components)) {
      failures.push(`customer ${c.id} "${c.billing_name}": account_balance=${money(c.account_balance)} but its components give ${money(components)}`);
    }
  }
  report('A7', 'customer ledger running balance holds, and customer_details agrees with itself', failures, checked);
}

/* ------------------------------------------------------------------ A8 */
/** The sale / Invoice C twin of A3: payment_status agrees with what is allocated. */
async function A8() {
  const q = (sql, ...p) => prisma.$queryRawUnsafe(sql, ...p);
  const failures = [];
  let checked = 0;
  for (const [label, table, fk] of [['sale', 'invoice', 'invoice_id'], ['Invoice C', 'invoicex', 'invoicex_id']]) {
    const rows = await q(`
      SELECT b.id, b.invoice_no, b.total, b.payment_status,
             COALESCE((SELECT SUM(a.allocated_amount) FROM customer_payment_allocations a WHERE a.${fk} = b.id), 0) AS allocated
      FROM ${table} b WHERE b.select_customer <> 0`);
    for (const r of rows) {
      checked++;
      const alloc = num(r.allocated), total = num(r.total), st = num(r.payment_status);
      if (st === 0 && alloc > PAISA) failures.push(`${label} ${r.id} (no ${r.invoice_no}): status Unpaid but ₹${money(alloc)} allocated`);
      else if (st === 1 && !near(alloc, total)) failures.push(`${label} ${r.id} (no ${r.invoice_no}): status Paid but allocated ₹${money(alloc)} of ₹${money(total)}`);
      else if (st === 2 && (alloc < PAISA || alloc >= total - TOL)) failures.push(`${label} ${r.id} (no ${r.invoice_no}): status Partial but allocated ₹${money(alloc)} of ₹${money(total)}`);
      if (alloc > total + TOL) failures.push(`${label} ${r.id} (no ${r.invoice_no}): ₹${money(alloc)} allocated to a ₹${money(total)} bill`);
    }
  }
  report('A8', 'sale and Invoice C payment_status agrees with allocations', failures, checked);
}

/* ------------------------------------------------------------------ A9 */
/**
 * Returns (sale, Invoice C, purchase):
 *  - no bill line returned beyond what was sold / bought;
 *  - each bill's return_status (0 none, 1 partial, 2 full) matches its lines;
 *  - a refunded return has its credit / debit note in the ledger for the
 *    refund amount, and a pending one has none;
 *  - a purchase return's lines are all on its own vendor's bills;
 *  - total_amount is the sum of quantity x price.
 */
async function A9() {
  const q = (sql, ...p) => prisma.$queryRawUnsafe(sql, ...p);
  const failures = [];
  let checked = 0;
  const KINDS = [
    { label: 'sale', head: 'invoice', items: 'invoice_items', ret: 'sale_returns', retItems: 'sale_return_items', retFk: 'sale_return_id', lineFk: 'invoice_item_id', billFk: 'invoice_id', itemBill: 'invoice_no', ledgerRef: 'sale_return' },
    { label: 'Invoice C', head: 'invoicex', items: 'invoice_itemsx', ret: 'salex_returns', retItems: 'salex_return_items', retFk: 'salex_return_id', lineFk: 'invoice_itemx_id', billFk: 'invoicex_id', itemBill: 'invoice_no', ledgerRef: 'salex_return' },
    { label: 'purchase', head: 'purchase', items: 'purchase_items', ret: 'purchase_returns', retItems: 'purchase_return_items', retFk: 'purchase_return_id', lineFk: 'purchase_item_id', billFk: null, itemBill: 'purchase_id', ledgerRef: 'purchase_return' }
  ];
  for (const k of KINDS) {
    // over-returned lines
    const over = await q(`
      SELECT l.id, l.qty, SUM(r.return_qty) AS back FROM ${k.items} l
      JOIN ${k.retItems} r ON r.${k.lineFk} = l.id
      GROUP BY l.id, l.qty HAVING SUM(r.return_qty) > l.qty`);
    for (const r of over) failures.push(`${k.label} line ${r.id}: ${num(r.back)} returned of ${num(r.qty)}`);

    // bill return_status
    const bills = await q(`
      SELECT b.id, b.return_status,
        (SELECT COUNT(*) FROM ${k.items} l WHERE l.${k.itemBill} = b.id) AS lines,
        (SELECT COUNT(*) FROM ${k.items} l WHERE l.${k.itemBill} = b.id
           AND COALESCE((SELECT SUM(r.return_qty) FROM ${k.retItems} r WHERE r.${k.lineFk} = l.id), 0) >= l.qty) AS full_lines,
        (SELECT COUNT(*) FROM ${k.retItems} r JOIN ${k.items} l ON l.id = r.${k.lineFk} WHERE l.${k.itemBill} = b.id) AS returned_rows
      FROM ${k.head} b`);
    for (const b of bills) {
      checked++;
      const want = num(b.returned_rows) === 0 ? 0 : num(b.lines) > 0 && num(b.full_lines) === num(b.lines) ? 2 : 1;
      if (num(b.return_status) !== want) failures.push(`${k.label} bill ${b.id}: return_status ${num(b.return_status)} but its lines say ${want}`);
    }

    // returns: totals, notes in the ledger
    const rets = await q(`
      SELECT r.id, r.payment_status, r.total_amount, r.refund_amount,
        COALESCE((SELECT SUM(i.return_qty * i.unit_price) FROM ${k.retItems} i WHERE i.${k.retFk} = r.id), 0) AS lines_value,
        (SELECT COUNT(*) FROM ${k.retItems} i WHERE i.${k.retFk} = r.id) AS line_count
      FROM ${k.ret} r`);
    const ledger = k.label === 'purchase'
      ? await q(`SELECT reference_id, SUM(credit) - SUM(debit) AS net, COUNT(*) AS n FROM vendor_ledger WHERE reference_type = 'purchase_return' AND transaction_type IN ('DEBIT_NOTE', 'DEBIT_NOTE_REVERSAL') GROUP BY reference_id`)
      : await q(`SELECT reference_id, SUM(credit) - SUM(debit) AS net, COUNT(*) AS n FROM customer_ledger WHERE reference_type = ? AND transaction_type IN ('CREDIT_NOTE', 'CREDIT_NOTE_REVERSAL') GROUP BY reference_id`, k.ledgerRef);
    const noteOf = new Map(ledger.map(l => [num(l.reference_id), num(l.net)]));
    let customerOf = new Map();
    if (k.label !== 'purchase') {
      const owners = await q(`SELECT r.id, b.select_customer FROM ${k.ret} r JOIN ${k.head} b ON b.id = r.${k.billFk}`);
      customerOf = new Map(owners.map(o => [num(o.id), num(o.select_customer)]));
    }
    for (const r of rets) {
      checked++;
      const tol = TOL * Math.max(1, num(r.line_count));
      if (Math.abs(num(r.total_amount) - num(r.lines_value)) > tol) {
        failures.push(`${k.label} return ${r.id}: total_amount ${money(r.total_amount)} but its lines add to ${money(r.lines_value)}`);
      }
      const walkIn = k.label !== 'purchase' && !customerOf.get(num(r.id));
      if (walkIn) continue; // "Other" customer: no account, no ledger
      const note = noteOf.get(num(r.id));
      if (num(r.payment_status) === 1 && (note === undefined || !near(note, r.refund_amount))) {
        failures.push(`${k.label} return ${r.id}: refunded ₹${money(r.refund_amount)} but its note in the ledger nets ${note === undefined ? 'nothing' : '₹' + money(note)}`);
      }
      if (num(r.payment_status) === 0 && note !== undefined && Math.abs(note) > TOL) {
        failures.push(`${k.label} return ${r.id}: pending refund but the ledger carries a note of ₹${money(note)}`);
      }
    }
  }

  const foreign = await q(`
    SELECT r.id, r.vendor_id, p.id AS purchase_id, p.vendor_id AS bill_vendor
    FROM purchase_returns r
    JOIN purchase_return_items i ON i.purchase_return_id = r.id
    JOIN purchase_items l ON l.id = i.purchase_item_id
    JOIN purchase p ON p.id = l.purchase_id
    WHERE p.vendor_id <> r.vendor_id`);
  for (const f of foreign) failures.push(`purchase return ${f.id} (vendor ${f.vendor_id}) has a line from purchase ${f.purchase_id} of vendor ${f.bill_vendor}`);

  report('A9', 'returns: quantities, bill return status, totals, notes in the ledger, one vendor', failures, checked);
}

/* ------------------------------------------------------------------ A10 */
/**
 * Payments and refunds, both parties:
 *  - allocations never exceed the amount; BILL_SPECIFIC allocates all of it,
 *    DIRECT none, MIXED some;
 *  - every allocation points at a bill / return of the same party.
 */
async function A10() {
  const q = (sql, ...p) => prisma.$queryRawUnsafe(sql, ...p);
  const failures = [];
  let checked = 0;
  const SETS = [
    { label: 'customer payment', head: 'customer_payments', amount: 'payment_amount', type: 'payment_type', alloc: 'customer_payment_allocations', fk: 'payment_id' },
    { label: 'vendor payment', head: 'vendor_payments', amount: 'payment_amount', type: 'payment_type', alloc: 'payment_allocations', fk: 'payment_id' },
    { label: 'customer refund', head: 'customer_refunds', amount: 'refund_amount', type: 'refund_type', alloc: 'customer_refund_allocations', fk: 'refund_id' },
    { label: 'vendor refund', head: 'vendor_refunds', amount: 'refund_amount', type: 'refund_type', alloc: 'refund_allocations', fk: 'refund_id' }
  ];
  for (const s of SETS) {
    const rows = await q(`
      SELECT h.id, h.${s.amount} AS amount, h.${s.type} AS kind,
        COALESCE((SELECT SUM(a.allocated_amount) FROM ${s.alloc} a WHERE a.${s.fk} = h.id), 0) AS allocated
      FROM ${s.head} h`);
    for (const r of rows) {
      checked++;
      const amt = num(r.amount), al = num(r.allocated);
      if (al > amt + TOL) failures.push(`${s.label} ${r.id}: ₹${money(al)} allocated of ₹${money(amt)}`);
      if (r.kind === 'BILL_SPECIFIC' && !near(al, amt)) failures.push(`${s.label} ${r.id}: bill specific but ₹${money(al)} of ₹${money(amt)} allocated`);
      if (r.kind === 'DIRECT' && al > TOL) failures.push(`${s.label} ${r.id}: on account but ₹${money(al)} allocated`);
      if (r.kind === 'MIXED' && al <= TOL) failures.push(`${s.label} ${r.id}: mixed but nothing allocated`);
      if (r.kind === 'RETURN_SPECIFIC' && al <= TOL) failures.push(`${s.label} ${r.id}: return specific but nothing allocated`);
    }
  }
  const cross = [
    [`SELECT a.id, p.customer_id AS owner, b.select_customer AS other FROM customer_payment_allocations a JOIN customer_payments p ON p.id = a.payment_id JOIN invoice b ON b.id = a.invoice_id WHERE a.invoice_id IS NOT NULL AND b.select_customer <> p.customer_id`, 'customer payment allocation (sale)'],
    [`SELECT a.id, p.customer_id AS owner, b.select_customer AS other FROM customer_payment_allocations a JOIN customer_payments p ON p.id = a.payment_id JOIN invoicex b ON b.id = a.invoicex_id WHERE a.invoicex_id IS NOT NULL AND b.select_customer <> p.customer_id`, 'customer payment allocation (Invoice C)'],
    [`SELECT a.id, p.vendor_id AS owner, b.vendor_id AS other FROM payment_allocations a JOIN vendor_payments p ON p.id = a.payment_id JOIN purchase b ON b.id = a.purchase_id WHERE b.vendor_id <> p.vendor_id`, 'vendor payment allocation'],
    [`SELECT a.id, p.vendor_id AS owner, r.vendor_id AS other FROM refund_allocations a JOIN vendor_refunds p ON p.id = a.refund_id JOIN purchase_returns r ON r.id = a.return_id WHERE r.vendor_id <> p.vendor_id`, 'vendor refund allocation'],
    // G-04 (2026-10-04): customer refund allocations, like the other three.
    [`SELECT a.id, f.customer_id AS owner, b.select_customer AS other FROM customer_refund_allocations a JOIN customer_refunds f ON f.id = a.refund_id JOIN sale_returns r ON r.id = a.sale_return_id JOIN invoice b ON b.id = r.invoice_id WHERE a.sale_return_id IS NOT NULL AND b.select_customer <> f.customer_id`, 'customer refund allocation (sale return)'],
    [`SELECT a.id, f.customer_id AS owner, b.select_customer AS other FROM customer_refund_allocations a JOIN customer_refunds f ON f.id = a.refund_id JOIN salex_returns r ON r.id = a.salex_return_id JOIN invoicex b ON b.id = r.invoicex_id WHERE a.salex_return_id IS NOT NULL AND b.select_customer <> f.customer_id`, 'customer refund allocation (Invoice C return)']
  ];
  for (const [sql, label] of cross) {
    for (const r of await q(sql)) failures.push(`${label} ${r.id}: party ${r.owner} but the bill / return belongs to ${r.other}`);
  }
  const orphans = [
    [`SELECT a.id FROM customer_payment_allocations a WHERE NOT EXISTS (SELECT 1 FROM customer_payments p WHERE p.id = a.payment_id)`, 'customer payment allocation without its payment'],
    [`SELECT a.id FROM customer_payment_allocations a WHERE a.invoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoice b WHERE b.id = a.invoice_id)`, 'customer payment allocation to a missing sale'],
    [`SELECT a.id FROM customer_payment_allocations a WHERE a.invoicex_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoicex b WHERE b.id = a.invoicex_id)`, 'customer payment allocation to a missing Invoice C bill'],
    [`SELECT a.id FROM payment_allocations a WHERE NOT EXISTS (SELECT 1 FROM vendor_payments p WHERE p.id = a.payment_id)`, 'vendor payment allocation without its payment'],
    [`SELECT a.id FROM customer_refund_allocations a WHERE NOT EXISTS (SELECT 1 FROM customer_refunds f WHERE f.id = a.refund_id)`, 'customer refund allocation without its refund'],
    [`SELECT a.id FROM customer_refund_allocations a WHERE a.sale_return_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sale_returns r WHERE r.id = a.sale_return_id)`, 'customer refund allocation to a missing sale return'],
    [`SELECT a.id FROM customer_refund_allocations a WHERE a.salex_return_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM salex_returns r WHERE r.id = a.salex_return_id)`, 'customer refund allocation to a missing Invoice C return'],
    [`SELECT a.id FROM refund_allocations a WHERE NOT EXISTS (SELECT 1 FROM vendor_refunds f WHERE f.id = a.refund_id)`, 'vendor refund allocation without its refund'],
    [`SELECT a.id FROM refund_allocations a WHERE NOT EXISTS (SELECT 1 FROM purchase_returns r WHERE r.id = a.return_id)`, 'vendor refund allocation to a missing return']
  ];
  for (const [sql, label] of orphans) for (const r of await q(sql)) failures.push(`${label}: ${r.id}`);

  report('A10', 'payments and refunds: allocations fit the amount and the type, same party, no orphans', failures, checked);
}

/* ------------------------------------------------------------------ A11 */
/**
 * Dead stock and the party masters:
 *  - every dead stock entry is a positive whole number of units of a product
 *    that exists, with a reason (fractions predate the whole-unit rule and are
 *    listed so they can be looked at);
 *  - customer / vendor status is Active or Inactive;
 *  - no bill, return, payment, refund or ledger row points at a customer or
 *    vendor that no longer exists (0 is the "Other" party and is skipped).
 */
async function A11() {
  const q = (sql) => prisma.$queryRawUnsafe(sql);
  const failures = [];
  let checked = 0;
  const dead = await q(`SELECT d.id, d.product_id, d.quantity, d.reason, p.id AS pid FROM deadstock d LEFT JOIN product p ON p.id = d.product_id`);
  for (const d of dead) {
    checked++;
    const n = num(d.quantity);
    if (!(n > 0)) failures.push(`dead stock ${d.id}: quantity ${n}`);
    else if (!Number.isInteger(n)) failures.push(`dead stock ${d.id}: ${n} is not a whole number of units`);
    if (d.pid === null || d.pid === undefined) failures.push(`dead stock ${d.id}: product ${d.product_id} does not exist`);
    if (!String(d.reason || '').trim()) failures.push(`dead stock ${d.id}: no reason`);
  }
  for (const t of ['customer_details', 'vendor_details']) {
    const rows = await q(`SELECT id, status FROM ${t}`);
    for (const r of rows) {
      checked++;
      if (r.status !== 'Active' && r.status !== 'Inactive') failures.push(`${t} ${r.id}: status "${r.status}"`);
    }
  }
  const refs = [
    ['invoice', 'select_customer', 'customer_details', 'sale'],
    ['invoicex', 'select_customer', 'customer_details', 'Invoice C bill'],
    ['customer_payments', 'customer_id', 'customer_details', 'customer payment'],
    ['customer_refunds', 'customer_id', 'customer_details', 'customer refund'],
    ['customer_ledger', 'customer_id', 'customer_details', 'customer ledger row'],
    ['purchase', 'vendor_id', 'vendor_details', 'purchase'],
    ['purchase_returns', 'vendor_id', 'vendor_details', 'purchase return'],
    ['vendor_payments', 'vendor_id', 'vendor_details', 'vendor payment'],
    ['vendor_refunds', 'vendor_id', 'vendor_details', 'vendor refund'],
    ['vendor_ledger', 'vendor_id', 'vendor_details', 'vendor ledger row']
  ];
  for (const [table, col, owner, label] of refs) {
    const rows = await q(`SELECT x.id, x.${col} AS party FROM ${table} x WHERE x.${col} IS NOT NULL AND x.${col} <> 0 AND NOT EXISTS (SELECT 1 FROM ${owner} o WHERE o.id = x.${col})`);
    for (const r of rows) failures.push(`${label} ${r.id}: party ${r.party} does not exist`);
  }
  report('A11', 'dead stock entries valid; status words; nothing points at a missing customer or vendor', failures, checked);
}

/* ------------------------------------------------------------------ A12 */
/**
 * Documents -> ledger (2026-10-03). A1-A11 check that the ledger agrees with
 * itself; this checks that it agrees with the documents it records, so a bill
 * posted at the wrong total, or a payment that never reached the ledger, fails.
 *
 *  - every bill has exactly one PURCHASE / SALE row, on its own party, and its
 *    rows (with any _ADJUSTMENT / _REVERSAL) net to the bill's total; a walk-in
 *    ("Other" customer, 0) sale posts nothing - the vendor "Other" (0) is a real
 *    vendor row and does post;
 *  - per party, the payment rows net to the party's payments, the refund rows to
 *    its refunds and the note rows to its refunded returns.
 *  - a refunded return is a direct adjustment to the party's account (owner,
 *    2026-10-03): its note is what posts. A sale / Invoice C return created as
 *    refunded also writes a REFUND row for the same amount; one marked refunded
 *    later writes only the note. So a return's REFUND rows, when it has any,
 *    net to its refund, and a pending return has none.
 * Together these make each party's closing balance exactly what its documents
 * say - which is what the outstanding and ledger reports show.
 */
async function A12() {
  const q = (sql, ...p) => prisma.$queryRawUnsafe(sql, ...p);
  const failures = [];
  let checked = 0;

  const BILLS = [
    { label: 'purchase', head: 'purchase', party: 'COALESCE(b.vendor_id, 0)', ledger: 'vendor_ledger', who: 'vendor_id', ref: `'purchase'`, type: 'PURCHASE', walkIn: false },
    { label: 'sale', head: 'invoice', party: 'COALESCE(b.select_customer, 0)', ledger: 'customer_ledger', who: 'customer_id', ref: `'sale'`, type: 'SALE', walkIn: true },
    { label: 'Invoice C', head: 'invoicex', party: 'COALESCE(b.select_customer, 0)', ledger: 'customer_ledger', who: 'customer_id', ref: `'salex'`, type: 'SALE', walkIn: true }
  ];
  for (const k of BILLS) {
    const rows = await q(`
      SELECT b.id, b.invoice_no, b.total, ${k.party} AS party,
        COALESCE((SELECT SUM(l.debit - l.credit) FROM ${k.ledger} l
                  WHERE l.reference_type = ${k.ref} AND l.reference_id = b.id AND l.transaction_type LIKE '${k.type}%'), 0) AS posted,
        (SELECT COUNT(*) FROM ${k.ledger} l
          WHERE l.reference_type = ${k.ref} AND l.reference_id = b.id AND l.transaction_type = '${k.type}') AS main_rows,
        (SELECT COUNT(*) FROM ${k.ledger} l
          WHERE l.reference_type = ${k.ref} AND l.reference_id = b.id AND l.${k.who} <> ${k.party}) AS other_party
      FROM ${k.head} b`);
    for (const r of rows) {
      checked++;
      const name = `${k.label} ${r.id} (no ${r.invoice_no})`;
      if (k.walkIn && num(r.party) === 0) {
        if (num(r.main_rows) > 0 || Math.abs(num(r.posted)) > TOL) failures.push(`${name}: walk-in bill but the ledger carries ₹${money(r.posted)} for it`);
        continue;
      }
      if (num(r.main_rows) !== 1) failures.push(`${name}: ${num(r.main_rows)} ${k.type} rows in the ledger (expected 1)`);
      if (!near(r.posted, r.total)) failures.push(`${name}: total ₹${money(r.total)} but its ledger rows net ₹${money(r.posted)}`);
      if (num(r.other_party) > 0) failures.push(`${name}: ${num(r.other_party)} of its ledger rows sit on another party`);
    }
  }

  // Per party: each kind of money movement against what the documents hold.
  const sumBy = async (sql) => {
    const m = new Map();
    for (const r of await q(sql)) m.set(num(r.party), num(r.amount));
    return m;
  };
  const SIDES = [
    {
      side: 'vendor', master: 'vendor_details', nameCol: 'vendor_name',
      pairs: [
        ['payments', `SELECT vendor_id AS party, SUM(payment_amount) AS amount FROM vendor_payments GROUP BY vendor_id`,
                     `SELECT vendor_id AS party, SUM(credit - debit) AS amount FROM vendor_ledger WHERE transaction_type LIKE 'PAYMENT%' GROUP BY vendor_id`],
        ['refunds', `SELECT vendor_id AS party, SUM(refund_amount) AS amount FROM vendor_refunds GROUP BY vendor_id`,
                    `SELECT vendor_id AS party, SUM(debit - credit) AS amount FROM vendor_ledger WHERE transaction_type LIKE 'REFUND%' GROUP BY vendor_id`],
        ['debit notes', `SELECT vendor_id AS party, SUM(refund_amount) AS amount FROM purchase_returns WHERE payment_status = 1 GROUP BY vendor_id`,
                        `SELECT vendor_id AS party, SUM(credit - debit) AS amount FROM vendor_ledger WHERE transaction_type LIKE 'DEBIT_NOTE%' GROUP BY vendor_id`]
      ]
    },
    {
      side: 'customer', master: 'customer_details', nameCol: 'billing_name',
      pairs: [
        ['payments', `SELECT customer_id AS party, SUM(payment_amount) AS amount FROM customer_payments GROUP BY customer_id`,
                     `SELECT customer_id AS party, SUM(credit - debit) AS amount FROM customer_ledger WHERE transaction_type LIKE 'PAYMENT%' GROUP BY customer_id`],
        ['refunds', `SELECT customer_id AS party, SUM(refund_amount) AS amount FROM customer_refunds GROUP BY customer_id`,
                    `SELECT customer_id AS party, SUM(debit - credit) AS amount FROM customer_ledger WHERE transaction_type LIKE 'REFUND%' AND reference_type NOT IN ('sale_return', 'salex_return') GROUP BY customer_id`],
        ['credit notes', REFUNDED_SALE_RETURNS,
                         `SELECT customer_id AS party, SUM(credit - debit) AS amount FROM customer_ledger WHERE transaction_type LIKE 'CREDIT_NOTE%' GROUP BY customer_id`],
      ]
    }
  ];
  for (const s of SIDES) {
    const names = new Map((await q(`SELECT id, ${s.nameCol} AS name FROM ${s.master}`)).map(r => [num(r.id), r.name]));
    const parties = new Set(names.keys());
    const sets = [];
    for (const [label, docSql, ledgerSql] of s.pairs) {
      const docs = await sumBy(docSql), posted = await sumBy(ledgerSql);
      for (const p of [...docs.keys(), ...posted.keys()]) parties.add(p);
      sets.push([label, docs, posted]);
    }
    for (const p of parties) {
      checked++;
      for (const [label, docs, posted] of sets) {
        const d = docs.get(p) || 0, l = posted.get(p) || 0;
        if (!near(d, l)) failures.push(`${s.side} ${p} "${names.get(p) ?? '?'}": ${label} ₹${money(d)} but the ledger rows for them net ₹${money(l)}`);
      }
    }
  }
  // Counters against the documents (2026-10-03): total_paid is the money in the party's
  // payments. total_refunded is at least the money in its refunds and at most that plus its
  // refunded returns - a return marked refunded later may draw on an earlier on-account
  // refund (owner: direct adjustment), so it can count for less. A refund edit once left
  // total_refunded at the old amount and no assertion noticed.
  for (const [side, master, payQ, refQ] of [
    ['vendor', 'vendor_details', `SELECT vendor_id AS party, SUM(payment_amount) AS amount FROM vendor_payments GROUP BY vendor_id`,
      `SELECT party, SUM(amount) AS amount FROM (SELECT vendor_id AS party, refund_amount AS amount FROM vendor_refunds UNION ALL SELECT vendor_id AS party, refund_amount AS amount FROM purchase_returns WHERE payment_status = 1) t GROUP BY party`],
    ['customer', 'customer_details', `SELECT customer_id AS party, SUM(payment_amount) AS amount FROM customer_payments GROUP BY customer_id`,
      `SELECT party, SUM(amount) AS amount FROM (SELECT customer_id AS party, refund_amount AS amount FROM customer_refunds UNION ALL ${REFUNDED_SALE_RETURNS.replace(/SELECT party, SUM\(amount\) AS amount FROM \(|\) t GROUP BY party/g, '')}) u GROUP BY party`]]) {
    const pay = await sumBy(payQ), ref = await sumBy(refQ);
    const own = await sumBy(side === 'vendor'
      ? `SELECT vendor_id AS party, SUM(refund_amount) AS amount FROM vendor_refunds GROUP BY vendor_id`
      : `SELECT customer_id AS party, SUM(refund_amount) AS amount FROM customer_refunds GROUP BY customer_id`);
    for (const c of await q(`SELECT id, total_paid, total_refunded FROM ${master}`)) {
      if (!near(c.total_paid, pay.get(num(c.id)) || 0)) failures.push(`${side} ${c.id}: total_paid ₹${money(c.total_paid)} but its payments hold ₹${money(pay.get(num(c.id)) || 0)}`);
      const lo = own.get(num(c.id)) || 0, hi = ref.get(num(c.id)) || 0;
      if (num(c.total_refunded) < lo - TOL || num(c.total_refunded) > hi + TOL) failures.push(`${side} ${c.id}: total_refunded ₹${money(c.total_refunded)} but its refunds hold ₹${money(lo)} and with its refunded returns ₹${money(hi)}`);
    }
  }

  // A return's own REFUND rows (customer side): none, or exactly its refund.
  for (const [label, ret, head, fk, ref] of [['sale return', 'sale_returns', 'invoice', 'invoice_id', 'sale_return'], ['Invoice C return', 'salex_returns', 'invoicex', 'invoicex_id', 'salex_return']]) {
    const rows = await q(`
      SELECT r.id, r.payment_status, r.refund_amount, b.select_customer AS party,
        (SELECT COUNT(*) FROM customer_ledger l WHERE l.reference_type = '${ref}' AND l.reference_id = r.id AND l.transaction_type LIKE 'REFUND%') AS n,
        COALESCE((SELECT SUM(l.debit - l.credit) FROM customer_ledger l WHERE l.reference_type = '${ref}' AND l.reference_id = r.id AND l.transaction_type LIKE 'REFUND%'), 0) AS paid
      FROM ${ret} r JOIN ${head} b ON b.id = r.${fk}`);
    for (const r of rows) {
      if (num(r.n) === 0) continue;
      checked++;
      if (num(r.payment_status) !== 1) failures.push(`${label} ${r.id}: pending but the ledger carries a refund of ₹${money(r.paid)} for it`);
      else if (!near(r.paid, r.refund_amount)) failures.push(`${label} ${r.id}: refund ₹${money(r.refund_amount)} but its REFUND rows net ₹${money(r.paid)}`);
    }
  }
  report('A12', 'documents -> ledger: each bill posted at its total; each party\'s payments, refunds and notes posted in full', failures, checked);
}

/** Refunded sale and Invoice C returns per customer (their CREDIT_NOTE rows). */
const REFUNDED_SALE_RETURNS = `
  SELECT party, SUM(amount) AS amount FROM (
    SELECT b.select_customer AS party, r.refund_amount AS amount FROM sale_returns r JOIN invoice b ON b.id = r.invoice_id WHERE r.payment_status = 1 AND b.select_customer <> 0
    UNION ALL
    SELECT b.select_customer AS party, r.refund_amount AS amount FROM salex_returns r JOIN invoicex b ON b.id = r.invoicex_id WHERE r.payment_status = 1 AND b.select_customer <> 0
  ) t GROUP BY party`;

/* ------------------------------------------------------------------ A13 */
/**
 * Ledger -> documents (2026-10-03), the other direction of A12. Every row is a
 * type the app writes, and the document it records still exists and belongs to
 * the same party. A delete removes its rows, so a row left behind - or one
 * written by hand - shows up here. A payment or refund row carries the
 * payment's / refund's id in transaction_id (that is how a delete finds it);
 * the reversal rows a status change writes carry only their bill.
 */
async function A13() {
  const q = (sql) => prisma.$queryRawUnsafe(sql);
  const failures = [];
  const VENDOR_TYPES = ['PURCHASE', 'DEBIT_NOTE', 'PAYMENT', 'REFUND_RECEIVED', 'REFUND'];
  const CUSTOMER_TYPES = ['SALE', 'CREDIT_NOTE', 'PAYMENT_RECEIVED', 'PAYMENT', 'REFUND', 'REFUND_PAID'];
  const known = (types, t) => types.some(b => t === b || t === `${b}_REVERSAL` || t === `${b}_ADJUSTMENT`);
  const VENDOR_KNOWN = (t) => known(VENDOR_TYPES, t) && t !== 'REFUND' && t !== 'REFUND_PAID';
  const CUSTOMER_KNOWN = (t) => known(CUSTOMER_TYPES, t) && t !== 'PAYMENT';
  const hasId = (v) => v !== null && v !== undefined;

  const vendorRows = await q(`SELECT id, vendor_id, transaction_type, reference_type, reference_id, transaction_id FROM vendor_ledger`);
  const customerRows = await q(`SELECT id, customer_id, transaction_type, reference_type, reference_id, transaction_id FROM customer_ledger`);
  const owner = async (sql) => new Map((await q(sql)).map(r => [num(r.id), num(r.party)]));
  const purchases = await owner(`SELECT id, COALESCE(vendor_id, 0) AS party FROM purchase`);
  const pReturns = await owner(`SELECT id, COALESCE(vendor_id, 0) AS party FROM purchase_returns`);
  const vPayments = await owner(`SELECT id, vendor_id AS party FROM vendor_payments`);
  const vRefunds = await owner(`SELECT id, vendor_id AS party FROM vendor_refunds`);
  const sales = await owner(`SELECT id, COALESCE(select_customer, 0) AS party FROM invoice`);
  const salesX = await owner(`SELECT id, COALESCE(select_customer, 0) AS party FROM invoicex`);
  const sReturns = await owner(`SELECT r.id, COALESCE(b.select_customer, 0) AS party FROM sale_returns r JOIN invoice b ON b.id = r.invoice_id`);
  const xReturns = await owner(`SELECT r.id, COALESCE(b.select_customer, 0) AS party FROM salex_returns r JOIN invoicex b ON b.id = r.invoicex_id`);
  const cPayments = await owner(`SELECT id, customer_id AS party FROM customer_payments`);
  const cRefunds = await owner(`SELECT id, customer_id AS party FROM customer_refunds`);

  const expect = (label, row, party, docs, id, what) => {
    if (!docs.has(num(id))) failures.push(`${label} row ${row.id} (${row.transaction_type}): ${what} ${id} does not exist`);
    else if (docs.get(num(id)) !== party) failures.push(`${label} row ${row.id} (${row.transaction_type}): ${what} ${id} belongs to party ${docs.get(num(id))}, the row to ${party}`);
  };
  for (const r of vendorRows) {
    const t = String(r.transaction_type), L = 'vendor ledger', party = num(r.vendor_id);
    if (!VENDOR_KNOWN(t)) { failures.push(`${L} row ${r.id}: type ${t} is not one the app writes`); continue; }
    if (r.reference_type === 'purchase') expect(L, r, party, purchases, r.reference_id, 'purchase');
    else if (r.reference_type === 'purchase_return') expect(L, r, party, pReturns, r.reference_id, 'purchase return');
    else if (r.reference_type !== 'payment') failures.push(`${L} row ${r.id} (${t}): reference type "${r.reference_type}"`);
    if (t.endsWith('_REVERSAL')) continue;
    if (t.startsWith('PAYMENT')) {
      if (!hasId(r.transaction_id)) failures.push(`${L} row ${r.id} (${t}): no payment id - deleting the payment cannot find it`);
      else expect(L, r, party, vPayments, r.transaction_id, 'payment');
    } else if (t.startsWith('REFUND')) {
      if (!hasId(r.transaction_id)) failures.push(`${L} row ${r.id} (${t}): no refund id - deleting the refund cannot find it`);
      else expect(L, r, party, vRefunds, r.transaction_id, 'refund');
    }
  }
  for (const r of customerRows) {
    const t = String(r.transaction_type), L = 'customer ledger', party = num(r.customer_id);
    if (!CUSTOMER_KNOWN(t)) { failures.push(`${L} row ${r.id}: type ${t} is not one the app writes`); continue; }
    if (party === 0) failures.push(`${L} row ${r.id} (${t}): on the walk-in customer, who has no account`);
    if (r.reference_type === 'sale') expect(L, r, party, sales, r.reference_id, 'sale');
    else if (r.reference_type === 'salex') expect(L, r, party, salesX, r.reference_id, 'Invoice C bill');
    else if (r.reference_type === 'sale_return') expect(L, r, party, sReturns, r.reference_id, 'sale return');
    else if (r.reference_type === 'salex_return') expect(L, r, party, xReturns, r.reference_id, 'Invoice C return');
    else if (r.reference_type !== 'payment' && r.reference_type !== 'refund') failures.push(`${L} row ${r.id} (${t}): reference type "${r.reference_type}"`);
    if (t.endsWith('_REVERSAL')) continue;
    if (t.startsWith('PAYMENT')) {
      if (!hasId(r.transaction_id)) failures.push(`${L} row ${r.id} (${t}): no payment id - deleting the payment cannot find it`);
      else expect(L, r, party, cPayments, r.transaction_id, 'payment');
    } else if (t.startsWith('REFUND_PAID')) {
      if (!hasId(r.transaction_id)) failures.push(`${L} row ${r.id} (${t}): no refund id - deleting the refund cannot find it`);
      else expect(L, r, party, cRefunds, r.transaction_id, 'refund');
    }
  }
  report('A13', 'ledger -> documents: every row a known type, its document there, same party', failures, vendorRows.length + customerRows.length);
}

/* ------------------------------------------------------------------ A14 */
/**
 * Balance logs (2026-10-03). Every change to a party's total_paid /
 * total_allocated / total_refunded / total_refund_allocated is logged, and the
 * balance-log reports list those rows. Per party and column: each row's new
 * value is old + change, each row starts where the previous one ended, and the
 * last one is the party's current figure. Parties or columns with no log rows
 * (data from before the logs) are skipped.
 */
async function A14() {
  const q = (sql) => prisma.$queryRawUnsafe(sql);
  const failures = [];
  let checked = 0;
  const COLUMNS = ['total_paid', 'total_allocated', 'total_refunded', 'total_refund_allocated'];
  for (const [side, logs, master, who] of [['vendor', 'vendor_balance_logs', 'vendor_details', 'vendor_id'], ['customer', 'customer_balance_logs', 'customer_details', 'customer_id']]) {
    const parties = new Map((await q(`SELECT id, total_paid, total_allocated, total_refunded, total_refund_allocated FROM ${master}`)).map(r => [num(r.id), r]));
    const rows = await q(`SELECT id, ${who} AS party, column_name, change_amount, old_value, new_value, source_type FROM ${logs} ORDER BY ${who}, column_name, id`);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], before = rows[i - 1], after = rows[i + 1];
      const key = (x) => `${num(x.party)}|${x.column_name}`;
      const label = `${side} ${num(r.party)} ${r.column_name} log ${r.id} (${r.source_type})`;
      if (!near(num(r.old_value) + num(r.change_amount), r.new_value)) failures.push(`${label}: ${money(r.old_value)} + ${money(r.change_amount)} is not ${money(r.new_value)}`);
      if (before && key(before) === key(r) && !near(before.new_value, r.old_value)) failures.push(`${label}: starts at ${money(r.old_value)} but the row before ended at ${money(before.new_value)}`);
      if (after && key(after) === key(r)) continue;
      checked++;
      const p = parties.get(num(r.party));
      if (!p) failures.push(`${label}: ${side} ${num(r.party)} does not exist`);
      else if (!COLUMNS.includes(r.column_name)) failures.push(`${label}: unknown column`);
      else if (!near(p[r.column_name], r.new_value)) failures.push(`${side} ${num(r.party)} ${r.column_name}: ${money(p[r.column_name])} but its log ends at ${money(r.new_value)}`);
    }
  }
  report('A14', 'balance logs: each row adds up, the rows chain, the last equals the party\'s figure', failures, checked);
}

/* ------------------------------------------------------------------ A15 */
/**
 * Each payment and refund -> its own ledger rows (2026-10-04, review C G-01 /
 * G-02). A12 sums per party, so a payment posted 2x while another posted 0, a
 * row left naming a bill the payment no longer pays (deleting that bill then
 * takes the row), or a row of 0 passed. Per the per-party conventions:
 *  - vendor payment: BILL_SPECIFIC -> one PAYMENT row per allocated bill, tagged
 *    with the bill, for that bill's share; MIXED / DIRECT -> one PAYMENT row
 *    tagged 'payment' for the whole amount;
 *  - customer payment: one PAYMENT_RECEIVED row for the whole amount; tagged
 *    with a bill only while it is that bill's own payment (BILL_SPECIFIC, that
 *    one bill) - the bill's delete removes it;
 *  - vendor refund: REFUND_RECEIVED rows netting to the refund, one per
 *    (legacy) return allocation for its share;
 *  - customer refund: one REFUND_PAID row tagged 'refund' for the amount;
 * and every one of these rows carries the document's date and mode.
 */
async function A15() {
  const q = (sql) => prisma.$queryRawUnsafe(sql);
  const failures = [];
  let checked = 0;
  const group = (rows, key) => { const m = new Map(); for (const r of rows) { const k = num(r[key]); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  const sameMode = (doc, row) => doc === null || doc === undefined || (row !== null && row !== undefined && num(doc) === num(row));
  const dateMode = (label, doc, rows, dateCol, modeCol) => {
    for (const l of rows) {
      if (num(l.transaction_date) !== num(doc[dateCol])) failures.push(`${label}: ledger row ${l.id} dated ${num(l.transaction_date)}, the document ${num(doc[dateCol])}`);
      if (!sameMode(doc[modeCol], l.payment_mode)) failures.push(`${label}: ledger row ${l.id} mode ${l.payment_mode}, the document ${doc[modeCol]}`);
    }
  };

  // Vendor payments
  {
    const pays = await q(`SELECT id, payment_amount, payment_type, payment_date, payment_mode FROM vendor_payments`);
    const allocs = group(await q(`SELECT payment_id, purchase_id, allocated_amount FROM payment_allocations`), 'payment_id');
    const rows = group(await q(`SELECT id, transaction_id, reference_type, reference_id, credit, debit, transaction_date, payment_mode FROM vendor_ledger WHERE transaction_type = 'PAYMENT'`), 'transaction_id');
    for (const p of pays) {
      checked++;
      const label = `vendor payment ${p.id} (${p.payment_type})`;
      const mine = rows.get(num(p.id)) || [];
      const al = (allocs.get(num(p.id)) || []).filter(a => num(a.allocated_amount) > PAISA);
      dateMode(label, p, mine, 'payment_date', 'payment_mode');
      if (p.payment_type === 'BILL_SPECIFIC') {
        for (const a of al) {
          const r = mine.filter(l => l.reference_type === 'purchase' && num(l.reference_id) === num(a.purchase_id));
          if (r.length !== 1) failures.push(`${label}: ${r.length} ledger rows for purchase ${a.purchase_id} (expected 1)`);
          else if (!near(num(r[0].credit) - num(r[0].debit), a.allocated_amount)) failures.push(`${label}: purchase ${a.purchase_id} has ₹${money(a.allocated_amount)} but its ledger row credits ₹${money(num(r[0].credit) - num(r[0].debit))}`);
        }
        for (const l of mine) {
          if (!(l.reference_type === 'purchase' && al.some(a => num(a.purchase_id) === num(l.reference_id)))) failures.push(`${label}: ledger row ${l.id} names ${l.reference_type} ${l.reference_id}, which the payment does not pay`);
        }
      } else {
        if (mine.length !== 1 || mine[0].reference_type !== 'payment') failures.push(`${label}: ${mine.length} ledger rows (${mine.map(l => `${l.reference_type} ${l.reference_id}`).join(', ')}); expected one tagged 'payment'`);
        else if (!near(num(mine[0].credit) - num(mine[0].debit), p.payment_amount)) failures.push(`${label}: ₹${money(p.payment_amount)} but its ledger row credits ₹${money(num(mine[0].credit) - num(mine[0].debit))}`);
      }
    }
  }

  // Customer payments
  {
    const pays = await q(`SELECT id, payment_amount, payment_type, payment_date, payment_mode FROM customer_payments`);
    const allocs = group(await q(`SELECT payment_id, invoice_id, invoicex_id, allocated_amount FROM customer_payment_allocations`), 'payment_id');
    const rows = group(await q(`SELECT id, transaction_id, reference_type, reference_id, credit, debit, transaction_date, payment_mode FROM customer_ledger WHERE transaction_type = 'PAYMENT_RECEIVED'`), 'transaction_id');
    for (const p of pays) {
      checked++;
      const label = `customer payment ${p.id} (${p.payment_type})`;
      const mine = rows.get(num(p.id)) || [];
      dateMode(label, p, mine, 'payment_date', 'payment_mode');
      if (mine.length !== 1) { failures.push(`${label}: ${mine.length} PAYMENT_RECEIVED rows (expected 1)`); continue; }
      const l = mine[0];
      if (!near(num(l.credit) - num(l.debit), p.payment_amount)) failures.push(`${label}: ₹${money(p.payment_amount)} but its ledger row credits ₹${money(num(l.credit) - num(l.debit))}`);
      if (l.reference_type === 'sale' || l.reference_type === 'salex') {
        const al = (allocs.get(num(p.id)) || []).filter(a => num(a.allocated_amount) > PAISA);
        const col = l.reference_type === 'sale' ? 'invoice_id' : 'invoicex_id';
        if (!(p.payment_type === 'BILL_SPECIFIC' && al.length === 1 && num(al[0][col]) === num(l.reference_id))) {
          failures.push(`${label}: its ledger row ${l.id} is tagged ${l.reference_type} ${l.reference_id}, but the payment is not that bill's own payment - deleting the bill would take the row`);
        }
      } else if (l.reference_type !== 'payment') failures.push(`${label}: ledger row ${l.id} tagged "${l.reference_type}"`);
    }
  }

  // Vendor refunds
  {
    const refs = await q(`SELECT id, refund_amount, refund_date, refund_mode FROM vendor_refunds`);
    const allocs = group(await q(`SELECT refund_id, return_id, allocated_amount FROM refund_allocations`), 'refund_id');
    const rows = group(await q(`SELECT id, transaction_id, reference_type, reference_id, credit, debit, transaction_date, payment_mode FROM vendor_ledger WHERE transaction_type = 'REFUND_RECEIVED'`), 'transaction_id');
    for (const f of refs) {
      checked++;
      const label = `vendor refund ${f.id}`;
      const mine = rows.get(num(f.id)) || [];
      dateMode(label, f, mine, 'refund_date', 'refund_mode');
      const net = mine.reduce((s, l) => s + num(l.debit) - num(l.credit), 0);
      if (!near(net, f.refund_amount)) failures.push(`${label}: ₹${money(f.refund_amount)} but its ledger rows net ₹${money(net)}`);
      for (const a of (allocs.get(num(f.id)) || []).filter(a => num(a.allocated_amount) > PAISA)) {
        const r = mine.filter(l => l.reference_type === 'purchase_return' && num(l.reference_id) === num(a.return_id));
        if (r.length !== 1 || !near(num(r[0].debit) - num(r[0].credit), a.allocated_amount)) failures.push(`${label}: return ${a.return_id} has ₹${money(a.allocated_amount)} but ${r.length} ledger row(s) for it`);
      }
    }
  }

  // Customer refunds
  {
    const refs = await q(`SELECT id, refund_amount, refund_date, refund_mode FROM customer_refunds`);
    const rows = group(await q(`SELECT id, transaction_id, credit, debit, transaction_date, payment_mode FROM customer_ledger WHERE reference_type = 'refund' AND transaction_type IN ('REFUND_PAID', 'REFUND')`), 'transaction_id');
    for (const f of refs) {
      checked++;
      const label = `customer refund ${f.id}`;
      const mine = rows.get(num(f.id)) || [];
      dateMode(label, f, mine, 'refund_date', 'refund_mode');
      if (mine.length !== 1) failures.push(`${label}: ${mine.length} REFUND_PAID rows (expected 1)`);
      else if (!near(num(mine[0].debit) - num(mine[0].credit), f.refund_amount)) failures.push(`${label}: ₹${money(f.refund_amount)} but its ledger row debits ₹${money(num(mine[0].debit) - num(mine[0].credit))}`);
    }
  }
  report('A15', 'each payment and refund posts its own rows: shape, amount, date and mode as the document', failures, checked);
}

/* ------------------------------------------------------------------ A16 */
/**
 * The allocation counters against the allocations (2026-10-04, review C G-03).
 * A14 checks only that each change was logged and the log chains, so a wrong
 * increment that was logged passed. total_allocated is the money in the party's
 * payment allocations; total_refund_allocated is at least what its refunds have
 * allocated (a return marked refunded later may also count an on-account
 * refund against it - owner: direct adjustment - with no allocation row).
 */
async function A16() {
  const q = (sql) => prisma.$queryRawUnsafe(sql);
  const failures = [];
  let checked = 0;
  for (const [side, master, payAlloc, refAlloc] of [
    ['vendor', 'vendor_details',
      `SELECT p.vendor_id AS party, SUM(a.allocated_amount) AS amount FROM payment_allocations a JOIN vendor_payments p ON p.id = a.payment_id GROUP BY p.vendor_id`,
      `SELECT f.vendor_id AS party, SUM(a.allocated_amount) AS amount FROM refund_allocations a JOIN vendor_refunds f ON f.id = a.refund_id GROUP BY f.vendor_id`],
    ['customer', 'customer_details',
      `SELECT p.customer_id AS party, SUM(a.allocated_amount) AS amount FROM customer_payment_allocations a JOIN customer_payments p ON p.id = a.payment_id GROUP BY p.customer_id`,
      `SELECT f.customer_id AS party, SUM(a.allocated_amount) AS amount FROM customer_refund_allocations a JOIN customer_refunds f ON f.id = a.refund_id GROUP BY f.customer_id`]]) {
    const pay = new Map((await q(payAlloc)).map(r => [num(r.party), num(r.amount)]));
    const ref = new Map((await q(refAlloc)).map(r => [num(r.party), num(r.amount)]));
    for (const c of await q(`SELECT id, total_allocated, total_refund_allocated FROM ${master}`)) {
      checked++;
      const id = num(c.id), a = pay.get(id) || 0, r = ref.get(id) || 0;
      if (!near(c.total_allocated, a)) failures.push(`${side} ${id}: total_allocated ₹${money(c.total_allocated)} but its payments' allocations hold ₹${money(a)}`);
      if (num(c.total_refund_allocated) < r - TOL) failures.push(`${side} ${id}: total_refund_allocated ₹${money(c.total_refund_allocated)} but its refunds' allocations hold ₹${money(r)}`);
    }
  }
  report('A16', 'allocation counters: total_allocated is what the payments allocate; total_refund_allocated covers the refunds\' allocations', failures, checked);
}

/* ------------------------------------------------------------------ run */
const ALL = { A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, A13, A14, A15, A16 };

/**
 * Run the chosen assertions (all when none is named) and return the results.
 * `quiet` skips the printing - the test harness runs every assertion after
 * each step it takes.
 */
async function run(ids = [], { quiet = false } = {}) {
  results.length = 0;
  QUIET.on = quiet;
  const want = ids.filter((a) => ALL[a]);
  const chosen = want.length ? want : Object.keys(ALL);

  say(`\nReconciliation — ${chosen.join(' ')}`);
  say('='.repeat(72));

  for (const id of chosen) await ALL[id]();

  const failed = results.filter((r) => r.failures.length > 0);
  const empty = results.filter((r) => r.failures.length === 0 && r.checked === 0);
  say('\n' + '='.repeat(72));
  if (failed.length === 0) {
    say(`ALL CLEAN — ${chosen.length - empty.length} of ${chosen.length} assertions passed.\n`);
  } else {
    say(`${failed.length} of ${chosen.length} assertions FAILING: ${failed.map((f) => f.id).join(', ')}\n`);
  }
  if (empty.length) {
    say(
      `${empty.length} assertion(s) examined NOTHING and prove nothing: ` +
      `${empty.map((e) => e.id).join(', ')}.\n` +
      `  Seed the relevant data before trusting a green run (L-38).\n`
    );
  }
  return results.map((r) => ({ ...r }));
}

module.exports = { run, ALL };

if (require.main === module) {
  (async () => {
    const out = await run(process.argv.slice(2));
    await prisma.$disconnect();
    process.exit(out.some((r) => r.failures.length > 0) ? 1 : 0);
  })().catch(async (e) => {
    console.error('ASSERTION RUN FAILED:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
}
