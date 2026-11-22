import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import { setTimeout as delay } from 'node:timers/promises';
import { ExecutionService } from '@clarix/application';
import { AuthGuard } from '../auth/auth.guard.js';
import { AuthService, type AuthenticatedRequest } from '../auth/auth.service.js';

@Controller('api/executions')
@UseGuards(AuthGuard)
export class ExecutionsController {
  constructor(
    @Inject(ExecutionService) private readonly executions: ExecutionService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Post()
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    await this.auth.throttle(`execution:${request.session.workspaceId}`, 60, 60);
    return this.executions.create(request.session, body, key);
  }
  @Get()
  list(@Req() request: AuthenticatedRequest, @Query('cursor') cursor?: string) {
    if (cursor && !z.uuid().safeParse(cursor).success)
      throw new BadRequestException('Invalid cursor.');
    return this.executions.list(request.session, cursor);
  }
  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.executions.get(request.session, id);
  }
  @Post(':id/cancel')
  cancel(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.executions.cancel(request.session, id);
  }
  @Get(':id/events')
  async events(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('after') after?: string,
  ) {
    await this.executions.get(request.session, id);
    const supplied = request.headers['last-event-id'] ?? after ?? '0';
    if (typeof supplied !== 'string' || !/^\d{1,18}$/.test(supplied))
      throw new BadRequestException('Invalid event cursor.');
    let cursor = BigInt(supplied);
    let closed = false;
    response.on('close', () => {
      closed = true;
    });
    response.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    try {
      while (!closed) {
        const session = await this.auth.authenticate(request);
        const page = await this.executions.events(session, id, cursor);
        for (const event of page.events) {
          cursor = BigInt(event.id);
          if (!response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`)) {
            closed = true;
            break;
          }
        }
        if (page.terminal && page.events.length < 100) break;
        response.write(': heartbeat\n\n');
        await delay(1500);
      }
    } catch {
      if (!closed) response.write('event: expired\ndata: {}\n\n');
    } finally {
      response.end();
    }
  }
}
