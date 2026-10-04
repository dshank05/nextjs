import { prisma } from './dbstub.js';
export class PrismaClient { constructor() { return new Proxy({}, { get: (_, k) => k === '$disconnect' ? async () => {} : prisma[k] }); } }
