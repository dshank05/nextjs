import { PrismaClient, Prisma } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'stdout', level: 'error' },
      { emit: 'stdout', level: 'warn' },
    ],
  });

if (process.env.NODE_ENV !== 'production') global.prisma = prisma;

// Prisma Query Observability
prisma.$on('query' as never, (e: Prisma.QueryEvent) => {
  console.log(
    `🧩 Query: ${e.query}\n⏱️ Duration: ${e.duration}ms\nParams: ${e.params}\n`
  );
});
