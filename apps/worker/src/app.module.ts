import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PlatformModule, PROBE_QUEUE, redisConnection } from '@clarix/platform';
import { ProbeProcessor } from './probe.processor.js';
import { EXECUTION_QUEUE } from '@clarix/application';
import { ExecutionRunner } from './execution.runner.js';
import { ExecutionProcessor } from './execution.processor.js';
import { OutboxDispatcher } from './outbox.dispatcher.js';

@Module({
  imports: [
    PlatformModule,
    BullModule.forRoot({ connection: redisConnection() }),
    BullModule.registerQueue({ name: PROBE_QUEUE }),
    BullModule.registerQueue({ name: EXECUTION_QUEUE }),
  ],
  providers: [ProbeProcessor, ExecutionRunner, ExecutionProcessor, OutboxDispatcher],
})
export class WorkerModule {}
