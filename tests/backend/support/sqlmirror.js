
// Run $queryRawUnsafe / $queryRaw against an in-memory SQLite copy of the memtx store.
// Every table in prisma/schema.prisma is created with all its scalar columns (plus any
// extra column a seeded row carries), so a query never fails on a column no row has.
// Store keys are Prisma accessors (purchaseitems); SQL uses the mapped names (purchase_items).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const SCALAR = new Set(['Int', 'String', 'Decimal', 'Float', 'Boolean', 'DateTime', 'BigInt', 'Json', 'Bytes']);
function schemaTables() {
  if (globalThis.__SCHEMA_TABLES) return globalThis.__SCHEMA_TABLES;
  const text = readFileSync(require('path').join(__dirname, '../../../prisma/schema.prisma'), 'utf8');
  const out = {};
  for (const m of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const model = m[1], body = m[2];
    const map = (body.match(/@@map\("([^"]+)"\)/) || [])[1] || model;
    const cols = [];
    for (const line of body.split('\n')) {
      const f = line.trim().match(/^(\w+)\s+(\w+)(\[\])?(\?)?/);
      if (f && !line.trim().startsWith('@@') && SCALAR.has(f[2]) && !f[3]) cols.push(f[1]);
    }
    out[model[0].toLowerCase() + model.slice(1)] = { table: map, cols };
  }
  return (globalThis.__SCHEMA_TABLES = out);
}
const cell = (v) => (v === undefined ? null : v instanceof Date ? Math.floor(v.getTime() / 1000) : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'bigint' ? Number(v) : v);
const scalar = (v) => v === null || v instanceof Date || ['number', 'string', 'boolean', 'bigint'].includes(typeof v);
export function installSqlMirror(store, alias = {}, hints = {}) {
  globalThis.__raw = async (sql, ...params) => {
    const db = new DatabaseSync(':memory:');
    const schema = schemaTables();
    const made = new Set();
    const make = (table, cols, rows) => {
      const all = Array.from(new Set([...cols, ...rows.flatMap(r => Object.keys(r).filter(k => scalar(r[k])))]));
      if (!all.length) all.push('id');
      db.exec(`CREATE TABLE "${table}" (${all.map(c => `"${c}"`).join(', ')})`);
      if (rows.length) {
        const ins = db.prepare(`INSERT INTO "${table}" (${all.map(c => `"${c}"`).join(', ')}) VALUES (${all.map(() => '?').join(', ')})`);
        for (const r of rows) ins.run(...all.map(c => cell(r[c])));
      }
      made.add(table);
    };
    // Schema tables, with the rows of the accessor and of the mapped name.
    for (const [acc, { table, cols }] of Object.entries(schema)) {
      const rows = [...(Array.isArray(store[acc]) ? store[acc] : []), ...(table !== acc && Array.isArray(store[table]) ? store[table] : [])].filter(r => r && typeof r === 'object');
      make(alias[acc] || table, cols, rows);
    }
    // Anything else seeded under its own name.
    for (const [name, rows] of Object.entries(store)) {
      const table = alias[name] || name;
      if (made.has(table) || schema[name] || !Array.isArray(rows) || !rows.length || typeof rows[0] !== 'object') continue;
      make(table, [], rows);
    }
    for (const [t, cols] of Object.entries(hints)) {
      if (!made.has(t)) { try { make(t, cols, []); } catch {} }
    }
    for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/gi)) {
      try { db.exec(`CREATE TABLE IF NOT EXISTS "${m[1]}" (id)`); } catch {}
    }
    // MySQL null-safe equality.
    const text = sql.replace(/<=>/g, ' IS ');
    const rows = db.prepare(text).all(...params.map(cell));
    db.close();
    return rows;
  };
}
