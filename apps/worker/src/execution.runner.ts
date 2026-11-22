import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService, AppLogger } from '@clarix/platform';
import { Prisma } from '@clarix/database';
import { AnalysisError, StellarReader, serviceInput } from '@clarix/stellar';

@Injectable()
export class ExecutionRunner {
  private readonly reader = new StellarReader();
  private readonly logger = new AppLogger();
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async execute(executionId: string) {
    const token = randomUUID();
    const execution = await this.database.client.$transaction(async (tx) => {
      const claimed = await tx.execution.updateMany({
        where: { id: executionId, status: { in: ['QUEUED', 'RETRYING'] }, attempts: { lt: 3 } },
        data: {
          status: 'RUNNING',
          leaseToken: token,
          leaseUntil: new Date(Date.now() + 60000),
          startedAt: new Date(),
          attempts: { increment: 1 },
          errorCode: null,
          errorMessage: null,
        },
      });
      if (!claimed.count) return null;
      const current = await tx.execution.findUniqueOrThrow({
        where: { id: executionId },
        include: { serviceVersion: { include: { service: true } } },
      });
      await tx.executionAttempt.create({
        data: { executionId, number: current.attempts, leaseToken: token },
      });
      await tx.executionEvent.create({
        data: {
          executionId,
          type: 'RUNNING',
          message: `Attempt ${current.attempts}: collecting source data from Stellar testnet.`,
        },
      });
      return current;
    });
    if (!execution) return;
    this.logger.log(
      { executionId, attempt: execution.attempts, service: execution.serviceVersion.service.slug },
      'ExecutionStarted',
    );
    let renewing = false;
    const renew = setInterval(async () => {
      if (renewing) return;
      renewing = true;
      try {
        await this.database.client.execution.updateMany({
          where: {
            id: executionId,
            leaseToken: token,
            status: 'RUNNING',
            leaseUntil: { gt: new Date() },
          },
          data: { leaseUntil: new Date(Date.now() + 60000) },
        });
      } catch {
        this.logger.warn(`Lease renewal failed for execution ${executionId}`, 'Execution');
      } finally {
        renewing = false;
      }
    }, 10000);
    try {
      const expectedImplementation = `stellar/${execution.serviceVersion.service.slug}@1`;
      if (execution.serviceVersion.implementation !== expectedImplementation)
        throw new AnalysisError(
          'UNSUPPORTED_VERSION',
          'This service version is not supported by the current worker.',
        );
      const input = serviceInput.parse({
        service: execution.serviceVersion.service.slug,
        input: execution.input,
      });
      const report = await this.reader.analyze(input);
      await this.database.client.$transaction(async (tx) => {
        const updated = await tx.execution.updateMany({
          where: {
            id: executionId,
            leaseToken: token,
            status: 'RUNNING',
            leaseUntil: { gt: new Date() },
          },
          data: {
            status: 'SUCCEEDED',
            result: report as Prisma.InputJsonValue,
            finishedAt: new Date(),
            leaseToken: null,
            leaseUntil: null,
          },
        });
        if (!updated.count) return;
        await tx.executionAttempt.update({
          where: { leaseToken: token },
          data: { status: 'SUCCEEDED', finishedAt: new Date() },
        });
        await tx.executionEvent.create({
          data: {
            executionId,
            type: 'SUCCEEDED',
            message: 'Analysis completed. The report and source evidence are saved.',
          },
        });
      });
    } catch (error) {
      const failure =
        error instanceof AnalysisError
          ? error
          : new AnalysisError('EXECUTION_FAILED', 'Analysis could not be completed safely.');
      const retry = failure.retryable && execution.attempts < 3;
      await this.database.client.$transaction(async (tx) => {
        const updated = await tx.execution.updateMany({
          where: {
            id: executionId,
            leaseToken: token,
            status: 'RUNNING',
            leaseUntil: { gt: new Date() },
          },
          data: {
            status: retry ? 'RETRYING' : 'FAILED',
            errorCode: failure.code,
            errorMessage: failure.message,
            finishedAt: retry ? null : new Date(),
            leaseToken: null,
            leaseUntil: null,
          },
        });
        if (!updated.count) return;
        await tx.executionAttempt.update({
          where: { leaseToken: token },
          data: { status: 'FAILED', errorCode: failure.code, finishedAt: new Date() },
        });
        await tx.executionEvent.create({
          data: { executionId, type: retry ? 'RETRYING' : 'FAILED', message: failure.message },
        });
        if (retry)
          await tx.outboxMessage.create({
            data: {
              executionId,
              availableAt: new Date(Date.now() + 1000 * 2 ** execution.attempts),
            },
          });
      });
    } finally {
      clearInterval(renew);
    }
  }

  async recoverExpiredLeases() {
    const expired = await this.database.client.execution.findMany({
      where: { status: 'RUNNING', leaseUntil: { lt: new Date() } },
      take: 20,
    });
    for (const execution of expired) {
      await this.database.client.$transaction(async (tx) => {
        const retry = execution.attempts < 3;
        const updated = await tx.execution.updateMany({
          where: {
            id: execution.id,
            leaseToken: execution.leaseToken,
            status: 'RUNNING',
            leaseUntil: { lt: new Date() },
          },
          data: {
            status: retry ? 'RETRYING' : 'FAILED',
            leaseToken: null,
            leaseUntil: null,
            errorCode: 'WORKER_INTERRUPTED',
            errorMessage: 'The worker stopped before saving a result.',
            finishedAt: retry ? null : new Date(),
          },
        });
        if (!updated.count) return;
        await tx.executionAttempt.updateMany({
          where: { executionId: execution.id, status: 'RUNNING' },
          data: { status: 'INTERRUPTED', finishedAt: new Date(), errorCode: 'WORKER_INTERRUPTED' },
        });
        await tx.executionEvent.create({
          data: {
            executionId: execution.id,
            type: retry ? 'RETRYING' : 'FAILED',
            message: retry
              ? 'Worker interruption detected. Execution queued for recovery.'
              : 'The maximum execution attempts were exhausted.',
          },
        });
        if (retry) await tx.outboxMessage.create({ data: { executionId: execution.id } });
      });
    }
  }
}
