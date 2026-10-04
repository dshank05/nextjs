import { makeTx } from './memtx.js';
export const store = globalThis.__STORE = globalThis.__STORE || {};
export const log = globalThis.__LOG = globalThis.__LOG || [];
const base = makeTx(store, log);
export const prisma = new Proxy({}, { get: (_, name) => {
  if (name === '$transaction') return async (fn) => fn(prisma);
  if (name === '$queryRawUnsafe') return (...a) => globalThis.__raw(...a);
  if (name === '$queryRaw') return (strings, ...vals) => globalThis.__raw(Array.isArray(strings) ? strings.join('?') : strings, ...vals);
  if (name === 'then') return undefined;
  return base[name];
} });
export default prisma;
