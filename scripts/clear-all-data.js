/**
 * Clear ALL transactional data, keeping master/config data intact.
 *
 * Supersedes running clear-test-data.js + clear-sale-data.js +
 * clear-salex-data.js one after another. Those three remain useful for
 * clearing one side only; this one is for resetting the whole system.
 *
 * Beyond what the three cover, this also handles:
 *   - note_counters      (otherwise credit/debit note numbering never restarts)
 *   - vendor_balance_logs / customer_balance_logs (orphaned audit trail)
 *   - incexp / incexpx   (income/expense rows outliving their invoices)
 *   - transport_details  (the purchase-side script misses it)
 *   - product.latest_purchase_rate / last_purchase_date, which otherwise point
 *     at purchases that no longer exist
 *   - product.opening_stock, set to the current stock so that stock
 *     reconciliation has a valid baseline (see below)
 *
 * THE STOCK BASELINE MATTERS. Reconciliation is
 *   stock == opening_stock + purchases - sales - salex + sale returns - purchase returns
 * With every movement deleted, current stock IS the opening balance by
 * definition. Setting it here is the one moment that equation is guaranteed
 * true, and it is what makes stock bugs detectable afterwards. Only 135 of 602
 * products currently have opening_stock set, which is why that check fails
 * today for reasons unrelated to any code defect.
 *
 *   node scripts/clear-all-data.js            # dry run - shows what it would do
 *   node scripts/clear-all-data.js --apply    # actually do it
 *   node scripts/clear-all-data.js --apply --keep-parties   # keep customer/vendor rows
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const KEEP_PARTIES = process.argv.includes('--keep-parties');

/**
 * Delete order. Children before parents so foreign keys never block a delete.
 * Raw table names, because a few of these have no Prisma model mapping.
 */
const DELETE_ORDER = [
  // allocations first - they reference payments, refunds and documents
  'customer_payment_allocations',
  'customer_refund_allocations',
  'payment_allocations',
  'refund_allocations',

  // return line items, then return headers
  'sale_return_items',
  'salex_return_items',
  'purchase_return_items',
  'sale_returns',
  'salex_returns',
  'purchase_returns',

  // document line items
  'invoice_items',
  'invoice_itemsx',
  'purchase_items',

  // per-document party/address/transport snapshots
  'bill_to',
  'bill_tosales',
  'bill_tosalesx',
  'shipto',
  'shiptox',
  'transport_details',
  'transport_detailsx',

  // income / expense attached to documents
  'incexp',
  'incexpx',

  // document headers
  'invoice',
  'invoicex',
  'purchase',

  // money movements
  'customer_payments',
  'customer_refunds',
  'vendor_payments',
  'vendor_refunds',

  // ledgers and their audit logs
  'customer_ledger',
  'vendor_ledger',
  'customer_balance_logs',
  'vendor_balance_logs',

  // counters - so numbering restarts from 1
  'note_counters',

  // deadstock references products but is transactional
  'deadstock',
];

/** Deleted only when --keep-parties is NOT passed. */
const PARTY_TABLES = ['customer_details', 'vendor_details'];

/** Never touched. Listed explicitly so the intent is auditable. */
const PRESERVED = [
  'product', 'product_category', 'product_subcategory', 'product_company',
  'car_models', 'states', 'settings', 'financial_year', 'user', 'adminu',
  'business_details', 'bank_details', 'warehouse', 'warehouse_racks',
  'staff', 'mechanic', 'return_reasons', 'gst_tax_rate', 'migration',
];

const PARTY_BALANCE_RESET = {
  total_paid: 0,
  total_allocated: 0,
  total_refunded: 0,
  total_refund_allocated: 0,
  account_balance: 0,
};

async function count(table) {
  try {
    const r = await prisma.$queryRawUnsafe('SELECT COUNT(*) c FROM `' + table + '`');
    return Number(r[0].c);
  } catch {
    return null; // table does not exist in this schema
  }
}

