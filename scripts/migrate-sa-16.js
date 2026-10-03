/**
 * SA-16 / SA-33 - unique sale numbers per financial year, and sale lines tied
 * to their bill.
 *
 *   - UNIQUE(fy, invoice_no) on `invoice` and `invoicex`, as purchase has
 *     (P4-05). The counter reads MAX+1 without a lock, so two saves at once
 *     could take the same number; the index makes that a retry, not a duplicate.
 *   - An index and a foreign key on invoice_items.invoice_no and
 *     invoice_itemsx.invoice_no, which hold the header id. Every per-bill line
 *     lookup was a table scan, and nothing stopped orphan lines.
 *
 * Safe to run more than once. It STOPS, changing nothing further, if it finds
 * duplicate numbers or orphan lines, and prints them.
 *
 * Order: run scripts/repair-sale-data.js --apply first (it fixes the SA-04 fy
 * values that would otherwise show up here as duplicates), then this, then
 *   npx prisma generate
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const q = (sql, ...p) => prisma.$queryRawUnsafe(sql, ...p);
const x = (sql, ...p) => prisma.$executeRawUnsafe(sql, ...p);

async function hasIndex(table, name) {
  const r = await q(`SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`, table, name);
  return Number(r[0].n) > 0;
}
async function hasForeignKey(table, name) {
  const r = await q(`SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`, table, name);
  return Number(r[0].n) > 0;
}

const FAMILIES = [
  { header: 'invoice', items: 'invoice_items', unique: 'invoice_fy_invoice_no', idx: 'idx_invoice_items_invoice_no', fk: 'invoice_items_invoice_fkey' },
  { header: 'invoicex', items: 'invoice_itemsx', unique: 'invoicex_fy_invoice_no', idx: 'idx_invoice_itemsx_invoice_no', fk: 'invoice_itemsx_invoicex_fkey' }
];

(async () => {
  const db = (await q('SELECT DATABASE() AS d'))[0].d;
  console.log(`Database: ${db}`);

  // ---- check everything first, change nothing until all of it is clean
  let blocked = false;
  for (const f of FAMILIES) {
    const dups = await q(`SELECT fy, invoice_no, COUNT(*) AS n, GROUP_CONCAT(id) AS ids FROM ${f.header} GROUP BY fy, invoice_no HAVING COUNT(*) > 1 LIMIT 50`);
    if (dups.length) {
      blocked = true;
      console.log(`\n${f.header}: ${dups.length}+ duplicate (fy, invoice_no):`);
      console.table(dups.map(d => ({ fy: d.fy, invoice_no: d.invoice_no, count: Number(d.n), ids: String(d.ids) })));
    }
    const orphans = await q(`SELECT i.id, i.invoice_no, i.product_id, i.qty FROM ${f.items} i LEFT JOIN ${f.header} h ON h.id = i.invoice_no WHERE h.id IS NULL LIMIT 50`);
    if (orphans.length) {
      blocked = true;
      console.log(`\n${f.items}: ${orphans.length}+ line(s) whose bill does not exist:`);
      console.table(orphans.map(o => ({ id: Number(o.id), bill_id: o.invoice_no, product_id: o.product_id, qty: o.qty })));
    }
  }
  if (blocked) {
    console.log('\nSTOPPED. Nothing changed. For sale duplicates run scripts/repair-sale-data.js (--renumber); orphan lines need a decision by hand.');
    process.exitCode = 1;
    return;
  }

  for (const f of FAMILIES) {
    console.log(`\n- ${f.header}`);
    if (!(await hasIndex(f.header, f.unique))) {
      await x(`ALTER TABLE ${f.header} ADD UNIQUE INDEX ${f.unique} (fy, invoice_no)`);
      console.log('  unique (fy, invoice_no) added');
    } else console.log('  unique index exists');
    if (!(await hasIndex(f.items, f.idx))) {
      await x(`ALTER TABLE ${f.items} ADD INDEX ${f.idx} (invoice_no)`);
      console.log(`  ${f.items} index added`);
    } else console.log(`  ${f.items} index exists`);
    if (!(await hasForeignKey(f.items, f.fk))) {
      await x(`ALTER TABLE ${f.items} ADD CONSTRAINT ${f.fk} FOREIGN KEY (invoice_no) REFERENCES ${f.header}(id) ON DELETE RESTRICT ON UPDATE CASCADE`);
      console.log(`  ${f.items} foreign key added`);
    } else console.log(`  ${f.items} foreign key exists`);
  }
  console.log('\nDONE. Next: npx prisma generate');
})()
  .catch(e => { console.error('\nERROR:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
