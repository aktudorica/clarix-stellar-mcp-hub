import { PaymentService, paymentConfiguration } from './payment.service.js';
import { AgentService, agentConfiguration } from './agent.service.js';
import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  Req,
  Res,
  Inject,
  UseGuards,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { type AuthenticatedRequest } from '../auth/auth.service.js';
import { McpService } from './mcp.service.js';

@Controller('api')
export class IntegrationsController {
  constructor(
    @Inject(McpService) private readonly mcp: McpService,
    @Inject(AgentService) private readonly agent: AgentService,
    @Inject(PaymentService) private readonly payments: PaymentService,
  ) {}

  @Get('integrations')
  @UseGuards(AuthGuard)
  configuration() {
    return {
      framework: 'NestJS',
      authentication: 'Better Auth',
      network: 'stellar:testnet',
      mcp: { enabled: true, path: '/api/mcp', tokenLifetimeDays: 7 },
      agent: agentConfiguration(),
      payments: paymentConfiguration(),
    };
  }

  @Post('integrations/mcp/token')
  @UseGuards(AuthGuard)
  token(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = z
      .object({ execute: z.boolean().default(false) })
      .strict()
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid MCP permissions.');
    return this.mcp.issue(
      { userId: req.session.userId, workspaceId: req.session.workspaceId },
      parsed.data.execute,
    );
  }

  @Post('integrations/mcp/revoke')
  @UseGuards(AuthGuard)
  revoke(@Req() req: AuthenticatedRequest) {
    return this.mcp.revoke(req.session);
  }

  @Post('payments/quotes')
  @UseGuards(AuthGuard)
  quote(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.payments.quote(req.session, body, req.header('Idempotency-Key'));
  }

  @Get('payments')
  @UseGuards(AuthGuard)
  paymentHistory(@Req() req: AuthenticatedRequest) {
    return this.payments.list(req.session);
  }

  @Get('payments/:id')
  @UseGuards(AuthGuard)
  async payment(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.payments.view(await this.payments.get(req.session, id));
  }

  @Post('payments/:id/pay')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  pay(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.payments.pay(req.session, id, req, res);
  }

  @Post('agent/chat')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  chat(@Req() req: AuthenticatedRequest, @Body() body: unknown, @Res() res: Response) {
    return this.agent.chat(
      { userId: req.session.userId, workspaceId: req.session.workspaceId },
      body,
      res,
    );
  }

  @Post('mcp')
  async handle(@Req() req: Request, @Res() res: Response) {
    if (
      req.headers.origin &&
      !(process.env.APP_ORIGINS ?? '').split(',').includes(req.headers.origin)
    )
      throw new ForbiddenException('Request origin is not allowed.');
    if (!req.is('application/json'))
      throw new BadRequestException('Content-Type application/json is required.');
    const handler = await this.mcp.handler(req.headers.authorization);
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const response = await handler.fetch(
      new globalThis.Request(`${process.env.AUTH_BASE_URL ?? 'http://localhost:4311'}/api/mcp`, {
        method: 'POST',
        headers: fromNodeHeaders(req.headers),
        body: JSON.stringify(req.body),
        signal: abort.signal,
      }),
      { parsedBody: req.body },
    );
    res.status(response.status);
    response.headers.forEach((value, name) => res.setHeader(name, value));
    if (response.body)
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
        res,
      ).catch(() => {
        res.end();
      });
    else res.end();
  }
}
