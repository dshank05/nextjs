/**
 * Reconciliation assertions (Phase 4; A7-A10 added 2026-10-03 for the
 * customer side, sale payments, returns and payments / refunds).
 *
 * Run after EVERY step. These are the definition of "the step was clean".
 * Read-only: this script never writes.
 *
 *   node scripts/audit-assert.js            all assertions
 *   node scripts/audit-assert.js A1 A4      only those
 *
 * Exit code 0 if everything passed, 1 otherwise, so it can gate a commit.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TOL = 0.01;
const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const money = (v) => num(v).toFixed(2);
const near = (a, b) => Math.abs(num(a) - num(b)) <= TOL;

const results = [];
function report(id, title, failures, checked) {
  results.push({ id, title, failures, checked });
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
    if (st === 0 && alloc > TOL) {
      failures.push(`purchase ${r.id} (inv ${r.invoice_no}): status Unpaid but ₹${money(alloc)} allocated`);
    } else if (st === 1 && !near(alloc, total)) {
      failures.push(`purchase ${r.id} (inv ${r.invoice_no}): status Paid but allocated ₹${money(alloc)} of ₹${money(total)}`);
    } else if (st === 2 && (alloc <= TOL || alloc >= total - TOL)) {
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
    if (!near(r.total, expected)) {
      failures.push(
        `purchase ${r.id} (inv ${r.invoice_no}): total=${money(r.total)} but items ${money(r.items_total)} ` +
        `+ packing ${money(r.packing_forwarding_total)} + tax ${money(r.total_tax)} = ${money(expected)}`
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
      if (st === 0 && alloc > TOL) failures.push(`${label} ${r.id} (no ${r.invoice_no}): status Unpaid but ₹${money(alloc)} allocated`);
      else if (st === 1 && !near(alloc, total)) failures.push(`${label} ${r.id} (no ${r.invoice_no}): status Paid but allocated ₹${money(alloc)} of ₹${money(total)}`);
      else if (st === 2 && (alloc <= TOL || alloc >= total - TOL)) failures.push(`${label} ${r.id} (no ${r.invoice_no}): status Partial but allocated ₹${money(alloc)} of ₹${money(total)}`);
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
    }
  }
  const cross = [
    [`SELECT a.id, p.customer_id AS owner, b.select_customer AS other FROM customer_payment_allocations a JOIN customer_payments p ON p.id = a.payment_id JOIN invoice b ON b.id = a.invoice_id WHERE a.invoice_id IS NOT NULL AND b.select_customer <> p.customer_id`, 'customer payment allocation (sale)'],
    [`SELECT a.id, p.customer_id AS owner, b.select_customer AS other FROM customer_payment_allocations a JOIN customer_payments p ON p.id = a.payment_id JOIN invoicex b ON b.id = a.invoicex_id WHERE a.invoicex_id IS NOT NULL AND b.select_customer <> p.customer_id`, 'customer payment allocation (Invoice C)'],
    [`SELECT a.id, p.vendor_id AS owner, b.vendor_id AS other FROM payment_allocations a JOIN vendor_payments p ON p.id = a.payment_id JOIN purchase b ON b.id = a.purchase_id WHERE b.vendor_id <> p.vendor_id`, 'vendor payment allocation'],
    [`SELECT a.id, p.vendor_id AS owner, r.vendor_id AS other FROM refund_allocations a JOIN vendor_refunds p ON p.id = a.refund_id JOIN purchase_returns r ON r.id = a.return_id WHERE r.vendor_id <> p.vendor_id`, 'vendor refund allocation']
  ];
  for (const [sql, label] of cross) {
    for (const r of await q(sql)) failures.push(`${label} ${r.id}: party ${r.owner} but the bill / return belongs to ${r.other}`);
  }
  const orphans = [
    [`SELECT a.id FROM customer_payment_allocations a WHERE NOT EXISTS (SELECT 1 FROM customer_payments p WHERE p.id = a.payment_id)`, 'customer payment allocation without its payment'],
    [`SELECT a.id FROM customer_payment_allocations a WHERE a.invoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoice b WHERE b.id = a.invoice_id)`, 'customer payment allocation to a missing sale'],
    [`SELECT a.id FROM customer_payment_allocations a WHERE a.invoicex_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoicex b WHERE b.id = a.invoicex_id)`, 'customer payment allocation to a missing Invoice C bill'],
    [`SELECT a.id FROM payment_allocations a WHERE NOT EXISTS (SELECT 1 FROM vendor_payments p WHERE p.id = a.payment_id)`, 'vendor payment allocation without its payment']
  ];
  for (const [sql, label] of orphans) for (const r of await q(sql)) failures.push(`${label}: ${r.id}`);

  report('A10', 'payments and refunds: allocations fit the amount and the type, same party, no orphans', failures, checked);
}

/* ------------------------------------------------------------------ run */
const ALL = { A1, A2, A3, A4, A5, A6, A7, A8, A9, A10 };

(async () => {
  const want = process.argv.slice(2).filter((a) => ALL[a]);
  const chosen = want.length ? want : Object.keys(ALL);

  console.log(`\nReconciliation — ${chosen.join(' ')}`);
  console.log('='.repeat(72));

  for (const id of chosen) await ALL[id]();

  const failed = results.filter((r) => r.failures.length > 0);
  const empty = results.filter((r) => r.failures.length === 0 && r.checked === 0);
  console.log('\n' + '='.repeat(72));
  if (failed.length === 0) {
    console.log(`ALL CLEAN — ${chosen.length - empty.length} of ${chosen.length} assertions passed.\n`);
  } else {
    console.log(`${failed.length} of ${chosen.length} assertions FAILING: ${failed.map((f) => f.id).join(', ')}\n`);
  }
  if (empty.length) {
    console.log(
      `${empty.length} assertion(s) examined NOTHING and prove nothing: ` +
      `${empty.map((e) => e.id).join(', ')}.\n` +
      `  Seed the relevant data before trusting a green run (L-38).\n`
    );
  }

  await prisma.$disconnect();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('ASSERTION RUN FAILED:', e);
  await prisma.$disconnect();
  process.exit(1);
});
