import { agentConfiguration } from '../integrations/agent.service.js';
import { paymentConfiguration } from '../integrations/payment.service.js';
import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService, RedisService, WORKER_HEARTBEAT } from '@clarix/platform';
import type { SystemStatus } from '@clarix/contracts';

@Injectable()
export class StatusService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async getStatus(): Promise<SystemStatus> {
    const results = await Promise.allSettled([
      this.database.client.$queryRaw`SELECT 1`,
      this.redis.client.ping(),
      this.redis.client.get(WORKER_HEARTBEAT),
    ]);
    const worker = results[2];
    const checks: SystemStatus['checks'] = {
      database: { status: results[0].status === 'fulfilled' ? 'up' : 'down' },
      redis: {
        status: results[1].status === 'fulfilled' && results[1].value === 'PONG' ? 'up' : 'down',
      },
      worker: { status: worker.status === 'fulfilled' && worker.value !== null ? 'up' : 'down' },
    };
    return {
      status: Object.values(checks).every((check) => check.status === 'up') ? 'ready' : 'degraded',
      version: '0.1.0',
      network: 'stellar:testnet',
      checkedAt: new Date().toISOString(),
      checks,
      features: {
        mcp: true,
        payments: paymentConfiguration().enabled,
        agent: agentConfiguration().enabled,
        execution: process.env.EXECUTION_ACCESS === 'internal_preview',
      },
    };
  }
}
