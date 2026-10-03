/**
 * P4-11 - point purchase lines and the billing snapshot at the purchase by id.
 *
 * purchase_items and bill_to found their purchase by (invoice_no, fy). The
 * printed number restarts every financial year, so every query that forgot
 * the fy reached other years' bills - the cause of F-08, L-1, L-19 and the
 * PU-01 delete bug. Sale already stores the header id; this brings purchase
 * in line.
 *
 * Safe to run more than once. Each step checks whether it is already done.
 * It STOPS, changing nothing further, if any line or snapshot cannot be
 * matched to exactly one purchase - and prints those rows.
 *
 *   node scripts/migrate-p4-11.js          (uses DATABASE_URL from .env)
 *   npx prisma generate                    (afterwards - the schema now has purchase_id)
 *
 * Run it on the test database first. Back up before running it on live.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const q = (sql, ...p) => prisma.$queryRawUnsafe(sql, ...p);
const x = (sql, ...p) => prisma.$executeRawUnsafe(sql, ...p);

async function hasColumn(table, column) {
  const r = await q(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, table, column);
  return Number(r[0].n) > 0;
}
async function isNullable(table, column) {
  const r = await q(`SELECT IS_NULLABLE AS v FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, table, column);
  return r[0]?.v === 'YES';
}
async function hasIndex(table, name) {
  const r = await q(`SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`, table, name);
  return Number(r[0].n) > 0;
}
async function hasForeignKey(table, name) {
  const r = await q(`SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`, table, name);
  return Number(r[0].n) > 0;
}
const step = (s) => console.log(`\n- ${s}`);

(async () => {
  const db = (await q('SELECT DATABASE() AS d'))[0].d;
  console.log(`Database: ${db}`);

  // ---------------- purchase_items ----------------
  step('purchase_items.purchase_id');
  if (!(await hasColumn('purchase_items', 'purchase_id'))) {
    await x('ALTER TABLE purchase_items ADD COLUMN purchase_id INT NULL AFTER id');
    console.log('  column added');
  } else console.log('  column exists');

  const linked = await x(`UPDATE purchase_items i JOIN purchase p ON p.invoice_no = i.invoice_no AND p.fy = i.fy
                          SET i.purchase_id = p.id WHERE i.purchase_id IS NULL`);
  console.log(`  ${linked} line(s) linked by (invoice_no, fy)`);

  const orphanLines = await q('SELECT id, invoice_no, fy, product_id, qty FROM purchase_items WHERE purchase_id IS NULL LIMIT 50');
  if (orphanLines.length) {
    console.log(`\nSTOPPED: ${orphanLines.length}+ purchase line(s) match no purchase. Nothing further changed.`);
    console.table(orphanLines.map(r => ({ ...r, id: Number(r.id) })));
    process.exitCode = 1;
    return;
  }

  // ---------------- bill_to ----------------
  step('bill_to.purchase_id');
  if (!(await hasColumn('bill_to', 'purchase_id'))) {
    await x('ALTER TABLE bill_to ADD COLUMN purchase_id INT NULL AFTER id');
    console.log('  column added');
  } else console.log('  column exists');

  const linkedSnap = await x(`UPDATE bill_to b JOIN purchase p ON p.invoice_no = b.invoice_no AND p.fy = b.fy
                              SET b.purchase_id = p.id WHERE b.purchase_id IS NULL`);
  console.log(`  ${linkedSnap} snapshot(s) linked by (invoice_no, fy)`);
  // Rows from before bill_to had fy (L-19): match only when the number is unambiguous.
  const linkedOld = await x(`UPDATE bill_to b
                               JOIN (SELECT invoice_no, MIN(id) AS id FROM purchase GROUP BY invoice_no HAVING COUNT(*) = 1) p
                                 ON p.invoice_no = b.invoice_no
                             SET b.purchase_id = p.id WHERE b.purchase_id IS NULL AND b.fy IS NULL`);
  if (linkedOld) console.log(`  ${linkedOld} snapshot(s) without fy linked by a unique invoice number`);

  const orphanSnaps = await q('SELECT id, invoice_no, fy, vendor_name FROM bill_to WHERE purchase_id IS NULL LIMIT 50');
  const dupSnaps = await q('SELECT purchase_id, COUNT(*) AS n FROM bill_to WHERE purchase_id IS NOT NULL GROUP BY purchase_id HAVING COUNT(*) > 1 LIMIT 50');
  if (orphanSnaps.length || dupSnaps.length) {
    console.log('\nSTOPPED: billing snapshots that cannot be keyed by purchase. Nothing further changed.');
    if (orphanSnaps.length) { console.log('match no purchase:'); console.table(orphanSnaps.map(r => ({ ...r, id: Number(r.id) }))); }
    if (dupSnaps.length) { console.log('more than one per purchase:'); console.table(dupSnaps.map(r => ({ purchase_id: r.purchase_id, n: Number(r.n) }))); }
    process.exitCode = 1;
    return;
  }

  // ---------------- constraints ----------------
  step('constraints');
  if (await isNullable('purchase_items', 'purchase_id')) {
    await x('ALTER TABLE purchase_items MODIFY purchase_id INT NOT NULL');
    console.log('  purchase_items.purchase_id NOT NULL');
  }
  if (!(await hasIndex('purchase_items', 'idx_purchase_items_purchase_id'))) {
    await x('ALTER TABLE purchase_items ADD INDEX idx_purchase_items_purchase_id (purchase_id)');
    console.log('  purchase_items index added');
  }
  if (!(await hasForeignKey('purchase_items', 'purchase_items_purchase_fkey'))) {
    await x('ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_purchase_fkey FOREIGN KEY (purchase_id) REFERENCES purchase(id) ON DELETE RESTRICT ON UPDATE CASCADE');
    console.log('  purchase_items foreign key added');
  }
  if (await isNullable('bill_to', 'purchase_id')) {
    await x('ALTER TABLE bill_to MODIFY purchase_id INT NOT NULL');
    console.log('  bill_to.purchase_id NOT NULL');
  }
  if (!(await hasIndex('bill_to', 'bill_to_purchase_id'))) {
    await x('ALTER TABLE bill_to ADD UNIQUE INDEX bill_to_purchase_id (purchase_id)');
    console.log('  bill_to unique index added');
  }
  if (!(await hasForeignKey('bill_to', 'bill_to_purchase_fkey'))) {
    await x('ALTER TABLE bill_to ADD CONSTRAINT bill_to_purchase_fkey FOREIGN KEY (purchase_id) REFERENCES purchase(id) ON DELETE RESTRICT ON UPDATE CASCADE');
    console.log('  bill_to foreign key added');
  }

  const [lines, snaps] = await Promise.all([
    q('SELECT COUNT(*) AS n FROM purchase_items'),
    q('SELECT COUNT(*) AS n FROM bill_to')
  ]);
  console.log(`\nDONE. ${Number(lines[0].n)} purchase lines and ${Number(snaps[0].n)} billing snapshots keyed by purchase_id.`);
  console.log('Next: npx prisma generate');
})()
  .catch(e => { console.error('\nERROR:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
