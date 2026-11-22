import { hostname } from 'node:os';
import { writeFile, rm } from 'node:fs/promises';
import { Inject, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job, UnrecoverableError } from 'bullmq';
import {
  DatabaseService,
  RedisService,
  PROBE_QUEUE,
  WORKER_HEARTBEAT,
  AppLogger,
} from '@clarix/platform';

@Processor(PROBE_QUEUE, { concurrency: 2 })
export class ProbeProcessor extends WorkerHost implements OnApplicationBootstrap, OnModuleDestroy {
  private heartbeat?: ReturnType<typeof setInterval>;
  private readonly logger = new AppLogger();
  private checking = false;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {
    super();
  }

  async process(job: Job<{ probeId: string }>) {
    if (
      job.name !== 'verify-stack' ||
      typeof job.data?.probeId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        job.data.probeId,
      )
    ) {
      throw new UnrecoverableError('Invalid system probe');
    }
    // An identical job can be delivered more than once. The database record is unique.
    const probe = await this.database.client.systemProbe.upsert({
      where: { id: job.data.probeId },
      update: {},
      create: { id: job.data.probeId, workerId: hostname() },
    });
    return { id: probe.id, completedAt: probe.completedAt.toISOString() };
  }

  async onApplicationBootstrap() {
    await this.worker.waitUntilReady();
    await this.publishHeartbeat();
    this.heartbeat = setInterval(() => {
      void this.publishHeartbeat();
    }, 5000);
  }

  private async publishHeartbeat() {
    if (this.checking) return;
    this.checking = true;
    try {
      if (!this.worker.isRunning()) throw new Error('Worker not running');
      await this.database.client.$queryRaw`SELECT 1`;
      await this.redis.client.set(WORKER_HEARTBEAT, hostname(), 'EX', 20);
      await writeFile('/tmp/clarix-worker-heartbeat', String(Date.now()), { mode: 0o600 });
    } catch {
      this.logger.warn('Worker dependency check failed', 'Worker');
    } finally {
      this.checking = false;
    }
  }

  async onModuleDestroy() {
    clearInterval(this.heartbeat);
    await rm('/tmp/clarix-worker-heartbeat', { force: true });
  }
}
