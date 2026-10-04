// Generic in-memory Prisma-ish store: equality, {in}, {not}, OR; numeric increment/decrement.
const match = (row, where = {}) => Object.entries(where).every(([k, v]) => {
  if (v === undefined) return true;
  if (k === 'OR') return v.some(w => match(row, w));
  if (k === 'AND') return v.every(w => match(row, w));
  if (k === 'NOT') return Array.isArray(v) ? !v.some(w => match(row, w)) : !match(row, v);
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('in' in v) return v.in.includes(row[k]);
    // Text filters, case-insensitive like MySQL's default collation.
    const low = (x) => String(x ?? '').toLowerCase();
    if ('contains' in v) return row[k] != null && low(row[k]).includes(low(v.contains));
    if ('startsWith' in v) return row[k] != null && low(row[k]).startsWith(low(v.startsWith));
    if ('endsWith' in v) return row[k] != null && low(row[k]).endsWith(low(v.endsWith));
    if ('equals' in v) return row[k] === v.equals;
    // A relation filter ({ category: { category_name: { contains } } }): match the parent row.
    if (row[k] === undefined && PARENT[k] && !('gte' in v || 'lte' in v || 'gt' in v || 'lt' in v || 'not' in v)) {
      const [t, fk] = PARENT[k]; const parent = (STORE_REF.current?.[t] || []).find(x => x.id === row[fk]);
      return !!parent && match(parent, v);
    }
    // `not` may sit beside a range ({ not: null, gt: 0 }): both must hold.
    if ('not' in v && row[k] === v.not) return false;
    if ('not' in v && !('gte' in v || 'lte' in v || 'gt' in v || 'lt' in v)) return true;
    const F = (x) => (x && typeof x === 'object' && '__field' in x ? row[x.__field] : x);
    if ('gte' in v || 'lte' in v || 'gt' in v || 'lt' in v) { v = { ...v, ...(('gte' in v) ? { gte: F(v.gte) } : {}), ...(('lte' in v) ? { lte: F(v.lte) } : {}), ...(('gt' in v) ? { gt: F(v.gt) } : {}), ...(('lt' in v) ? { lt: F(v.lt) } : {}) }; }
    if ('gte' in v || 'lte' in v || 'gt' in v || 'lt' in v) return (!('gte' in v) || row[k] >= v.gte) && (!('lte' in v) || row[k] <= v.lte) && (!('gt' in v) || row[k] > v.gt) && (!('lt' in v) || row[k] < v.lt);
    return true;
  }
  return row[k] === v;
});

// Relations for include/select: parent (row[fk] -> table.id) and children (table[fk] = row.id).
const STORE_REF = { current: null };
const PARENT = { category: ['product_category', 'category_id'], warehouse: ['warehouse', 'warehouse_id'], vendor: ['vendor_details', 'vendor_id'], customer: ['customer_details', 'customer_id'], mechanic: ['mechanic', 'mechanic_id'],
  staff: ['staff', 'staff_id'], invoice: ['invoice', 'invoice_id'], invoicex: ['invoicex', 'invoicex_id'], purchase: ['purchase', 'purchase_id'],
  category_ref: ['product_category', 'product_category_id'], product_company_ref: ['company', 'company_id'], product: ['product', 'product_id'],
  sale_return: ['sale_returns', 'sale_return_id'], salex_return: ['salex_returns', 'salex_return_id'], return: ['purchase_returns', 'return_id'],
  reason: ['return_reasons', 'return_reason_id'], purchase_item: ['purchase_items', 'purchase_item_id'] };
