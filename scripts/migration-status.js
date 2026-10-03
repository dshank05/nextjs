/**
 * Which database changes have been run, and which are still to do.
 * READ ONLY - it changes nothing.
 *
 *   node scripts/migration-status.js
 *
 * Checks, in the order they should be run:
 *   P4-11  scripts/migrate-p4-11.js     purchase lines and bill_to point at purchase.id
 *   SA-04 / SA-34  scripts/repair-sale-data.js --apply   sale fy values, customer ledger columns
 *   SA-16  scripts/migrate-sa-16.js     unique sale numbers per year, sale lines tied to bills
 *   prisma generate                     the generated client matches prisma/schema.prisma
 * and then every column prisma/schema.prisma names, against the database.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const q = (sql, ...p) => prisma.$queryRawUnsafe(sql, ...p);
const num = (v) => Number(v || 0);

async function column(table, col) {
  const r = await q(`SELECT IS_NULLABLE AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, table, col);
  return r.length ? { nullable: r[0].n === 'YES' } : null;
}
async function index(table, name) {
  const r = await q(`SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`, table, name);
  return num(r[0].n) > 0;
}
async function foreignKey(table, name) {
  const r = await q(`SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`, table, name);
  return num(r[0].n) > 0;
}

const results = [];
function report(step, done, detail) {
  results.push({ step, status: done ? 'done' : 'TO RUN', detail });
}

/** Model -> table and its scalar columns, read from prisma/schema.prisma. */
function schemaColumns(file) {
  const text = fs.readFileSync(file, 'utf8');
  const scalar = new Set(['Int', 'String', 'Float', 'Boolean', 'DateTime', 'Decimal', 'BigInt', 'Json', 'Bytes']);
  const enums = new Set([...text.matchAll(/^enum\s+(\w+)/gm)].map(m => m[1]));
  const out = [];
  for (const m of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const body = m[2];
    const table = (body.match(/@@map\("([^"]+)"\)/) || [])[1] || m[1];
    const cols = [];
    for (const line of body.split(/\r?\n/)) {
      const f = line.replace(/\/\/.*$/, '').trim().match(/^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/);
      if (!f || f[3] || !(scalar.has(f[2]) || enums.has(f[2]))) continue;
      cols.push((f[5].match(/@map\("([^"]+)"\)/) || [])[1] || f[1]);
    }
    out.push({ model: m[1], table, cols });
  }
  return out;
}

const normalise = (file) => fs.readFileSync(file, 'utf8').split(/\r?\n/)
  .map(l => l.replace(/\/\/.*$/, '').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');

(async () => {
  const db = (await q('SELECT DATABASE() AS d'))[0].d;
  console.log(`Database: ${db}   (read only)\n`);

  // ---- P4-11
  const pi = await column('purchase_items', 'purchase_id');
  const bt = await column('bill_to', 'purchase_id');
  const p411 = !!pi && !pi.nullable && !!bt && await index('purchase_items', 'idx_purchase_items_purchase_id') &&
    await foreignKey('purchase_items', 'purchase_items_purchase_fkey') && await foreignKey('bill_to', 'bill_to_purchase_fkey');
  report('P4-11  node scripts/migrate-p4-11.js', p411,
    !pi ? 'purchase_items.purchase_id is missing - purchases, purchase returns and reports will fail' :
    p411 ? 'purchase_id, index and foreign keys in place' : 'started but not finished - run it again');

  // ---- repair-sale-data (SA-04, SA-34)
  const years = new Set((await q('SELECT id FROM financial_year')).map(r => num(r.id)));
  const badFy = (await q('SELECT fy FROM invoice')).filter(r => !years.has(num(r.fy))).length;
  const badFyX = (await q('SELECT fy FROM invoicex')).filter(r => !years.has(num(r.fy))).length;
  const wrongCol = num((await q(
    `SELECT COUNT(*) AS n FROM customer_ledger
      WHERE (transaction_type = 'PAYMENT_RECEIVED' AND debit > 0)
         OR (transaction_type IN ('REFUND', 'REFUND_PAID') AND credit > 0)`))[0].n);
  report('SA-04/SA-34  node scripts/repair-sale-data.js --apply', badFy + badFyX + wrongCol === 0,
    `${badFy} sale(s) and ${badFyX} Invoice C bill(s) with a wrong fy; ${wrongCol} customer ledger row(s) in the wrong column`);

  // ---- SA-16
  const sa16 = {
    'unique sale no per year': await index('invoice', 'invoice_fy_invoice_no'),
    'unique Invoice C no per year': await index('invoicex', 'invoicex_fy_invoice_no'),
    'sale lines index': await index('invoice_items', 'idx_invoice_items_invoice_no'),
    'sale lines foreign key': await foreignKey('invoice_items', 'invoice_items_invoice_fkey'),
    'Invoice C lines index': await index('invoice_itemsx', 'idx_invoice_itemsx_invoice_no'),
    'Invoice C lines foreign key': await foreignKey('invoice_itemsx', 'invoice_itemsx_invoicex_fkey')
  };
  const missing16 = Object.entries(sa16).filter(([, v]) => !v).map(([k]) => k);
  report('SA-16  node scripts/migrate-sa-16.js', missing16.length === 0,
    missing16.length ? `missing: ${missing16.join(', ')} (the app works; two saves at once can still take the same number)` : 'in place');

  // ---- generated client
  const root = path.join(__dirname, '..');
  const generated = path.join(root, 'node_modules', '.prisma', 'client', 'schema.prisma');
  const current = path.join(root, 'prisma', 'schema.prisma');
  const same = fs.existsSync(generated) && normalise(generated) === normalise(current);
  report('npx prisma generate', same, same ? 'client matches prisma/schema.prisma' : 'client is older than prisma/schema.prisma');

  // ---- every column the schema names
  const have = new Map();
  for (const r of await q(`SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`)) {
    if (!have.has(r.t)) have.set(r.t, new Set());
    have.get(r.t).add(r.c);
  }
  const drift = [];
  for (const m of schemaColumns(current)) {
    const cols = have.get(m.table);
    if (!cols) { drift.push(`table ${m.table} (model ${m.model}) is missing`); continue; }
    for (const c of m.cols) if (!cols.has(c)) drift.push(`${m.table}.${c} is missing`);
  }
  report('schema vs database', drift.length === 0, drift.length ? `${drift.length} missing - listed below` : 'every table and column exists');

  console.table(results);
  if (drift.length) console.log('\nMissing from the database:\n  ' + drift.join('\n  '));
})()
  .catch(e => { console.error('\nERROR:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
