import { PrismaClient, Prisma } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Query deduplication for analysis
const queryTracker = new Map<string, { count: number; totalDuration: number; lastSeen: number }>();

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: [
      // { emit: 'event', level: 'query' }, // DISABLED for clean analysis
      { emit: 'stdout', level: 'error' },
      { emit: 'stdout', level: 'warn' },
    ],
  });

if (process.env.NODE_ENV !== 'production') global.prisma = prisma;

// Temporarily disable query logging for clean analysis
prisma.$on('query' as never, (e: Prisma.QueryEvent) => {
  // Query logging disabled - use /api/debug/query-stats for analysis
  // Update stats silently
  const queryKey = `${e.query}|${e.params}`;

  if (queryTracker.has(queryKey)) {
    const stats = queryTracker.get(queryKey)!;
    stats.count++;
    stats.totalDuration += e.duration;
    stats.lastSeen = Date.now();
  } else {
    queryTracker.set(queryKey, {
      count: 1,
      totalDuration: e.duration,
      lastSeen: Date.now()
    });
  }

  // Clean up old entries (older than 30 seconds)
  const now = Date.now();
  for (const [key, stats] of Array.from(queryTracker.entries())) {
    if (now - stats.lastSeen > 30000) {
      queryTracker.delete(key);
    }
  }
});

// Function to get query statistics
export function getQueryStats() {
  const stats = Array.from(queryTracker.entries()).map(([queryKey, data]) => {
    const [query, params] = queryKey.split('|');
    return {
      query,
      params,
      count: data.count,
      avgDuration: data.totalDuration / data.count,
      totalDuration: data.totalDuration
    };
  });

  return stats.sort((a, b) => b.count - a.count); // Sort by frequency
}
