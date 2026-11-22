import { useQuery } from '@tanstack/react-query';
import { Activity, Database, Layers3, RefreshCw, Server, CheckCircle2 } from 'lucide-react';
import { statusQuery } from '../lib/api';
import { ErrorState, LoadingState } from '../components/feedback';
import { Button } from '../components/ui/button';

const dependencies = [
  {
    id: 'database',
    name: 'PostgreSQL',
    description: 'Persistent application storage',
    Icon: Database,
  },
  {
    id: 'redis',
    name: 'Redis',
    description: 'Queue transport and worker heartbeat',
    Icon: Layers3,
  },
  {
    id: 'worker',
    name: 'Background worker',
    description: 'BullMQ consumer with expiring heartbeat',
    Icon: Server,
  },
] as const;

export function StatusPage() {
  const query = useQuery(statusQuery);
  if (query.isPending) return <LoadingState />;
  if (query.isError)
    return (
      <ErrorState
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const status = query.data;
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">CONNECTED INFRASTRUCTURE</span>
          <h1>
            Platform status<span>.</span>
          </h1>
          <p>Live dependency checks from the API. Refreshes every 10 seconds.</p>
        </div>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          <RefreshCw size={16} className={query.isFetching ? 'spin' : ''} /> Refresh
        </Button>
      </div>
      <div className={`readiness-banner ${status.status === 'ready' ? 'ready' : ''}`}>
        <CheckCircle2 size={23} />
        <div>
          <strong>
            {status.status === 'ready'
              ? 'All infrastructure checks passed'
              : 'One or more dependencies need attention'}
          </strong>
          <p>
            Checked {new Date(status.checkedAt).toLocaleTimeString()} · {status.network}
          </p>
        </div>
        <span className="release-badge">v{status.version}</span>
      </div>
      <div className="status-grid">
        {dependencies.map(({ id, name, description, Icon }) => (
          <section className="status-card" key={id}>
            <Icon size={24} />
            <h2>{name}</h2>
            <p>{description}</p>
            <span className={`status-pill ${status.checks[id].status}`}>
              <span className={`status-dot ${status.checks[id].status}`} />
              {status.checks[id].status === 'up' ? 'Connected' : 'Unavailable'}
            </span>
          </section>
        ))}
      </div>
      <section className="detail-card feature-list">
        <h2>
          <Activity size={20} /> Release capabilities
        </h2>
        <p>Infrastructure readiness is separate from product feature availability.</p>
        <dl>
          <dt>Persistent service catalog</dt>
          <dd>Implemented</dd>
          <dt>Worker queue and health monitoring</dt>
          <dd>Implemented</dd>
          <dt>Service execution</dt>
          <dd>{status.features.execution ? 'Internal preview · No charge' : 'Not enabled'}</dd>
          <dt>Freighter wallet</dt>
          <dd>Available in Integrations</dd>
          <dt>x402 Testnet payments</dt>
          <dd>
            {status.features.payments ? 'Configured · Testnet only' : 'Awaiting configuration'}
          </dd>
          <dt>AI assistant</dt>
          <dd>{status.features.agent ? 'Configured' : 'Awaiting model configuration'}</dd>
          <dt>MCP v2</dt>
          <dd>{status.features.mcp ? 'Enabled · Scoped bearer tokens' : 'Not enabled'}</dd>
        </dl>
      </section>
    </div>
  );
}
