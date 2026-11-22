import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { DatabaseService, AppLogger } from '@clarix/platform';
import { Prisma } from '@clarix/database';
import { serviceInput } from '@clarix/stellar';

export interface Actor {
  userId: string;
  workspaceId: string;
}
export const EXECUTION_QUEUE = 'service-executions';
export const terminalStates = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);
const versionSelection = { include: { service: { select: { slug: true, name: true } } } } as const;

@Injectable()
export class ExecutionService {
  private readonly logger = new AppLogger();
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async create(
    actor: Actor,
    data: unknown,
    idempotencyKey: string | undefined,
    paidOrderId?: string,
  ) {
    const parsed = serviceInput.safeParse(data);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues.map((issue) => issue.message).join('; '));
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey))
      throw new BadRequestException('A 16–100 character Idempotency-Key is required.');
    if (!paidOrderId && idempotencyKey.startsWith('payment_'))
      throw new BadRequestException('The payment_ idempotency prefix is reserved.');
    const inputFingerprint = createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex');
    const accepted = await this.database.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${actor.workspaceId}::uuid FOR UPDATE`;
      const existing = await tx.execution.findUnique({
        where: { workspaceId_idempotencyKey: { workspaceId: actor.workspaceId, idempotencyKey } },
      });
      if (existing) {
        if (existing.inputFingerprint !== inputFingerprint)
          throw new ConflictException(
            'This idempotency key was already used for a different request.',
          );
        return { id: existing.id, reused: true };
      }
      const paidOrder = paidOrderId
        ? await tx.paymentOrder.findFirst({
            where: {
              id: paidOrderId,
              workspaceId: actor.workspaceId,
              status: 'PAID',
              inputFingerprint,
            },
          })
        : null;
      if (paidOrderId && !paidOrder)
        throw new ForbiddenException('A settled payment for this request is required.');
      if (paidOrder?.executionId) return { id: paidOrder.executionId, reused: true };
      if (!paidOrder && process.env.EXECUTION_ACCESS !== 'internal_preview')
        throw new ForbiddenException('Service execution is not enabled for this deployment.');
      const version = await tx.serviceVersion.findFirst({
        where: {
          ...(paidOrder ? { id: paidOrder.serviceVersionId } : {}),
          service: { slug: parsed.data.service, status: 'ACTIVE' },
        },
        orderBy: { version: 'desc' },
      });
      if (!version) throw new NotFoundException('This service is not enabled.');
      const active = await tx.execution.count({
        where: {
          workspaceId: actor.workspaceId,
          status: { in: ['QUEUED', 'RUNNING', 'RETRYING'] },
        },
      });
      if (active >= 10)
        throw new HttpException('This workspace already has 10 active executions.', 429);
      const execution = await tx.execution.create({
        data: {
          workspaceId: actor.workspaceId,
          createdBy: actor.userId,
          serviceVersionId: version.id,
          idempotencyKey,
          inputFingerprint,
          input: parsed.data.input,
          accessMode: paidOrder ? 'PAID_TESTNET' : 'INTERNAL_PREVIEW',
          events: {
            create: {
              type: 'QUEUED',
              message: paidOrder
                ? 'Testnet payment settled. Analysis accepted.'
                : 'Request validated and accepted for internal preview. No payment is required.',
            },
          },
          outbox: { create: {} },
        },
      });
      if (paidOrder)
        await tx.paymentOrder.update({
          where: { id: paidOrder.id },
          data: { executionId: execution.id },
        });
      return { id: execution.id, reused: false };
    });
    if (!accepted.reused)
      this.logger.log(
        { executionId: accepted.id, workspaceId: actor.workspaceId, service: parsed.data.service },
        'ExecutionAccepted',
      );
    return accepted;
  }

  async get(actor: Actor, id: string) {
    const execution = await this.database.client.execution.findFirst({
      where: { id, workspaceId: actor.workspaceId },
      include: {
        serviceVersion: versionSelection,
        events: { orderBy: { id: 'desc' }, take: 100 },
        attemptRecords: {
          orderBy: { number: 'asc' },
          select: {
            number: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            errorCode: true,
          },
        },
      },
    });
    if (!execution) throw new NotFoundException('Execution not found.');
    const { leaseToken, leaseUntil, idempotencyKey, inputFingerprint, ...publicExecution } =
      execution;
    return {
      ...publicExecution,
      events: execution.events.reverse().map((event) => ({ ...event, id: event.id.toString() })),
    };
  }

  async list(actor: Actor, cursor?: string) {
    const before = cursor
      ? await this.database.client.execution.findFirst({
          where: { id: cursor, workspaceId: actor.workspaceId },
          select: { createdAt: true, id: true },
        })
      : null;
    if (cursor && !before) throw new BadRequestException('Invalid history cursor.');
    const rows = await this.database.client.execution.findMany({
      where: {
        workspaceId: actor.workspaceId,
        ...(before
          ? {
              OR: [
                { createdAt: { lt: before.createdAt } },
                { createdAt: before.createdAt, id: { lt: before.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 21,
      select: {
        id: true,
        status: true,
        input: true,
        createdAt: true,
        finishedAt: true,
        errorMessage: true,
        accessMode: true,
        serviceVersion: versionSelection,
      },
    });
    return { data: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19]!.id : null };
  }

  async cancel(actor: Actor, id: string) {
    return this.database.client.$transaction(async (tx) => {
      const execution = await tx.execution.findFirst({
        where: { id, workspaceId: actor.workspaceId },
      });
      if (!execution) throw new NotFoundException('Execution not found.');
      const updated = await tx.execution.updateMany({
        where: {
          id,
          workspaceId: actor.workspaceId,
          status: { in: ['QUEUED', 'RETRYING', 'RUNNING'] },
        },
        data: { status: 'CANCELLED', finishedAt: new Date(), leaseToken: null, leaseUntil: null },
      });
      if (updated.count) {
        await tx.executionAttempt.updateMany({
          where: { executionId: id, status: 'RUNNING' },
          data: { status: 'CANCELLED', finishedAt: new Date() },
        });
        await tx.executionEvent.create({
          data: {
            executionId: id,
            type: 'CANCELLED',
            message: 'Cancelled by the user. Any in-flight result will be discarded.',
          },
        });
      }
      return { id, cancelled: updated.count > 0 };
    });
  }

  async events(actor: Actor, id: string, after: bigint) {
    const execution = await this.database.client.execution.findFirst({
      where: { id, workspaceId: actor.workspaceId },
      select: { status: true },
    });
    if (!execution) throw new NotFoundException('Execution not found.');
    const events = await this.database.client.executionEvent.findMany({
      where: { executionId: id, id: { gt: after } },
      orderBy: { id: 'asc' },
      take: 100,
    });
    return {
      terminal: terminalStates.has(execution.status),
      events: events.map((event) => ({ ...event, id: event.id.toString() })),
    };
  }
}
