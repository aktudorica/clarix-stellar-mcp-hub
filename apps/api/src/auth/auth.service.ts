import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService, RedisService } from '@clarix/platform';
import { fromNodeHeaders } from 'better-auth/node';
import { APIError } from 'better-auth/api';
import { createAuth, authSecret } from './better-auth.js';
import { z } from 'zod';
import type { Request, Response } from 'express';

const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(128),
});
const registration = credentials
  .extend({
    name: z.string().trim().min(2).max(80),
    workspaceName: z.string().trim().min(2).max(80),
  })
  .strict();
export const COOKIE_NAME = 'clarix_session';
export type AuthenticatedRequest = Request & { session: SessionContext };
export interface SessionContext {
  id: string;
  source?: 'better-auth';
  userId: string;
  workspaceId: string;
  csrfToken: string;
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string };
}

@Injectable()
export class AuthService {
  private readonly identity: ReturnType<typeof createAuth>;
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {
    this.identity = createAuth(database.client);
  }

  checkOrigin(request: Request) {
    const allowed = (process.env.APP_ORIGINS ?? '').split(',').filter(Boolean);
    if (!request.headers.origin || !allowed.includes(request.headers.origin))
      throw new ForbiddenException('Request origin is not allowed.');
    if (!request.is('application/json'))
      throw new BadRequestException('Content-Type application/json is required.');
  }

