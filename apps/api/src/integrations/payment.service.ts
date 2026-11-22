import { createHash } from 'node:crypto';
import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '@clarix/platform';
import { Prisma } from '@clarix/database';
import { ExecutionService, type Actor } from '@clarix/application';
import { serviceInput } from '@clarix/stellar';
import { x402ResourceServer, ExpressAdapter } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactStellarScheme } from '@x402/stellar/exact/server';
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http';
import type { PaymentRequirements, PaymentPayload, SettleResponse } from '@x402/core/types';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';

export function paymentConfiguration() {
  return {
    enabled:
      process.env.X402_ENABLED === 'true' &&
      Boolean(process.env.X402_PAY_TO && process.env.OZ_API_KEY),
    network: 'stellar:testnet',
    price: process.env.X402_PRICE_USDC || '0.01',
  };
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (key) => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key]),
        )
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}

@Injectable()
export class PaymentService {
  private initialization?: Promise<x402ResourceServer>;
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ExecutionService) private readonly executions: ExecutionService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private async resourceServer() {
    if (!paymentConfiguration().enabled)
      throw new ServiceUnavailableException('Testnet payments are not configured.');
    if (!this.initialization)
      this.initialization = this.initialize().catch((error) => {
        this.initialization = undefined;
        throw error;
      });
    return this.initialization;
  }

  private async initialize() {
    const facilitator = new HTTPFacilitatorClient({
      url: 'https://channels.openzeppelin.com/x402/testnet',
      timeoutMs: 20000,
      createAuthHeaders: async () => {
        const headers = { Authorization: `Bearer ${process.env.OZ_API_KEY}` };
        return { verify: headers, settle: headers, supported: headers };
      },
    });
    const server = new x402ResourceServer(facilitator).register(
      'stellar:testnet',
      new ExactStellarScheme(),
    );
    await server.initialize();
    return server;
  }

  async quote(actor: Actor, body: unknown, key: string | undefined) {
    const parsed = serviceInput.safeParse(body);
    if (!parsed.success || !key || !/^[A-Za-z0-9_-]{16,100}$/.test(key))
      throw new BadRequestException('A valid analysis request and Idempotency-Key are required.');
    await this.auth.throttle(`quote:${actor.workspaceId}`, 20, 60);
    const fingerprint = createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex');
    const existing = await this.database.client.paymentOrder.findUnique({
      where: {
        workspaceId_idempotencyKey: { workspaceId: actor.workspaceId, idempotencyKey: key },
      },
    });
    if (existing) {
      if (existing.inputFingerprint !== fingerprint)
        throw new ConflictException('Idempotency key already used for another request.');
      return this.view(existing);
    }
    const server = await this.resourceServer();
    const price = paymentConfiguration().price;
    if (!/^0\.(?:0[1-9]|[1-9][0-9]?)$/.test(price))
      throw new ServiceUnavailableException(
        'Testnet price must be between 0.01 and 0.99 USDC, with at most two decimals.',
      );
    const requirements = await server.buildPaymentRequirements({
      scheme: 'exact',
      network: 'stellar:testnet',
      price,
      payTo: process.env.X402_PAY_TO!,
      maxTimeoutSeconds: 120,
    });
    if (requirements.length !== 1)
      throw new ServiceUnavailableException('Facilitator does not support the configured payment.');
    return this.database.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${actor.workspaceId}::uuid FOR UPDATE`;
      const duplicate = await tx.paymentOrder.findUnique({
        where: {
          workspaceId_idempotencyKey: { workspaceId: actor.workspaceId, idempotencyKey: key },
        },
      });
      if (duplicate) {
        if (duplicate.inputFingerprint !== fingerprint)
          throw new ConflictException('Idempotency key already used.');
        return this.view(duplicate);
      }
      if (
        await tx.paymentOrder.count({
          where: { workspaceId: actor.workspaceId, status: { in: ['SETTLING', 'UNKNOWN'] } },
        })
      )
        throw new ConflictException(
          'A previous payment is awaiting reconciliation. Do not pay again.',
        );
      const version = await tx.serviceVersion.findFirst({
        where: { service: { slug: parsed.data.service, status: 'ACTIVE' } },
        orderBy: { version: 'desc' },
      });
      if (!version) throw new NotFoundException('Service unavailable.');
      return this.view(
        await tx.paymentOrder.create({
          data: {
            workspaceId: actor.workspaceId,
            createdBy: actor.userId,
            serviceVersionId: version.id,
            request: json(parsed.data),
            inputFingerprint: fingerprint,
            idempotencyKey: key,
            requirement: json(requirements[0]),
            expiresAt: new Date(Date.now() + 600000),
          },
        }),
      );
    });
  }

  async list(actor: Actor) {
    const orders = await this.database.client.paymentOrder.findMany({
      where: { workspaceId: actor.workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { data: orders.map((order) => this.view(order)) };
  }

  async get(actor: Actor, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Payment not found.');
    const order = await this.database.client.paymentOrder.findFirst({
      where: { id, workspaceId: actor.workspaceId },
    });
    if (!order) throw new NotFoundException('Payment not found.');
    return order;
  }

  view(order: {
    id: string;
    status: string;
    expiresAt: Date;
    requirement: unknown;
    request: unknown;
    executionId: string | null;
    transactionHash: string | null;
  }) {
    return {
      id: order.id,
      status: order.status,
      expiresAt: order.expiresAt,
      requirement: order.requirement,
      request: order.request,
      executionId: order.executionId,
      transactionHash: order.transactionHash,
    };
  }

  async pay(actor: Actor, id: string, request: Request, response: Response) {
    const order = await this.get(actor, id);
    if (order.status === 'PAID') {
      const execution = await this.executions.create(
        actor,
        order.request,
        `payment_${order.id}`,
        order.id,
      );
      if (order.settlement)
        response.setHeader(
          'PAYMENT-RESPONSE',
          encodePaymentResponseHeader(order.settlement as unknown as SettleResponse),
        );
      return execution;
    }
    if (order.status !== 'QUOTED')
      throw new ConflictException(
        'Payment is pending, failed, or uncertain. Check its status; do not submit another payment.',
      );
    if (order.expiresAt <= new Date())
      throw new ConflictException('Quote expired. Request a new quote before signing.');
    const server = await this.resourceServer();
    const requirement = order.requirement as unknown as PaymentRequirements;
    const header = new ExpressAdapter(request).getHeader('payment-signature');
    if (!header) {
      const required = await server.createPaymentRequiredResponse([requirement], {
        url: `${process.env.AUTH_BASE_URL ?? 'http://localhost:4311'}/api/payments/${id}/pay`,
        description: 'Stellar Testnet analysis',
        mimeType: 'application/json',
      });
      response.status(402).setHeader('PAYMENT-REQUIRED', encodePaymentRequiredHeader(required));
      return required;
    }
    if (header.length > 20000) throw new BadRequestException('Payment signature is too large.');
    let payload: PaymentPayload;
    try {
      payload = decodePaymentSignatureHeader(header);
    } catch {
      throw new BadRequestException('Invalid payment signature.');
    }
    if (canonical(payload.accepted) !== canonical(requirement))
      throw new BadRequestException('Payment does not match the stored quote.');
    await this.auth.throttle(`payment:${actor.workspaceId}`, 10, 60);
    const verified = await server.verifyPayment(payload, requirement);
    if (!verified.isValid)
      throw new BadRequestException('Payment verification failed. No settlement was requested.');
    const payloadHash = createHash('sha256').update(canonical(payload.payload)).digest('hex');
    try {
      await this.database.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${actor.workspaceId}::uuid FOR UPDATE`;
        if (
          await tx.paymentOrder.count({
            where: { workspaceId: actor.workspaceId, status: { in: ['SETTLING', 'UNKNOWN'] } },
          })
        )
          throw new ConflictException('Another payment is awaiting settlement.');
        const claim = await tx.paymentOrder.updateMany({
          where: {
            id,
            workspaceId: actor.workspaceId,
            status: 'QUOTED',
            expiresAt: { gt: new Date() },
          },
          data: { status: 'SETTLING', payloadHash },
        });
        if (claim.count !== 1)
          throw new ConflictException('Payment is already being processed or expired.');
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('This payment authorization was already used.');
      throw error;
    }
    let settlement: SettleResponse;
    try {
      settlement = await server.settlePayment(payload, requirement);
      if (
        !settlement.success ||
        settlement.network !== 'stellar:testnet' ||
        !/^[a-fA-F0-9]{64}$/.test(settlement.transaction)
      )
        throw new Error('Settlement not confirmed');
      await this.database.client.paymentOrder.update({
        where: { id },
        data: {
          status: 'PAID',
          transactionHash: settlement.transaction.toLowerCase(),
          settlement: json(settlement),
        },
      });
    } catch {
      // A timeout or crash is not proof of failure. Never automatically retry settlement.
      await this.database.client.paymentOrder.updateMany({
        where: { id, status: 'SETTLING' },
        data: { status: 'UNKNOWN' },
      });
      throw new ConflictException(
        'Settlement is uncertain. Do not pay again; this order requires reconciliation.',
      );
    }
    response.setHeader('PAYMENT-RESPONSE', encodePaymentResponseHeader(settlement));
    return this.executions.create(actor, order.request, `payment_${order.id}`, id);
  }
}
