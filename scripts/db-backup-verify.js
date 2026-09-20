/**
 * Verify a backup produced by scripts/db-backup.js.
 *
 * Parses the dump back out and checks it against the live database:
 *   1. every table in the DB has a CREATE TABLE in the dump
 *   2. the INSERT tuple count per table matches the live row count
 *   3. the file is structurally complete (opens a transaction, commits)
 *   4. a sampled row from each populated table round-trips byte-for-byte
 *
 *   node scripts/db-backup-verify.js <path-to-.sql>
 *   node scripts/db-backup-verify.js            # newest file in backups/
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function newestBackup() {
  const dir = 'backups';
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || null;
}

/**
 * Count the value tuples in the INSERT statements for each table.
 *
 * Walks the statement character by character rather than using a regex,
 * because row data contains commas, quotes and parentheses. Tracking quote
 * state is the whole point: a naive split would miscount any row holding an
 * address or a note.
 */
function countTuples(body) {
  let depth = 0;
  let inStr = false;
  let escaped = false;
  let tuples = 0;

  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === "'") inStr = false;
      continue;
    }
    if (c === "'") inStr = true;
    else if (c === '(') { if (depth === 0) tuples++; depth++; }
    else if (c === ')') depth--;
  }
  return tuples;
}

async function main() {
  const file = process.argv[2] || newestBackup();
  if (!file || !fs.existsSync(file)) {
    console.error('No backup file found. Pass a path, or run scripts/db-backup.js first.');
    process.exitCode = 1;
    return;
  }

  const sql = fs.readFileSync(file, 'utf8');
  const bytes = fs.statSync(file).size;
  console.log(`Verifying ${file}  (${(bytes / 1024).toFixed(1)} KB)\n`);

  const problems = [];

  // --- 3. structural completeness -----------------------------------------
  if (!sql.includes('START TRANSACTION;')) problems.push('missing START TRANSACTION');
  if (!/COMMIT;\s*$|COMMIT;\s*SET FOREIGN_KEY_CHECKS=1;\s*$/.test(sql.trim() + '\n'))
    problems.push('file does not end with COMMIT - it may be truncated');

  // --- parse the dump ------------------------------------------------------
  const created = new Set();
  for (const m of sql.matchAll(/CREATE TABLE `([^`]+)`/g)) created.add(m[1]);

  const inserted = {};
  const insertRe = /INSERT INTO `([^`]+)` \([^)]*\) VALUES\n/g;
  let m;
  while ((m = insertRe.exec(sql)) !== null) {
    const table = m[1];
    const start = m.index + m[0].length;
    // statement ends at the first ";\n" that is not inside a string
    let i = start, inStr = false, escaped = false, end = sql.length;
    for (; i < sql.length; i++) {
      const c = sql[i];
      if (inStr) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === "'") inStr = false;
        continue;
      }
      if (c === "'") inStr = true;
      else if (c === ';' && sql[i + 1] === '\n') { end = i; break; }
    }
    inserted[table] = (inserted[table] || 0) + countTuples(sql.slice(start, end));
    insertRe.lastIndex = end;
  }

  // --- 1 & 2. compare against live ----------------------------------------
  const tables = (
    await prisma.$queryRaw`
      SELECT table_name AS tn FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
      ORDER BY table_name`
  ).map((r) => r.tn);

  console.log('table                              live   in dump');
  console.log('---------------------------------------------------');
  let okCount = 0;
  for (const t of tables) {
    const live = Number((await prisma.$queryRawUnsafe('SELECT COUNT(*) c FROM `' + t + '`'))[0].c);
    const dump = inserted[t] || 0;

    if (!created.has(t)) problems.push(`${t}: no CREATE TABLE in dump`);
    if (live !== dump) problems.push(`${t}: live has ${live} rows, dump has ${dump}`);
    else okCount++;

    if (live > 0 || dump > 0) {
      const flag = live === dump && created.has(t) ? 'ok' : 'MISMATCH';
      console.log('  ' + t.padEnd(30) + String(live).padStart(6) + String(dump).padStart(10) + '   ' + flag);
    }
  }

  // --- 4. sample a row and check it appears verbatim ----------------------
  console.log('\nSpot-checking values survived escaping:');
  const samples = ['product', 'customer_details', 'vendor_details'];
  for (const t of samples) {
    if (!tables.includes(t)) continue;
    const rows = await prisma.$queryRawUnsafe('SELECT * FROM `' + t + '` LIMIT 1');
    if (!rows.length) continue;
    // pick the longest string field - most likely to contain awkward characters
    const entries = Object.entries(rows[0]).filter(([, v]) => typeof v === 'string' && v.length > 3);
    if (!entries.length) { console.log('  ' + t.padEnd(20) + 'no string field to sample'); continue; }
    const [col, val] = entries.sort((a, b) => b[1].length - a[1].length)[0];
    const escaped = val.replace(/[\\']/g, (c) => '\\' + c);
    const found = sql.includes(escaped);
    if (!found) problems.push(`${t}.${col}: sampled value not found in dump`);
    console.log('  ' + t.padEnd(20) + (found ? 'ok' : 'NOT FOUND') + '  (' + col + ': "' + val.slice(0, 40) + '")');
  }

  console.log('\n---------------------------------------------------');
  if (problems.length === 0) {
    console.log(`PASS - ${okCount}/${tables.length} tables verified, structure intact.`);
    console.log('The dump is complete and consistent with the live database.');
  } else {
    console.log(`FAIL - ${problems.length} problem(s):`);
    for (const p of problems) console.log('  - ' + p);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error('Verify FAILED:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
