import {
  Global,
  Injectable,
  Module,
  type LoggerService,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createDatabase } from '@clarix/database';
import { Redis } from 'ioredis';
import { pino } from 'pino';

export const PROBE_QUEUE = 'system-probes';
export const WORKER_HEARTBEAT = 'clarix:worker:heartbeat';

export function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://redis:6379');
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:')
    throw new Error('Unsupported Redis protocol');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly client = createDatabase();
  async onModuleInit() {
    await this.client.$connect();
  }
  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client = new Redis({
    ...redisConnection(),
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    commandTimeout: 3000,
  });
  constructor() {
    this.client.on('error', () => {
      /* Health checks expose connectivity; credentials are never logged. */
    });
  }
  async onModuleDestroy() {
    this.client.disconnect();
  }
}

export class AppLogger implements LoggerService {
  private readonly logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'secret',
      'token',
      'databaseUrl',
    ],
    base: { service: process.env.SERVICE_NAME ?? 'clarix' },
  });
  log(message: unknown, context?: string) {
    if (message !== null && typeof message === 'object') this.logger.info({ ...message, context });
    else this.logger.info({ context }, String(message));
  }
  error(message: unknown, stack?: string, context?: string) {
    this.logger.error({ context, stack }, String(message));
  }
  warn(message: unknown, context?: string) {
    this.logger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string) {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string) {
    this.logger.trace({ context }, String(message));
  }
  fatal(message: unknown, context?: string) {
    this.logger.fatal({ context }, String(message));
  }
}

@Global()
@Module({ providers: [DatabaseService, RedisService], exports: [DatabaseService, RedisService] })
export class PlatformModule {}
