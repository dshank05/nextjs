import { PrismaClient } from '@prisma/client';

/**
 * The shared Prisma client.
 *
 * Everything that used to sit alongside it here is gone (D-13, D-14, D-15,
 * D-16). It was a query tracker feeding `/api/debug/query-stats`, and it had
 * never worked: the `{ emit: 'event', level: 'query' }` line that would have
 * fired the `$on('query')` handler was commented out, so `queryTracker` was
 * always empty and the endpoint always answered `totalQueries: 0`. Dead
 * machinery behind a live route that advertised a feature it did not have - and
 * the route returned raw SQL text to any signed-in user, in an app with no role
 * checks (F-05).
 *
 * The tracker also carried a trap for whoever re-enabled it: its cleanup loop
 * walked the entire map on **every single query** to expire old entries.
 *
 * If query timings are wanted again, `withObservability` already wraps every
 * route and is the right place for them.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: [
      { emit: 'stdout', level: 'error' },
      { emit: 'stdout', level: 'warn' },
    ],
  });

// Reuse one client across hot reloads in development, where each reload would
// otherwise leak a connection pool. Assigned through the same typed reference it
// is read from - it used to be read from `globalForPrisma.prisma` and written to
// an untyped `global.prisma` (D-16).
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
