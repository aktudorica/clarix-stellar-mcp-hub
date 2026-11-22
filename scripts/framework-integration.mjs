import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client, StreamableHTTPClientTransport } = await import(
  requireApi.resolve('@modelcontextprotocol/client')
);
const { x402ResourceServer } = await import(requireApi.resolve('@x402/core/server'));
const { ExactStellarScheme } = await import(requireApi.resolve('@x402/stellar/exact/server'));
const { encodePaymentSignatureHeader } = await import(requireApi.resolve('@x402/core/http'));
const { ExecutionService } = await import('../packages/application/dist/index.js');
const { PaymentService } = await import('../apps/api/dist/integrations/payment.service.js');
const argon2 = requireApi('argon2');

export async function checkFrameworks({ database, alice, bob, request, source, executionId }) {
  // Execute the migration's real credential-copy statement for a legacy identity fixture.
  const legacy = await database.user.create({
    data: {
      email: 'legacy@example.test',
      name: 'Legacy User',
      passwordHash: await argon2.hash('Legacy-password-2026'),
    },
  });
  const workspace = await database.workspace.create({
    data: { name: 'Legacy workspace', memberships: { create: { userId: legacy.id } } },
  });
  const migration = await readFile(
    new URL(
      '../packages/database/prisma/migrations/20260925000300_better_auth/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const statement = migration
    .slice(migration.indexOf('INSERT INTO'))
    .replace(
      'WHERE "passwordHash" IS NOT NULL;',
      'WHERE "passwordHash" IS NOT NULL AND "id" = $1::uuid;',
    );
  await database.$executeRawUnsafe(statement, legacy.id);
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  await database.session.create({
    data: {
      userId: legacy.id,
      workspaceId: workspace.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      csrfToken,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const actor = { cookie: `clarix_session=${token}`, session: { csrfToken } };
  assert.equal((await request('/api/auth/session', { actor })).data.workspace.id, workspace.id);
  const login = await request('/api/auth/login', {
    method: 'POST',
    actor,
    body: { email: legacy.email, password: 'Legacy-password-2026' },
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.id, legacy.id);
  assert.equal(login.data.workspace.id, workspace.id);
  assert.equal((await request('/api/auth/session', { actor })).status, 401);
  assert.equal(await database.user.count({ where: { id: legacy.id } }), 1);
  console.log(
    'PASS: legacy Argon2 migration, preserved user/workspace IDs and transition from a legacy session.',
  );

  const issued = await request('/api/integrations/mcp/token', {
    actor: alice,
    method: 'POST',
    body: { execute: false },
  });
  assert.equal(issued.status, 201);
  const connect = async (token) => {
    const client = new Client({ name: 'clarix-integration-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost:3000/api/mcp'), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  };
  const client = await connect(issued.data.token);
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), [
    'discover_services',
    'get_execution',
    'list_executions',
  ]);
  assert.equal(
    (await client.callTool({ name: 'get_execution', arguments: { id: executionId } })).isError,
    undefined,
  );
  const catalog = await client.callTool({ name: 'discover_services', arguments: {} });
  assert.ok(JSON.parse(catalog.content[0].text).some((s) => s.slug === 'analyze_account'));
  const bobToken = await request('/api/integrations/mcp/token', {
    actor: bob,
    method: 'POST',
    body: {},
  });
  const otherClient = await connect(bobToken.data.token);
  assert.equal(
    (await otherClient.callTool({ name: 'get_execution', arguments: { id: executionId } })).isError,
    true,
  );
  await otherClient.close();
  const rotated = await request('/api/integrations/mcp/token', {
    actor: alice,
    method: 'POST',
    body: { execute: true },
  });
  await assert.rejects(client.listTools());
  await client.close();
  const writer = await connect(rotated.data.token);
  assert.ok((await writer.listTools()).tools.some((t) => t.name === 'run_analysis'));
  const key = randomUUID();
  const args = {
    request: { service: 'analyze_account', input: { address: source } },
    idempotencyKey: key,
  };
  const first = JSON.parse(
    (await writer.callTool({ name: 'run_analysis', arguments: args })).content[0].text,
  );
  const duplicate = JSON.parse(
    (await writer.callTool({ name: 'run_analysis', arguments: args })).content[0].text,
  );
  assert.equal(first.id, duplicate.id);
  await request('/api/integrations/mcp/revoke', { actor: alice, method: 'POST', body: {} });
  await assert.rejects(writer.listTools());
  await writer.close();
  assert.equal((await request('/api/mcp', { method: 'POST', actor: alice, body: {} })).status, 401);
  console.log(
    'PASS: official MCP v2 client, read/execute permissions, tenant isolation, token rotation/revocation and shared idempotency.',
  );

  // Model fixture is an HTTP SSE provider. Real SDK provider/stream/parser/tool execution are exercised.
  const before = await database.execution.count();
  const reply = await fetch('http://127.0.0.1:3000/api/agent/chat', {
    method: 'POST',
    headers: {
      Cookie: alice.cookie,
      Origin: 'http://localhost:4311',
      'Content-Type': 'application/json',
      'X-CSRF-Token': alice.session.csrfToken,
    },
    body: JSON.stringify({
      messages: [
        {
          id: randomUUID(),
          role: 'user',
          parts: [{ type: 'text', text: 'Prepare an account analysis.' }],
        },
      ],
    }),
  });
  assert.equal(reply.status, 200);
  const stream = await reply.text();
  assert.match(stream, /propose_analysis/);
  assert.match(stream, /approvalRequired/);
  assert.match(stream, /Prepared for your review/);
  assert.doesNotMatch(stream, /fixture-private-reasoning/);
  assert.equal(await database.execution.count(), before);
  const saved = await database.agentRun.findFirstOrThrow({
    where: { workspaceId: alice.session.workspace.id },
    orderBy: { createdAt: 'desc' },
  });
  assert.equal(saved.status, 'FINISHED');
  assert.ok(saved.output);
  assert.doesNotMatch(JSON.stringify(saved.output), /fixture-private-reasoning/);
  console.log(
    'PASS: AI SDK streaming with a local model fixture, bounded tool proposal, persisted output and no autonomous execution.',
  );

  const env = { ...process.env };
  process.env.X402_ENABLED = 'true';
  process.env.OZ_API_KEY = 'fixture-not-a-real-key';
  process.env.X402_PAY_TO = source;
  let settlements = 0;
  let uncertain = false;
  const server = new x402ResourceServer({
    getSupported: async () => ({
      kinds: [
        {
          x402Version: 2,
          scheme: 'exact',
          network: 'stellar:testnet',
          extra: { areFeesSponsored: true },
        },
      ],
      extensions: [],
      signers: {},
    }),
    verify: async () => ({ isValid: true, payer: source }),
    settle: async () => {
      settlements++;
      await delay(50);
      if (uncertain) throw new Error('Simulated timeout after broadcast');
      return {
        success: true,
        transaction: createHash('sha256').update(String(settlements)).digest('hex'),
        network: 'stellar:testnet',
        payer: source,
      };
    },
  }).register('stellar:testnet', new ExactStellarScheme());
  await server.initialize();
  const executions = new ExecutionService({ client: database });
  const payments = new PaymentService({ client: database }, executions, {
    throttle: async () => {},
  });
  payments.initialize = async () => server;
  const principal = { userId: legacy.id, workspaceId: workspace.id };
  const analysis = { service: 'analyze_account', input: { address: source } };
  const quote = await payments.quote(principal, analysis, randomUUID());
  const response = {
    statusCode: 200,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
  };
  const rawRequest = (header) => ({
    headers: { 'payment-signature': header },
    header(name) {
      return this.headers[name.toLowerCase()];
    },
  });
  const unpaid = await payments.pay(principal, quote.id, rawRequest(undefined), response);
  assert.equal(response.statusCode, 402);
  assert.equal(unpaid.x402Version, 2);
  assert.equal(settlements, 0);
  const payload = {
    x402Version: 2,
    accepted: quote.requirement,
    payload: { fixture: randomUUID() },
  };
  const header = encodePaymentSignatureHeader(payload);
  const concurrent = await Promise.allSettled([
    payments.pay(principal, quote.id, rawRequest(header), response),
    payments.pay(principal, quote.id, rawRequest(header), response),
  ]);
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  const paid = concurrent.find((result) => result.status === 'fulfilled').value;
  assert.ok(paid.id);
  const retry = await payments.pay(principal, quote.id, rawRequest(header), response);
  assert.equal(retry.id, paid.id);
  assert.equal(settlements, 1);
  assert.equal(
    (await database.execution.findUniqueOrThrow({ where: { id: paid.id } })).accessMode,
    'PAID_TESTNET',
  );
  const second = await payments.quote(principal, analysis, randomUUID());
  await assert.rejects(payments.pay(principal, second.id, rawRequest(header), response));
  assert.equal(settlements, 1);
  const timeoutHeader = encodePaymentSignatureHeader({
    ...payload,
    payload: { fixture: randomUUID() },
  });
  uncertain = true;
  await assert.rejects(payments.pay(principal, second.id, rawRequest(timeoutHeader), response));
  assert.equal((await payments.get(principal, second.id)).status, 'UNKNOWN');
  await assert.rejects(payments.pay(principal, second.id, rawRequest(timeoutHeader), response));
  await assert.rejects(payments.quote(principal, analysis, randomUUID()));
  assert.equal(settlements, 2);
  await assert.rejects(
    payments.get({ ...principal, workspaceId: bob.session.workspace.id }, quote.id),
  );
  Object.keys(process.env)
    .filter((key) => !(key in env))
    .forEach((key) => delete process.env[key]);
  Object.assign(process.env, env);
  console.log(
    'PASS: real x402 protocol/requirements with a mock facilitator, persisted settlement, replay/concurrency guard, workspace isolation and fail-closed uncertain payments.',
  );
}
