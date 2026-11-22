import { betterAuth } from 'better-auth';
import { prismaAdapter } from '@better-auth/prisma-adapter';
import * as argon2 from 'argon2';
import type { Prisma, PrismaClient } from '@clarix/database';

export function authSecret() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error('BETTER_AUTH_SECRET must have at least 32 characters.');
  return secret;
}

export function createAuth(database: PrismaClient | Prisma.TransactionClient, transaction = true) {
  return betterAuth({
    appName: 'Clarix Agent Hub',
    secret: authSecret(),
    baseURL: process.env.AUTH_BASE_URL ?? 'http://localhost:4311',
    basePath: '/api/auth',
    trustedOrigins: (process.env.APP_ORIGINS ?? '').split(',').filter(Boolean),
    database: prismaAdapter(database, { provider: 'postgresql', transaction }),
    advanced: {
      database: { generateId: 'uuid' },
      cookiePrefix: 'clarix',
      useSecureCookies: process.env.SESSION_COOKIE_SECURE !== 'false',
    },
    session: {
      modelName: 'authSession',
      expiresIn: 8 * 60 * 60,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    account: { modelName: 'authAccount' },
    verification: { modelName: 'authVerification' },
    emailAndPassword: {
      enabled: true,
      disableSignUp: process.env.ALLOW_REGISTRATION !== 'true',
      minPasswordLength: 12,
      maxPasswordLength: 128,
      password: { hash: hashPassword, verify: verifyPassword },
    },
  });
}

function hashPassword(password: string) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

async function verifyPassword({ hash, password }: { hash: string; password: string }) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
