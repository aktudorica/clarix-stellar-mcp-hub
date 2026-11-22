import { Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job, UnrecoverableError } from 'bullmq';
import { EXECUTION_QUEUE } from '@clarix/application';
import { ExecutionRunner } from './execution.runner.js';

@Processor(EXECUTION_QUEUE, { concurrency: 2 })
export class ExecutionProcessor extends WorkerHost {
  constructor(@Inject(ExecutionRunner) private readonly runner: ExecutionRunner) {
    super();
  }
  async process(job: Job<{ executionId: string }>) {
    if (job.name !== 'execute' || !/^[a-f0-9-]{36}$/i.test(job.data?.executionId ?? ''))
      throw new UnrecoverableError('Invalid execution job');
    await this.runner.execute(job.data.executionId);
  }
}