  async throttle(key: string, limit: number, seconds: number) {
    const bucket = createHash('sha256').update(key).digest('hex');
    const count = await this.redis.client.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
      1,
      `rate:${bucket}`,
      seconds,
    );
    if (Number(count) > limit)
      throw new HttpException('Too many attempts. Please try again later.', 429);
  }

  async register(body: unknown, request: Request, response: Response) {
    this.checkOrigin(request);
    if (process.env.ALLOW_REGISTRATION !== 'true')
      throw new ForbiddenException('Registration is not enabled.');
    await this.throttle(`register:${request.ip}`, 10, 900);
    const result = registration.safeParse(body);
    if (!result.success)
      throw new BadRequestException(result.error.issues.map((issue) => issue.message).join('; '));
    const { email, password, name, workspaceName } = result.data;
    try {
      // One transaction covers framework identity/session writes and workspace creation.
      const result = await this.database.client.$transaction(
        async (tx) => {
          const auth = createAuth(tx, false);
          const created = await auth.api.signUpEmail({
            body: { email, password, name },
            headers: fromNodeHeaders(request.headers),
            returnHeaders: true,
          });
          const workspace = await tx.workspace.create({
            data: {
              name: workspaceName,
              memberships: { create: { userId: created.response.user.id, role: 'OWNER' } },
            },
          });
          return { created, workspace };
        },
        { timeout: 15000 },
      );
      this.forwardCookies(result.created.headers, response);
      return this.view(await this.fromIdentityCookies(result.created.headers));
    } catch (error) {
      if (error instanceof APIError)
        throw new BadRequestException('Unable to create this account. Try signing in.');
      throw error;
    }
  }

  async login(body: unknown, request: Request, response: Response) {
    this.checkOrigin(request);
    await this.throttle(`login-ip:${request.ip}`, 30, 300);
    const result = credentials.strict().safeParse(body);
    if (!result.success) throw new UnauthorizedException('Invalid email or password.');
    await this.throttle(`login-email:${result.data.email}`, 10, 300);
    try {
      const signed = await this.identity.api.signInEmail({
        body: result.data,
        headers: fromNodeHeaders(request.headers),
        returnHeaders: true,
      });
      const session = await this.fromIdentityCookies(signed.headers);
      // Revoke the previous browser session only after successful authentication.
      try {
        await this.revoke(await this.authenticate(request));
      } catch (error) {
        if (!(error instanceof UnauthorizedException)) throw error;
      }
      this.forwardCookies(signed.headers, response);
      this.clearLegacyCookie(response);
      return this.view(session);
    } catch (error) {
      if (error instanceof APIError) throw new UnauthorizedException('Invalid email or password.');
      throw error;
    }
  }

  private forwardCookies(headers: Headers, response: Response) {
    for (const cookie of headers.getSetCookie()) response.append('Set-Cookie', cookie);
  }

  private async fromIdentityCookies(headers: Headers) {
    const cookie = headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    return this.frameworkSession(new Headers({ cookie }));
  }

  private async frameworkSession(headers: Headers): Promise<SessionContext> {
    const identity = await this.identity.api.getSession({ headers });
    if (!identity) throw new UnauthorizedException('Your session expired. Sign in again.');
    const membership = await this.database.client.workspaceMember.findFirst({
      where: { userId: identity.user.id },
      orderBy: { workspaceId: 'asc' },
      include: { workspace: true },
    });
    if (!membership) throw new UnauthorizedException('Workspace access was revoked.');
    return {
      id: identity.session.id,
      userId: identity.user.id,
      workspaceId: membership.workspaceId,
      source: 'better-auth',
      csrfToken: createHmac('sha256', authSecret())
        .update(identity.session.token)
        .digest('base64url'),
      user: { id: identity.user.id, email: identity.user.email, name: identity.user.name },
      workspace: { id: membership.workspace.id, name: membership.workspace.name },
    };
  }

  async authenticate(request: Request): Promise<SessionContext> {
    // A framework cookie takes precedence; an invalid one must not revive a legacy session.
    if (/(?:^|;\s*)(?:__Secure-)?clarix\.session_token=/.test(request.headers.cookie ?? ''))
      return this.frameworkSession(fromNodeHeaders(request.headers));
    const token = this.cookie(request);
    if (!token) throw new UnauthorizedException('Sign in to continue.');
    const session = await this.database.client.session.findUnique({
      where: { tokenHash: this.hash(token) },
      include: {
        user: { select: { id: true, email: true, name: true } },
        workspace: { select: { id: true, name: true } },
      },
    });
    if (!session || session.expiresAt <= new Date())
      throw new UnauthorizedException('Your session expired. Sign in again.');
    const membership = await this.database.client.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: session.userId, workspaceId: session.workspaceId } },
    });
    if (!membership) throw new UnauthorizedException('Workspace access was revoked.');
    return session;
  }

  checkCsrf(request: Request, session: SessionContext) {
    this.checkOrigin(request);
    const supplied = request.headers['x-csrf-token'];
    if (
      typeof supplied !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(supplied) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(session.csrfToken))
    )
      throw new ForbiddenException('Invalid CSRF token. Refresh the page and try again.');
  }

  private async revoke(session: SessionContext) {
    if (session.source === 'better-auth')
      await this.database.client.authSession.deleteMany({
        where: { id: session.id, userId: session.userId },
      });
    else
      await this.database.client.session.deleteMany({
        where: { id: session.id, userId: session.userId },
      });
  }

  async logout(session: SessionContext, response: Response, request: Request) {
    if (session.source === 'better-auth') {
      const result = await this.identity.api.signOut({
        headers: fromNodeHeaders(request.headers),
        returnHeaders: true,
      });
      this.forwardCookies(result.headers, response);
    } else await this.revoke(session);
    const legacy = this.cookie(request);
    if (legacy)
      await this.database.client.session.deleteMany({ where: { tokenHash: this.hash(legacy) } });
    this.clearLegacyCookie(response);
    return { signedOut: true };
  }

  private clearLegacyCookie(response: Response) {
    response.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.SESSION_COOKIE_SECURE !== 'false',
      sameSite: 'lax',
      path: '/',
    });
  }

  view(session: SessionContext) {
    return { user: session.user, workspace: session.workspace, csrfToken: session.csrfToken };
  }
  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  private cookie(request: Request) {
    const tokens =
      request.headers.cookie
        ?.split(';')
        .map((part) => part.trim())
        .filter((part) => part.startsWith(`${COOKIE_NAME}=`)) ?? [];
    const token = tokens[0]?.slice(COOKIE_NAME.length + 1);
    return tokens.length === 1 && token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  }
}
