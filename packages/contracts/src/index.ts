export interface CatalogService {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  status: 'PLANNED' | 'ACTIVE' | 'DISABLED';
  network: string;
  provider: { name: string; slug: string };
  capabilities: string[];
}

export interface SystemStatus {
  status: 'ready' | 'degraded';
  network: 'stellar:testnet';
  version: string;
  checkedAt: string;
  checks: Record<'database' | 'redis' | 'worker', { status: 'up' | 'down' }>;
  features: { payments: boolean; agent: boolean; execution: boolean; mcp?: boolean };
}

export interface SessionView {
  user: { id: string; name: string; email: string };
  workspace: { id: string; name: string };
  csrfToken: string;
}

export interface ExecutionView {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'RETRYING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  accessMode: string;
  input: { address?: string; hash?: string };
  createdAt: string;
  finishedAt: string | null;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  result: Record<string, unknown> | null;
  serviceVersion: { version: number; service: { slug: string; name: string } };
  events: Array<{ id: string; type: string; message: string; createdAt: string }>;
  attemptRecords: Array<{
    number: number;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    errorCode: string | null;
  }>;
}
