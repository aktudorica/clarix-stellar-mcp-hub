import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export function createDatabase(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const adapter = new PrismaPg({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  return new PrismaClient({ adapter });
}

export { PrismaClient } from './generated/prisma/client.js';
export { Prisma } from './generated/prisma/client.js';

export { ExecutionStatus } from './generated/prisma/enums.js';
