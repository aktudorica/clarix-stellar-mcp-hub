import { readFile } from 'node:fs/promises';
try {
  const timestamp = Number(await readFile('/tmp/clarix-worker-heartbeat', 'utf8'));
  process.exit(Number.isFinite(timestamp) && Date.now() - timestamp < 20000 ? 0 : 1);
} catch {
  process.exit(1);
}
