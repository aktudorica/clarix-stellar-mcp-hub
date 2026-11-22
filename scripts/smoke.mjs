import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { createDatabase } from '../packages/database/dist/index.js';
import { redisConnection, PROBE_QUEUE } from '../packages/platform/dist/index.js';

const requireWorker = createRequire(new URL('../apps/worker/package.json', import.meta.url));
const { Queue, QueueEvents } = requireWorker('bullmq');
const database = createDatabase();
const queue = new Queue(PROBE_QUEUE, { connection: redisConnection() });
const events = new QueueEvents(PROBE_QUEUE, { connection: redisConnection() });
const probeId = randomUUID();
let probeJob;
let duplicateJob;

try {
  const response = await fetch('http://api:3000/health/ready', {
    signal: AbortSignal.timeout(8000),
  });
  assert.equal(response.status, 200);
  const readiness = await response.json();
  assert.equal(readiness.status, 'ready');
  assert.deepEqual(readiness.features, {
    payments:
      process.env.X402_ENABLED === 'true' &&
      Boolean(process.env.X402_PAY_TO && process.env.OZ_API_KEY),
    agent: Boolean(process.env.LLM_BASE_URL && process.env.LLM_MODEL),
    execution: true,
    mcp: true,
  });
  console.log('PASS: API readiness checks database, Redis and worker.');

  const catalogResponse = await fetch('http://api:3000/api/services');
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.data.length, 2);
  assert.deepEqual(catalog.data.map((service) => service.slug).sort(), [
    'analyze_account',
    'explain_transaction',
  ]);
  for (const service of catalog.data) {
    const detail = await fetch(`http://api:3000/api/services/${service.slug}`);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).data.id, service.id);
  }
  assert.equal((await fetch('http://api:3000/api/services/unknown')).status, 404);
  console.log(
    'PASS: catalog and detail endpoints read persistent records; unknown tools return 404.',
  );

  await events.waitUntilReady();
  probeJob = await queue.add('verify-stack', { probeId }, { jobId: probeId });
  const result = await probeJob.waitUntilFinished(events, 20000);
  assert.equal(result.id, probeId);
  const record = await database.systemProbe.findUniqueOrThrow({ where: { id: probeId } });
  assert.ok(record.workerId);

  duplicateJob = await queue.add('verify-stack', { probeId }, { jobId: `${probeId}-retry` });
  await duplicateJob.waitUntilFinished(events, 20000);
  assert.equal(await database.systemProbe.count({ where: { id: probeId } }), 1);
  const afterRetry = await database.systemProbe.findUniqueOrThrow({ where: { id: probeId } });
  assert.equal(afterRetry.completedAt.toISOString(), record.completedAt.toISOString());
  console.log('PASS: Redis → worker → PostgreSQL round trip, including duplicate delivery.');
} finally {
  // Remove only this diagnostic run's job and record; never touch application data.
  await delay(100);
  for (const job of [probeJob, duplicateJob]) {
    if (job && (await job.isCompleted())) await job.remove();
  }
  await database.systemProbe.deleteMany({ where: { id: probeId } });
  await events.close();
  await queue.close();
  await database.$disconnect();
}
