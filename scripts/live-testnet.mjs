import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createDatabase } from '../packages/database/dist/index.js';

if (process.env.LIVE_TESTNET !== '1')
  throw new Error('Set LIVE_TESTNET=1 to run public Testnet reads.');
const database = createDatabase();
const base = 'http://api:3000';
const origin = process.env.APP_ORIGINS.split(',')[0];
let identity;
let cookie;
async function request(path, body, key) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(identity ? { 'X-CSRF-Token': identity.csrfToken } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify({ status: response.status, message: result.message }));
  return { result, response };
}
try {
  const created = await request('/api/auth/register', {
    email: `live-${randomUUID()}@example.test`,
    password: randomBytes(24).toString('base64url'),
    name: 'Live test',
    workspaceName: 'Disposable live test workspace',
  });
  identity = created.result;
  cookie = created.response.headers.get('set-cookie').split(';')[0];
  const { result: example } = await request('/api/stellar/examples');
  for (const [service, input] of [
    ['analyze_account', { address: example.address }],
    ['explain_transaction', { hash: example.hash }],
  ]) {
    const { result: execution } = await request(
      '/api/executions',
      { service, input },
      randomUUID(),
    );
    const deadline = Date.now() + 120000;
    let final;
    while (Date.now() < deadline) {
      const { result } = await request(`/api/executions/${execution.id}`);
      if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(result.status)) {
        final = result;
        break;
      }
      await delay(500);
    }
    assert.ok(final, 'Live execution did not finish within two minutes.');
    assert.equal(
      final.status,
      'SUCCEEDED',
      JSON.stringify({ code: final.errorCode, message: final.errorMessage }),
    );
    assert.equal(final.result.evidence.network, 'stellar:testnet');
    assert.ok(final.result.evidence.sources.length >= 2);
    assert.equal(final.accessMode, 'INTERNAL_PREVIEW');
    console.log(
      `PASS: ${service} returned a saved, source-backed real Testnet report (${final.attempts} attempt).`,
    );
  }
} finally {
  // This script owns this unique disposable workspace; never delete other users' records.
  if (identity) {
    await database.$transaction(async (tx) => {
      await tx.execution.deleteMany({ where: { workspaceId: identity.workspace.id } });
      await tx.workspace.delete({ where: { id: identity.workspace.id } });
      await tx.user.delete({ where: { id: identity.user.id } });
    });
  }
  await database.$disconnect();
}
