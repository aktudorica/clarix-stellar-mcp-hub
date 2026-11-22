import { createHash, randomBytes } from 'node:crypto';
import {
  Injectable,
  Inject,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { DatabaseService, RedisService } from '@clarix/platform';
import { ExecutionService, type Actor } from '@clarix/application';
import { serviceInput } from '@clarix/stellar';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';
import { CatalogServiceRepository } from '../catalog/catalog.service.js';

const lifetime = 7 * 24 * 60 * 60;
const principalSchema = z.object({ userId: z.uuid(), workspaceId: z.uuid(), execute: z.boolean() });

@Injectable()
export class McpService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ExecutionService) private readonly executions: ExecutionService,
    @Inject(CatalogServiceRepository) private readonly catalog: CatalogServiceRepository,
  ) {}

  private ownerKey(actor: Actor) {
    return `mcp-owner:${actor.workspaceId}:${actor.userId}`;
  }

  async issue(actor: Actor, execute: boolean) {
    await this.auth.throttle(`mcp-issue:${actor.userId}`, 10, 600);
    const token = `clarix_${randomBytes(32).toString('base64url')}`;
    const key = this.tokenKey(token);
    await this.redis.client.eval(
      "local old=redis.call('GET',KEYS[1]); if old then redis.call('DEL',old) end; redis.call('SET',KEYS[1],KEYS[2],'EX',ARGV[1]); redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[1]); return 1",
      2,
      this.ownerKey(actor),
      key,
      lifetime,
      JSON.stringify({ ...actor, execute }),
    );
    return { token, expiresAt: new Date(Date.now() + lifetime * 1000).toISOString(), execute };
  }

  async revoke(actor: Actor) {
    await this.redis.client.eval(
      "local old=redis.call('GET',KEYS[1]); if old then redis.call('DEL',old) end; redis.call('DEL',KEYS[1]); return 1",
      1,
      this.ownerKey(actor),
    );
    return { revoked: true };
  }

  private tokenKey(token: string) {
    return `mcp-token:${createHash('sha256').update(token).digest('hex')}`;
  }

  async handler(authorization: string | undefined) {
    if (!authorization || !/^Bearer clarix_[A-Za-z0-9_-]{43}$/.test(authorization))
      throw new UnauthorizedException('A workspace MCP bearer token is required.');
    const key = this.tokenKey(authorization.slice(7));
    const stored = await this.redis.client.get(key);
    if (!stored) throw new UnauthorizedException('MCP token expired or revoked.');
    const principal = principalSchema.parse(JSON.parse(stored));
    const member = await this.database.client.workspaceMember.findUnique({
      where: {
        userId_workspaceId: { userId: principal.userId, workspaceId: principal.workspaceId },
      },
    });
    if (!member) throw new UnauthorizedException('Workspace access was revoked.');
    await this.auth.throttle(`mcp:${key}`, 120, 60);
    return createMcpHandler(() => this.server(principal), { maxRequestBodySize: 32768 });
  }

  private server(actor: Actor & { execute: boolean }) {
    const server = new McpServer({ name: 'clarix-stellar-hub', version: '0.1.0' });
    const result = (data: unknown) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    });
    server.registerTool(
      'discover_services',
      {
        description:
          'List available Stellar analysis services. Internal preview currently requires no payment.',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true },
      },
      async () => result(await this.catalog.list()),
    );
    server.registerTool(
      'get_execution',
      {
        description: 'Read an execution and its evidence from this workspace.',
        inputSchema: z.object({ id: z.uuid() }),
        annotations: { readOnlyHint: true },
      },
      async ({ id }) => this.toolResult(() => this.executions.get(actor, id)),
    );
    server.registerTool(
      'list_executions',
      {
        description: 'Read recent executions in this workspace.',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true },
      },
      async () => this.toolResult(() => this.executions.list(actor)),
    );
    if (actor.execute)
      server.registerTool(
        'run_analysis',
        {
          description:
            'Queue a Stellar analysis. Reuse idempotencyKey when retrying the same request. Does not authorize or initiate payments.',
          inputSchema: z.object({
            request: serviceInput,
            idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),
          }),
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        },
        async ({ request, idempotencyKey }) =>
          this.toolResult(async () => {
            if (process.env.EXECUTION_ACCESS !== 'internal_preview')
              throw new ForbiddenException('Use the UI to authorize a paid execution.');
            return this.executions.create(actor, request, idempotencyKey);
          }),
      );
    return server;
  }

  private async toolResult(run: () => Promise<unknown>) {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(await run()) }] };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text:
              error instanceof HttpException ? error.message : 'Service unavailable. Retry later.',
          },
        ],
      };
    }
  }
}
