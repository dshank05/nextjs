/**
 * Database backup — writes a restorable .sql dump of the current database.
 *
 * Exists because mysqldump is not available on this machine. Produces the same
 * shape of output: DROP/CREATE for each table, then batched INSERTs, wrapped in
 * a transaction with FK checks disabled so table order does not matter.
 *
 *   node scripts/db-backup.js                  -> backups/backup-<db>-<timestamp>.sql
 *   node scripts/db-backup.js --out my.sql     -> a specific path
 *   node scripts/db-backup.js --data-only      -> skip DROP/CREATE, INSERTs only
 *
 * Restore with:
 *   mysql -h <host> -u <user> -p <db> < backups/backup-....sql
 * or by importing the file through phpMyAdmin.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const dataOnly = args.includes('--data-only');
const outFlag = args.indexOf('--out');
const ROWS_PER_INSERT = 200;

/** Quote a value as a MySQL literal. */
function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (Buffer.isBuffer(value)) return '0x' + value.toString('hex');
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return 'NULL';
    return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  }
  if (typeof value === 'object') return escapeString(JSON.stringify(value));
  return escapeString(String(value));
}

function escapeString(s) {
  return `'${s.replace(/[\0\b\t\n\r\x1a\\'"]/g, (c) => ({
    '\0': '\\0', '\b': '\\b', '\t': '\\t', '\n': '\\n',
    '\r': '\\r', '\x1a': '\\Z', '\\': '\\\\', "'": "\\'", '"': '\\"',
  }[c]))}'`;
}

async function main() {
  const dbRow = await prisma.$queryRaw`SELECT DATABASE() AS db`;
  const dbName = dbRow[0].db;

  const outPath =
    outFlag !== -1 && args[outFlag + 1]
      ? args[outFlag + 1]
      : path.join(
          'backups',
          `backup-${dbName}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.sql`
        );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const out = fs.createWriteStream(outPath, { encoding: 'utf8' });
  const write = (s) => new Promise((res) => out.write(s, res));

  const tables = (
    await prisma.$queryRaw`
      SELECT table_name AS tn FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
      ORDER BY table_name`
  ).map((r) => r.tn);

  await write(
    `-- Backup of \`${dbName}\`\n` +
      `-- Taken ${new Date().toISOString()}\n` +
      `-- ${tables.length} tables\n\n` +
      `SET FOREIGN_KEY_CHECKS=0;\nSET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\nSTART TRANSACTION;\n\n`
  );

  let grandTotal = 0;
  const summary = [];

  for (const table of tables) {
    const q = '`' + table + '`';

    if (!dataOnly) {
      const ddl = await prisma.$queryRawUnsafe(`SHOW CREATE TABLE ${q}`);
      const createSql = ddl[0]['Create Table'] || ddl[0]['Create View'];
      await write(`--\n-- ${table}\n--\nDROP TABLE IF EXISTS ${q};\n${createSql};\n\n`);
    }

    const countRow = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS c FROM ${q}`);
    const count = Number(countRow[0].c);
    grandTotal += count;
    summary.push([table, count]);

    if (count === 0) continue;

    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM ${q}`);
    const cols = Object.keys(rows[0]);
    const colList = cols.map((c) => '`' + c + '`').join(', ');

    for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
      const chunk = rows.slice(i, i + ROWS_PER_INSERT);
      const values = chunk
        .map((r) => '(' + cols.map((c) => literal(r[c])).join(', ') + ')')
        .join(',\n  ');
      await write(`INSERT INTO ${q} (${colList}) VALUES\n  ${values};\n`);
    }
    await write('\n');
  }

  await write(`COMMIT;\nSET FOREIGN_KEY_CHECKS=1;\n`);
  await new Promise((res) => out.end(res));

  const bytes = fs.statSync(outPath).size;
  console.log(`\nBackup written: ${outPath}`);
  console.log(`  ${tables.length} tables, ${grandTotal} rows, ${(bytes / 1024).toFixed(1)} KB\n`);
  for (const [t, c] of summary.filter((x) => x[1] > 0)) {
    console.log('  ' + t.padEnd(32) + String(c).padStart(6));
  }
}

main()
  .catch((e) => {
    console.error('Backup FAILED:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
