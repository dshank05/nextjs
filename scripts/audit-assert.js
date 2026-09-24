/**
 * Phase 4 audit — reconciliation assertions.
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
 * Orphans. Catches L-2 directly: a bill_to row keyed to an invoice number no
 * purchase carries means the billing snapshot was written with the wrong
 * number.
 */
async function A6() {
  const failures = [];

  const orphanItems = await prisma.$queryRaw`
    SELECT pi.id, pi.invoice_no, pi.fy FROM purchase_items pi
    WHERE NOT EXISTS (SELECT 1 FROM purchase p WHERE p.invoice_no = pi.invoice_no AND p.fy = pi.fy)`;
  for (const r of orphanItems) {
    failures.push(`purchase_items ${r.id}: invoice_no ${r.invoice_no} fy ${r.fy} matches no purchase`);
  }

  const orphanBillTo = await prisma.$queryRaw`
    SELECT b.id, b.invoice_no, b.fy, b.vendor_name FROM bill_to b
    WHERE b.invoice_no IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM purchase p WHERE p.invoice_no = b.invoice_no AND p.fy <=> b.fy)`;
  for (const r of orphanBillTo) {
    failures.push(`bill_to ${r.id}: invoice_no ${r.invoice_no} fy ${r.fy} ("${r.vendor_name}") matches no purchase — L-2/L-19`);
  }

  // Joined on invoice_no AND fy. Joining on the number alone reported the
  // legitimate case - the same bill number reused in a later financial year -
  // as a fault. The real F-08 condition is two purchases sharing a number
  // WITHIN one financial year, which is what the fixed lookups now scope to.
  const sharedItems = await prisma.$queryRaw`
    SELECT pi.invoice_no, pi.fy, COUNT(DISTINCT p.id) c
    FROM purchase_items pi JOIN purchase p ON p.invoice_no = pi.invoice_no AND p.fy = pi.fy
    GROUP BY pi.invoice_no, pi.fy HAVING c > 1`;
  for (const r of sharedItems) {
    failures.push(`invoice_no ${r.invoice_no} fy ${r.fy}: items reachable from ${r.c} purchases — F-08`);
  }

  const orphanAlloc = await prisma.$queryRaw`
    SELECT pa.id, pa.purchase_id FROM payment_allocations pa
    WHERE NOT EXISTS (SELECT 1 FROM purchase p WHERE p.id = pa.purchase_id)`;
  for (const r of orphanAlloc) failures.push(`payment_allocations ${r.id}: purchase ${r.purchase_id} is gone`);

  report('A6', 'no orphaned items, billing snapshots or allocations', failures, 4);
}

/* ------------------------------------------------------------------ run */
const ALL = { A1, A2, A3, A4, A5, A6 };

(async () => {
  const want = process.argv.slice(2).filter((a) => ALL[a]);
  const chosen = want.length ? want : Object.keys(ALL);

  console.log(`\nPhase 4 reconciliation — ${chosen.join(' ')}`);
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