async function main() {
  const db = (await prisma.$queryRaw`SELECT DATABASE() AS db`)[0].db;

  console.log('='.repeat(64));
  console.log(APPLY ? 'CLEARING ALL TRANSACTIONAL DATA' : 'DRY RUN - nothing will be changed');
  console.log('database: ' + db);
  console.log('='.repeat(64) + '\n');

  const targets = [...DELETE_ORDER, ...(KEEP_PARTIES ? [] : PARTY_TABLES)];

  console.log('WILL DELETE');
  let total = 0;
  for (const t of targets) {
    const c = await count(t);
    if (c === null) { console.log('  ' + t.padEnd(34) + '     - (no such table)'); continue; }
    total += c;
    console.log('  ' + t.padEnd(34) + String(c).padStart(6) + ' rows');
  }
  console.log('  ' + '-'.repeat(46));
  console.log('  ' + 'TOTAL'.padEnd(34) + String(total).padStart(6) + ' rows\n');

  const productCount = await count('product');
  console.log('WILL RESET (not delete)');
  console.log(`  product.opening_stock = stock         ${productCount} products (stock baseline)`);
  console.log(`  product.latest_purchase_rate = NULL   ${productCount} products`);
  console.log(`  product.last_purchase_date = NULL     ${productCount} products`);
  if (KEEP_PARTIES) {
    console.log(`  customer_details balances -> 0        ${await count('customer_details')} customers`);
    console.log(`  vendor_details balances -> 0          ${await count('vendor_details')} vendors`);
  }
  console.log('');

  console.log('PRESERVED');
  for (const t of PRESERVED) {
    const c = await count(t);
    if (c === null) continue;
    console.log('  ' + t.padEnd(34) + String(c).padStart(6) + ' rows');
  }
  console.log('');

  if (!APPLY) {
    console.log('='.repeat(64));
    console.log('Dry run only. Re-run with --apply to execute.');
    console.log('Take a backup first:  node scripts/db-backup.js');
    console.log('='.repeat(64));
    return;
  }

  console.log('='.repeat(64));
  console.log('APPLYING\n');

  // FK checks are disabled for the duration so the delete order cannot bite us
  // on tables whose constraints are not what the schema implies.
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
  try {
    for (const t of targets) {
      const before = await count(t);
      if (before === null) continue;
      if (before === 0) { console.log('  ' + t.padEnd(34) + 'already empty'); continue; }
      await prisma.$executeRawUnsafe('DELETE FROM `' + t + '`');
      try {
        await prisma.$executeRawUnsafe('ALTER TABLE `' + t + '` AUTO_INCREMENT = 1');
      } catch { /* no auto-increment column */ }
      console.log('  ' + t.padEnd(34) + 'deleted ' + before + ' rows');
    }

    // Stock baseline: with no movements left, current stock IS the opening stock.
    await prisma.$executeRawUnsafe(
      'UPDATE product SET opening_stock = COALESCE(stock, 0), stock = COALESCE(stock, 0), ' +
      'latest_purchase_rate = NULL, last_purchase_date = NULL'
    );
    console.log('  ' + 'product (stock baseline + derived)'.padEnd(34) + 'reset ' + productCount + ' rows');

    if (KEEP_PARTIES) {
      const c = await prisma.customer_details.updateMany({ data: PARTY_BALANCE_RESET });
      const v = await prisma.vendor_details.updateMany({ data: PARTY_BALANCE_RESET });
      console.log('  ' + 'customer_details balances'.padEnd(34) + 'reset ' + c.count + ' rows');
      console.log('  ' + 'vendor_details balances'.padEnd(34) + 'reset ' + v.count + ' rows');
    }
  } finally {
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
  }

  // --- verify the result ---------------------------------------------------
  console.log('\n' + '='.repeat(64));
  console.log('VERIFYING\n');

  let leftovers = 0;
  for (const t of targets) {
    const c = await count(t);
    if (c === null) continue;
    if (c !== 0) { console.log('  NOT EMPTY: ' + t + ' still has ' + c + ' rows'); leftovers++; }
  }
  console.log(leftovers === 0 ? '  all target tables empty' : `  ${leftovers} table(s) not fully cleared`);

  const bad = await prisma.$queryRaw`
    SELECT COUNT(*) c FROM product WHERE COALESCE(opening_stock,0) <> COALESCE(stock,0)`;
  console.log(
    Number(bad[0].c) === 0
      ? '  stock baseline valid: opening_stock == stock for every product'
      : `  WARNING: ${Number(bad[0].c)} products where opening_stock != stock`
  );

  const fy = await prisma.$queryRaw`
    SELECT s.currentfy, f.fy FROM settings s LEFT JOIN financial_year f ON f.id = s.currentfy`;
  console.log(`  current financial year: id=${fy[0].currentfy} (${fy[0].fy || 'MISSING'})`);

  const rates = await count('gst_tax_rate');
  if (rates === 0) console.log('  NOTE: gst_tax_rate is empty - seed rates before testing tax');

  console.log('\n' + '='.repeat(64));
  console.log('DONE');
  console.log('='.repeat(64));
}

main()
  .catch((e) => {
    console.error('\nFAILED:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
