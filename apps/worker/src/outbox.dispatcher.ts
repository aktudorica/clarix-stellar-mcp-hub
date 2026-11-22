import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { DatabaseService, AppLogger, redisConnection } from '@clarix/platform';
import { EXECUTION_QUEUE } from '@clarix/application';
import { ExecutionRunner } from './execution.runner.js';

@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly queue = new Queue(EXECUTION_QUEUE, {
    connection: { ...redisConnection(), maxRetriesPerRequest: 1, enableOfflineQueue: false },
  });
  private readonly logger = new AppLogger();
  private interval?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ExecutionRunner) private readonly runner: ExecutionRunner,
  ) {
    this.queue.on('error', () =>
      this.logger.warn('Execution queue unavailable; durable outbox will retry.', 'Outbox'),
    );
  }

  async onApplicationBootstrap() {
    await this.queue.waitUntilReady();
    this.interval = setInterval(() => {
      if (this.running) return;
      this.running = this.dispatch()
        .catch(() =>
          this.logger.warn(
            'Outbox dispatch interrupted; unacknowledged records remain durable.',
            'Outbox',
          ),
        )
        .finally(() => {
          this.running = undefined;
        });
    }, 1000);
  }

  private async dispatch() {
    await this.runner.recoverExpiredLeases();
    await this.recoverUndeliveredExecutions();
    const token = randomUUID();
    const messages = await this.database.client.$transaction(async (tx) => {
      const selected = await tx.$queryRaw<Array<{ id: string; executionId: string }>>`
        SELECT "id", "executionId" FROM "OutboxMessage"
        WHERE "dispatchedAt" IS NULL AND "availableAt" <= NOW()
        AND ("claimedUntil" IS NULL OR "claimedUntil" < NOW())
        ORDER BY "availableAt", "id" LIMIT 10 FOR UPDATE SKIP LOCKED`;
      await tx.outboxMessage.updateMany({
        where: { id: { in: selected.map((message) => message.id) } },
        data: { claimToken: token, claimedUntil: new Date(Date.now() + 30000) },
      });
      return selected;
    });
    for (const message of messages) {
      try {
        await this.queue.add(
          'execute',
          { executionId: message.executionId },
          {
            jobId: message.id,
            attempts: 1,
            removeOnComplete: { age: 86400, count: 1000 },
            removeOnFail: { age: 604800, count: 1000 },
          },
        );
        this.logger.log(
          { executionId: message.executionId, outboxId: message.id },
          'ExecutionDispatched',
        );
        await this.database.client.outboxMessage.updateMany({
          where: { id: message.id, claimToken: token },
          data: { dispatchedAt: new Date(), claimToken: null, claimedUntil: null },
        });
      } catch {
        await this.database.client.outboxMessage.updateMany({
          where: { id: message.id, claimToken: token },
          data: { claimToken: null, claimedUntil: null, availableAt: new Date(Date.now() + 5000) },
        });
        this.logger.warn(`Dispatch deferred for execution ${message.executionId}`, 'Outbox');
      }
    }
  }

  // Recover a delivery acknowledged by the outbox but lost/failed before the worker
  // could claim the execution (for example a transient PostgreSQL outage or Redis loss).
  private async recoverUndeliveredExecutions() {
    await this.database.client.$transaction(async (tx) => {
      const stranded = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT e.id FROM "Execution" e
        WHERE e.status IN ('QUEUED', 'RETRYING') AND e."createdAt" < NOW() - INTERVAL '60 seconds'
          AND NOT EXISTS (SELECT 1 FROM "OutboxMessage" o WHERE o."executionId" = e.id
            AND (o."dispatchedAt" IS NULL OR o."dispatchedAt" > NOW() - INTERVAL '60 seconds'))
        ORDER BY e."createdAt" LIMIT 20 FOR UPDATE OF e SKIP LOCKED`;
      for (const execution of stranded) {
        await tx.outboxMessage.create({ data: { executionId: execution.id } });
        await tx.executionEvent.create({
          data: {
            executionId: execution.id,
            type: 'QUEUED',
            message: 'Queue delivery has not started. A durable redelivery was scheduled.',
          },
        });
      }
    });
  }

  async onModuleDestroy() {
    clearInterval(this.interval);
    await this.running;
    await this.queue.close();
  }
}
