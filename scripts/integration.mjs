import { checkFrameworks } from './framework-integration.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { createDatabase } from '../packages/database/dist/index.js';
import { StellarReader, serviceInput } from '../packages/stellar/dist/index.js';
const requireStellar = createRequire(new URL('../packages/stellar/package.json', import.meta.url));
const { Keypair, TransactionBuilder, Account, Networks, Operation, Asset } =
  requireStellar('@stellar/stellar-sdk');
const requireWorker = createRequire(new URL('../apps/worker/package.json', import.meta.url));
const { Queue } = requireWorker('bullmq');
const source = Keypair.random().publicKey();
const destination = Keypair.random().publicKey();
const missing = Keypair.random().publicKey();
const envelope = new TransactionBuilder(new Account(source, '1'), {
  fee: '200',
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(Operation.payment({ destination, amount: '1.2500000', asset: Asset.native() }))
  .addOperation(Operation.manageData({ name: 'fixture', value: 'test' }))
  .setTimeout(30)
  .build();
const hash = Buffer.from(envelope.hash()).toString('hex');
const transaction = {
  hash,
  successful: true,
  ledger: 123,
  created_at: '2026-09-25T09:00:00Z',
  source_account: source,
  fee_charged: '200',
  operation_count: 2,
  envelope_xdr: envelope.toXDR(),
  result_xdr: 'fixture-result',
  memo_type: 'none',
};
const account = {
  account_id: source,
  sequence: '99999999999999999',
  subentry_count: 1,
  last_modified_ledger: 123,
  balances: [
    { balance: '100.1234567', asset_type: 'native' },
    {
      balance: '5.0000000',
      asset_type: 'credit_alphanum4',
      asset_code: 'TEST',
      asset_issuer: destination,
      limit: '100.0000000',
      is_authorized: true,
    },
  ],
  thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
  signers: [{ key: source, weight: 1, type: 'ed25519_public_key' }],
};
let slow = false;
let failures = 0;
let requests = 0;
let mode = 'normal';
const fixture = createServer(async (request, response) => {
  if (request.url === '/v1/chat/completions') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (
      body.chat_template_kwargs?.enable_thinking !== true ||
      body.max_tokens !== 16384 ||
      body.temperature !== 1 ||
      body.top_p !== 0.95
    ) {
      response
        .writeHead(400)
        .end(JSON.stringify({ error: { message: 'Invalid NVIDIA request settings' } }));
      return;
    }
    const hasTool = body.messages.some((message) => message.role === 'tool');
    response.setHeader('Content-Type', 'text/event-stream');
    response.write(
      'data: ' +
        JSON.stringify({
          id: 'fixture-chat',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture',
          choices: [
            {
              index: 0,
              delta: { reasoning_content: 'fixture-private-reasoning' },
              finish_reason: null,
            },
          ],
        }) +
        '\n\n',
    );
    const delta = hasTool
      ? { content: 'Prepared for your review. Confirm it in the UI.' }
      : {
          tool_calls: [
            {
              index: 0,
              id: 'fixture_tool_call',
              type: 'function',
              function: {
                name: 'propose_analysis',
                arguments: JSON.stringify({
                  service: 'analyze_account',
                  input: { address: source },
                }),
              },
            },
          ],
        };
    response.write(
      'data: ' +
        JSON.stringify({
          id: 'fixture-chat',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture',
          choices: [{ index: 0, delta, finish_reason: null }],
        }) +
        '\n\n',
    );
    response.write(
      'data: ' +
        JSON.stringify({
          id: 'fixture-chat',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture',
          choices: [{ index: 0, delta: {}, finish_reason: hasTool ? 'stop' : 'tool_calls' }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }) +
        '\n\n',
    );
    response.end('data: [DONE]\n\n');
    return;
  }
  requests++;
  if (slow) await delay(4000);
  response.setHeader('Content-Type', 'application/json');
  if (failures > 0) {
    failures--;
    response.writeHead(503).end('{}');
    return;
  }
  if (mode === 'oversized') {
    response.end(JSON.stringify({ data: 'a'.repeat(2_000_001) }));
    return;
  }
  if (mode === 'bad-json') {
    response.end('bad json');
    return;
  }
  const path = new URL(request.url, 'http://fixture').pathname;
  if (path === '/') {
    response.end(
      JSON.stringify({
        network_passphrase: mode === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET,
      }),
    );
    return;
  }
  if (path.includes(missing) || path.includes('f'.repeat(64))) {
    response.writeHead(404).end('{}');
    return;
  }
  if (path === `/accounts/${source}`) {
    response.end(JSON.stringify(account));
    return;
  }
  if (path.endsWith('/operations')) {
    response.end(
      JSON.stringify({
        _embedded: {
          records: [
            {
              id: '1',
              type: 'payment',
              amount: '1.2500000',
              asset_type: 'native',
              from: source,
              to: destination,
            },
            { id: '2', type: 'manage_data', name: 'fixture', value: 'dGVzdA==' },
          ],
        },
      }),
    );
    return;
  }
  if (path === `/transactions/${hash}`) {
    response.end(JSON.stringify(transaction));
    return;
  }
  if (path.endsWith('/transactions') || path === '/transactions') {
    response.end(JSON.stringify({ _embedded: { records: [transaction] } }));
    return;
  }
  response.writeHead(404).end('{}');
});
fixture.listen(4999, '127.0.0.1');
await once(fixture, 'listening');
const database = createDatabase();
const queue = new Queue('service-executions', { connection: { host: 'redis', port: 6379 } });
let api;
let worker;
const output = [];
function start(path) {
  const child = spawn(process.execPath, [path], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      output.push(chunk.toString());
      if (output.length > 40) output.shift();
    });
  return child;
}
async function stop(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const exited = once(child, 'exit');
  child.kill(signal);
  await exited;
}
async function until(action, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await action();
    if (value) return value;
    await delay(150);
  }
  throw new Error('Timed out waiting for the expected state');
}
async function request(
  path,
  { actor, method = 'GET', body, key, csrf, origin = 'http://localhost:4311' } = {},
) {
  const headers = { Origin: origin };
  if (actor) {
    headers.Cookie = actor.cookie;
    headers['X-CSRF-Token'] = csrf ?? actor.session.csrfToken;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  const response = await fetch(`http://127.0.0.1:3000${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  return {
    status: response.status,
    data,
    cookie: response.headers.get('set-cookie')?.split(';')[0],
    response,
  };
}
const password = 'Disposable-fixture-password-2026';
async function register(name) {
  const result = await request('/api/auth/register', {
    method: 'POST',
    body: { email: `${name}@example.test`, password, name, workspaceName: `${name} workspace` },
  });
  assert.equal(result.status, 201);
  assert.match(result.response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(result.response.headers.get('set-cookie'), /SameSite=Lax/);
  return { cookie: result.cookie, session: result.data, email: `${name}@example.test` };
}
async function create(
  actor,
  input = { service: 'analyze_account', input: { address: source } },
  key = randomUUID(),
) {
  const result = await request('/api/executions', { actor, method: 'POST', body: input, key });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.id;
}
async function finished(actor, id) {
  return until(async () => {
    const result = await request(`/api/executions/${id}`, { actor });
    assert.equal(result.status, 200);
    return ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(result.data.status) && result.data;
  });
}
try {
  // Validate adapter contracts independently from the asynchronous transport.
  assert.equal(
    serviceInput.safeParse({ service: 'analyze_account', input: { address: 'G' + 'A'.repeat(55) } })
      .success,
    false,
  );
  const reader = new StellarReader();
  const report = await reader.analyze({ service: 'analyze_account', input: { address: source } });
  assert.equal(report.assets[0].balance, '100.1234567');
  assert.equal(report.coverage.completeHistory, false);
  const txReport = await reader.analyze({ service: 'explain_transaction', input: { hash } });
  assert.equal(txReport.operations[0].decoded, true);
  assert.equal(txReport.operations[1].decoded, false);
  transaction.successful = false;
  assert.match(
    (await reader.analyze({ service: 'explain_transaction', input: { hash } })).operations[0]
      .explanation,
    /^Attempted:/,
  );
  transaction.successful = true;
  await assert.rejects(
    reader.analyze({ service: 'analyze_account', input: { address: missing } }),
    { code: 'NOT_FOUND' },
  );
  mode = 'mainnet';
  await assert.rejects(reader.analyze({ service: 'analyze_account', input: { address: source } }), {
    code: 'WRONG_NETWORK',
  });
  mode = 'bad-json';
  await assert.rejects(reader.analyze({ service: 'analyze_account', input: { address: source } }), {
    code: 'INVALID_PROVIDER_RESPONSE',
  });
  mode = 'oversized';
  await assert.rejects(reader.analyze({ service: 'explain_transaction', input: { hash } }), {
    code: 'RESPONSE_TOO_LARGE',
  });
  mode = 'normal';
  console.log(
    'PASS: deterministic Stellar fixtures, precise amounts, successful/failed/unsupported/missing records and bounded responses.',
  );

  process.env.LLM_BASE_URL = 'http://127.0.0.1:4999/v1';
  process.env.LLM_MODEL = 'fixture';
  process.env.LLM_PROVIDER = 'nvidia';
  api = start('apps/api/dist/main.js');
  await until(async () => {
    try {
      return (await fetch('http://127.0.0.1:3000/health/live')).ok;
    } catch {
      return false;
    }
  });
  const alice = await register('alice');
  const bob = await register('bob');
  assert.equal((await request('/api/executions')).status, 401);
  assert.equal(
    (
      await request('/api/auth/login', {
        method: 'POST',
        body: { email: alice.email, password },
        origin: 'https://untrusted.example',
      })
    ).status,
    403,
  );
  assert.equal(
    (await request('/api/executions?cursor=' + '-'.repeat(36), { actor: alice })).status,
    400,
  );
  const input = { service: 'analyze_account', input: { address: source } };
  const idempotencyKey = randomUUID();
  assert.equal(
    (
      await request('/api/executions', {
        actor: alice,
        method: 'POST',
        body: input,
        key: idempotencyKey,
        csrf: 'incorrect',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/api/executions', {
        actor: alice,
        method: 'POST',
        body: { ...input, input: { address: 'invalid' } },
        key: idempotencyKey,
      })
    ).status,
    400,
  );
  const accepted = await Promise.all(
    Array.from({ length: 5 }, () =>
      request('/api/executions', {
        actor: alice,
        method: 'POST',
        body: input,
        key: idempotencyKey,
      }),
    ),
  );
  assert.ok(accepted.every((value) => value.status === 201));
  assert.equal(new Set(accepted.map((value) => value.data.id)).size, 1);
  const id = accepted[0].data.id;
  assert.equal(await database.outboxMessage.count({ where: { executionId: id } }), 1);
  assert.equal(
    (
      await request('/api/executions', {
        actor: alice,
        method: 'POST',
        body: { service: 'explain_transaction', input: { hash } },
        key: idempotencyKey,
      })
    ).status,
    409,
  );
  assert.equal((await request(`/api/executions/${id}`, { actor: bob })).status, 404);
  assert.equal(
    (await request(`/api/executions/${id}/cancel`, { actor: bob, method: 'POST', body: {} }))
      .status,
    404,
  );
  assert.deepEqual((await request('/api/executions', { actor: bob })).data.data, []);
  const foreignStream = await fetch(`http://127.0.0.1:3000/api/executions/${id}/events`, {
    headers: { Cookie: bob.cookie },
  });
  assert.equal(foreignStream.status, 404);
  const storedSession = await database.authSession.findFirstOrThrow({
    where: { userId: alice.session.user.id },
  });
  assert.notEqual(storedSession.token, decodeURIComponent(alice.cookie.split('=')[1]));
  assert.match(
    (await database.authAccount.findFirstOrThrow({ where: { userId: alice.session.user.id } }))
      .password,
    /^\$argon2id\$/,
  );
  const tampered = {
    ...alice,
    cookie: alice.cookie.slice(0, -1) + (alice.cookie.endsWith('a') ? 'b' : 'a'),
  };
  assert.equal((await request('/api/auth/session', { actor: tampered })).status, 401);
  await assert.rejects(database.serviceVersion.updateMany({ data: { implementation: 'mutated' } }));
  console.log(
    'PASS: Better Auth signed sessions, Argon2 credentials, CSRF/origin protection, cross-workspace isolation, concurrent idempotency and immutable service versions.',
  );

  // API restart after commit, before a worker exists: durable outbox must recover.
  await stop(api);
  api = start('apps/api/dist/main.js');
  worker = start('apps/worker/dist/main.js');
  await until(async () => {
    try {
      return (await fetch('http://127.0.0.1:3000/health/ready')).ok;
    } catch {
      return false;
    }
  });
  const completed = await finished(alice, id);
  assert.equal(completed.status, 'SUCCEEDED');
  assert.equal(completed.attempts, 1);
  const priorRequests = requests;
  await request(`/api/executions/${id}`, { actor: alice });
  assert.equal(requests, priorRequests);
  await queue.add('execute', { executionId: id }, { jobId: randomUUID() });
  await delay(1000);
  assert.equal((await request(`/api/executions/${id}`, { actor: alice })).data.attempts, 1);
  const eventCursor = completed.events[0].id;
  const stream = await fetch(`http://127.0.0.1:3000/api/executions/${id}/events`, {
    headers: { Cookie: alice.cookie, 'Last-Event-ID': eventCursor },
  });
  const streamText = await stream.text();
  assert.ok(!streamText.includes(`id: ${eventCursor}\n`));
  assert.match(streamText, /SUCCEEDED/);
  const txId = await create(alice, { service: 'explain_transaction', input: { hash } });
  assert.equal((await finished(alice, txId)).result.operations.length, 2);
  const missingId = await create(alice, {
    service: 'analyze_account',
    input: { address: missing },
  });
  const missingResult = await finished(alice, missingId);
  assert.equal(missingResult.status, 'FAILED');
  assert.equal(missingResult.errorCode, 'NOT_FOUND');
  assert.equal(missingResult.attempts, 1);
  failures = 1;
  const retryId = await create(alice);
  const retryResult = await finished(alice, retryId);
  assert.equal(retryResult.status, 'SUCCEEDED');
  assert.equal(retryResult.attempts, 2);
  console.log(
    'PASS: outbox after API restart, saved reports, duplicate queue delivery, SSE replay, both services and bounded transient retries.',
  );

  slow = true;
  const cancelId = await create(alice);
  await until(
    async () =>
      (await request(`/api/executions/${cancelId}`, { actor: alice })).data.status === 'RUNNING',
  );
  await request(`/api/executions/${cancelId}/cancel`, { actor: alice, method: 'POST', body: {} });
  await delay(4500);
  assert.equal((await finished(alice, cancelId)).status, 'CANCELLED');
  assert.equal((await finished(alice, cancelId)).result, null);
  const interruptedId = await create(alice);
  await until(
    async () =>
      (await request(`/api/executions/${interruptedId}`, { actor: alice })).data.status ===
      'RUNNING',
  );
  await stop(worker, 'SIGKILL');
  worker = null;
  slow = false;
  await database.execution.update({
    where: { id: interruptedId },
    data: { leaseUntil: new Date(Date.now() - 1000) },
  });
  worker = start('apps/worker/dist/main.js');
  const recovered = await finished(alice, interruptedId);
  assert.equal(recovered.status, 'SUCCEEDED');
  assert.equal(recovered.attempts, 2);
  assert.equal(recovered.attemptRecords[0].status, 'INTERRUPTED');
  console.log(
    'PASS: cancellation rejects late results; a killed worker recovers an expired lease with an audited second attempt.',
  );

  await stop(worker);
  worker = null;
  const strandedId = await create(alice);
  await database.execution.update({
    where: { id: strandedId },
    data: { createdAt: new Date(Date.now() - 120000) },
  });
  await database.outboxMessage.updateMany({
    where: { executionId: strandedId },
    data: { dispatchedAt: new Date(Date.now() - 120000) },
  });
  worker = start('apps/worker/dist/main.js');
  assert.equal((await finished(alice, strandedId)).status, 'SUCCEEDED');
  assert.equal(await database.outboxMessage.count({ where: { executionId: strandedId } }), 2);
  failures = 10;
  const exhaustedId = await create(alice);
  const exhausted = await finished(alice, exhaustedId);
  assert.equal(exhausted.status, 'FAILED');
  assert.equal(exhausted.attempts, 3);
  failures = 0;
  console.log(
    'PASS: acknowledged-but-lost queue delivery is repaired; transient failures stop after three attempts.',
  );

  const version = await database.serviceVersion.findFirstOrThrow();
  const sameTime = new Date();
  await database.execution.createMany({
    data: Array.from({ length: 25 }, () => ({
      workspaceId: alice.session.workspace.id,
      createdBy: alice.session.user.id,
      serviceVersionId: version.id,
      idempotencyKey: randomUUID(),
      inputFingerprint: 'pagination-fixture',
      input: { address: source },
      status: 'CANCELLED',
      createdAt: sameTime,
      finishedAt: sameTime,
    })),
  });
  const historyIds = [];
  let cursor = '';
  do {
    const page = await request(`/api/executions${cursor ? `?cursor=${cursor}` : ''}`, {
      actor: alice,
    });
    assert.equal(page.status, 200);
    assert.ok(page.data.data.length <= 20);
    historyIds.push(...page.data.data.map((item) => item.id));
    cursor = page.data.nextCursor;
  } while (cursor);
  assert.equal(new Set(historyIds).size, historyIds.length);
  assert.equal(
    historyIds.length,
    await database.execution.count({ where: { workspaceId: alice.session.workspace.id } }),
  );
  console.log(
    'PASS: cursor pagination has no gaps or duplicates when creation timestamps collide.',
  );

  await checkFrameworks({ database, alice, bob, request, source, executionId: id });

  const logout = await request('/api/auth/logout', { actor: bob, method: 'POST', body: {} });
  assert.equal(logout.status, 200);
  assert.equal((await request('/api/auth/session', { actor: bob })).status, 401);
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email: alice.email, password },
  });
  assert.equal(login.status, 200);
  const expired = { cookie: login.cookie, session: login.data };
  await database.authSession.updateMany({
    where: { userId: alice.session.user.id },
    data: { expiresAt: new Date(0) },
  });
  assert.equal((await request('/api/auth/session', { actor: expired })).status, 401);
  console.log('PASS: sign-in, sign-out revocation and expired session rejection.');
} catch (error) {
  console.error(output.join('').slice(-12000));
  throw error;
} finally {
  await stop(api);
  await stop(worker);
  await queue.close();
  await database.$disconnect();
  fixture.closeAllConnections();
  await new Promise((resolve) => fixture.close(resolve));
}