const ALLOC_REL = { vendor_payments: ['payment_allocations', 'payment_id'], customer_payments: ['customer_payment_allocations', 'payment_id'], customer_refunds: ['customer_refund_allocations', 'refund_id'], vendor_refunds: ['refund_allocations', 'refund_id'] };
const CHILD = { 'purchase_returns.items': ['purchase_return_items', 'purchase_return_id'] };
function resolveRel(store, table, row, key, spec) {
  const TP = { 'customer_payment_allocations.payment': ['customer_payments', 'payment_id'], 'payment_allocations.payment': ['vendor_payments', 'payment_id'], 'customer_refund_allocations.refund': ['customer_refunds', 'refund_id'], 'refund_allocations.refund': ['vendor_refunds', 'refund_id'] }[`${table}.${key}`];
  if (TP) return (store[TP[0]] || []).find(x => x.id === row[TP[1]]) ?? null;
  if (CHILD[`${table}.${key}`]) { const [t, fk] = CHILD[`${table}.${key}`]; return (store[t] || []).filter(c => c[fk] === row.id); }
  if (PARENT[key]) { const [t, fk] = PARENT[key]; const fkv = row[fk] ?? (key === 'customer' ? row.select_customer : undefined); const hit = (store[t] || store[t.replace(/s$/, '')] || []).find(x => x.id === fkv); return hit ?? null; }
  return row[key];
}
const copy1 = (x) => (x && typeof x === 'object' && !(x instanceof Date) ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Array.isArray(v) ? v.map(e => (e && typeof e === 'object' && !(e instanceof Date) ? { ...e } : e)) : v && typeof v === 'object' && !(v instanceof Date) ? { ...v } : v])) : x);
const copy = (v) => (Array.isArray(v) ? v.map(copy1) : copy1(v));
export function makeTx(store, log) {
  STORE_REF.current = store;
  const table = (name) => {
    if (!store[name]) store[name] = [];
    const rows = () => store[name];
    const nextId = () => Math.max(999, ...rows().map(r => (typeof r.id === 'number' ? r.id : 0))) + 1;
    const t = {
      fields: new Proxy({}, { get: (_, f) => ({ __field: f }) }),
      findMany: async ({ where, select, orderBy, skip, take, include } = {}) => { log.push([name, 'findMany', where]); let r = rows().filter(x => match(x, where));
        if (orderBy) { const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).map(o => Object.entries(o)[0]).map(([k, d]) => (d && typeof d === 'object' && PARENT[k]) ? (() => { const [rk, rd] = Object.entries(d)[0]; const [t, fk] = PARENT[k]; r = r.map(x => ({ ...x, ['__rel_' + k]: ((store[t] || []).find(p => p.id === x[fk]) || {})[rk] })); return ['__rel_' + k, rd]; })() : [k, d]); r = [...r].sort((a, b) => { for (const [k, d] of keys) { if (a[k] < b[k]) return d === 'asc' ? -1 : 1; if (a[k] > b[k]) return d === 'asc' ? 1 : -1; } return 0; }); }
        if (skip) r = r.slice(skip); if (take !== undefined) r = r.slice(0, take); const REL = ALLOC_REL;
        if (select) r = r.map(x => Object.fromEntries(Object.keys(select).filter(k => select[k]).map(k => [k, k === 'allocations' && REL[name] ? (store[REL[name][0]] || []).filter(a => a[REL[name][1]] === x.id) : (typeof select[k] === 'object' ? resolveRel(store, name, x, k, select[k]) : x[k])])));
        else if (include) { const inc = include; r = r.map(x => { const o = { ...x }; for (const k of Object.keys(inc)) if (k !== 'allocations' || !REL[name]) o[k] = resolveRel(store, name, x, k, inc[k]); else { const sub = inc[k] && (inc[k].include || inc[k].select); const [allocTable, allocFk] = REL[name]; o[k] = (store[allocTable] || []).filter(a => a[allocFk] === x.id).map(a => { if (!sub) return a; const ao = { ...a }; for (const kk of Object.keys(sub)) if (typeof sub[kk] === 'object') ao[kk] = resolveRel(store, allocTable, a, kk, sub[kk]); return ao; }); } return o; }); }
        return r; },
      findFirst: async function (args = {}) { return (args.orderBy || args.select || args.include) ? ((await this.findMany({ ...args, take: 1 }))[0] || null) : (rows().find(x => match(x, args.where)) || null); },
      findUnique: async ({ where, include, select }) => { const x = rows().find(x => match(x, where)) || null; if (!x || (!include && !select)) return x; const one = store[name]; store[name] = [x]; try { return (await table(name).findMany({ include, select }))[0]; } finally { store[name] = one; } },
      count: async ({ where } = {}) => rows().filter(x => match(x, where)).length,
      deleteMany: async ({ where } = {}) => { log.push([name, 'deleteMany', where]); const before = rows().length; store[name] = rows().filter(x => !match(x, where)); return { count: before - store[name].length }; },
      delete: async ({ where }) => { log.push([name, 'delete', where]); const i = rows().findIndex(x => match(x, where)); if (i < 0) throw new Error(`${name}.delete: not found ${JSON.stringify(where)}`); return rows().splice(i, 1)[0]; },
      update: async ({ where, data }) => { const r = rows().find(x => match(x, where)); if (!r) { log.push([name, 'update-missing', where]); return {}; } for (const [k, v] of Object.entries(data)) { if (v === undefined) continue; if (v && typeof v === 'object' && ('connect' in v || 'disconnect' in v)) continue; if (v && typeof v === 'object' && ('increment' in v || 'decrement' in v)) r[k] = (r[k] || 0) + (v.increment || 0) - (v.decrement || 0); else r[k] = v; } return r; },
      updateMany: async ({ where, data }) => { let n = 0; for (const r of rows().filter(x => match(x, where))) { n++; for (const [k, v] of Object.entries(data)) if (v !== undefined) r[k] = v; } return { count: n }; },
      upsert: async ({ where, update, create }) => { const key = where.invoice_no_fy || where; const r = rows().find(x => match(x, key)); if (r) { for (const [k, v] of Object.entries(update)) if (v !== undefined) r[k] = v; return r; } const n = { id: rows().length + 1000, ...create }; rows().push(n); return n; },
      create: async ({ data }) => { const d = {}; for (const [k, v] of Object.entries(data)) { if (v && typeof v === 'object' && !Array.isArray(v) && 'connect' in v) d[k + '_id'] = v.connect.id; else d[k] = v; } const r = { id: nextId(), ...d }; rows().push(r); return r; },
      createMany: async ({ data }) => { for (const d of data) rows().push({ id: nextId(), ...d }); return { count: data.length }; },
      aggregate: async ({ where, _sum }) => { const r = rows().filter(x => match(x, where)); return { _sum: Object.fromEntries(Object.keys(_sum || {}).map(k => [k, r.reduce((a, x) => a + (x[k] || 0), 0)])) }; }, groupBy: async ({ by, where, _sum, _count } = {}) => { const g = new Map(); for (const x of rows().filter(x => match(x, where))) { const k = JSON.stringify(by.map(b => x[b])); if (!g.has(k)) g.set(k, []); g.get(k).push(x); } return Array.from(g.values()).map(list => ({ ...Object.fromEntries(by.map(b => [b, list[0][b]])), ...(_sum ? { _sum: Object.fromEntries(Object.keys(_sum).map(f => [f, list.reduce((a, x) => a + (Number(x[f]) || 0), 0)])) } : {}), ...(_count ? { _count: Object.fromEntries(Object.keys(_count).map(f => [f, list.length])) } : {}) })); },
    };
    // Prisma hands back fresh objects: code that reads a row, updates it and then uses
    // the value it read must see the old value here too (2026-10-03).
    for (const m of ['findMany', 'findFirst', 'findUnique', 'create', 'update', 'upsert', 'delete']) {
      const f = t[m];
      if (f) t[m] = async function (...a) { return copy(await f.apply(t, a)); };
    }
    return t;
  };
  return new Proxy({}, { get: (_, name) => (name === 'then' ? undefined : table(name)) });
}
