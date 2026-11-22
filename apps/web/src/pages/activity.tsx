import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ArrowLeft, ArrowUpRight, Clock, FileText } from 'lucide-react';
import type { ExecutionView } from '@clarix/contracts';
import { ApiError, fetchJson, postJson, sessionQuery } from '../lib/api';
import { useSession } from '../components/auth';
import { Button } from '../components/ui/button';
import { ErrorState, LoadingState } from '../components/feedback';
const terminal = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);
function Status({ value }: { value: string }) {
  return (
    <span className={`execution-status state-${value.toLowerCase()}`}>{value.toLowerCase()}</span>
  );
}
export function ActivityPage() {
  const query = useInfiniteQuery({
    queryKey: ['executions'],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      fetchJson<{ data: ExecutionView[]; nextCursor: string | null }>(
        `/api/executions${pageParam ? `?cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 5000,
  });
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">WORKSPACE HISTORY</span>
          <h1>
            Your activity<span>.</span>
          </h1>
          <p>Saved analyses, execution progress and source evidence.</p>
        </div>
        <Link className="button button-outline" to="/">
          New analysis <ArrowUpRight size={15} />
        </Link>
      </div>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState
          retry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <>
          <div className="activity-list">
            {query.data.pages
              .flatMap((page) => page.data)
              .map((execution) => (
                <Link key={execution.id} to={`/activity/${execution.id}`} className="activity-row">
                  <div className="service-icon purple">
                    <FileText size={21} />
                  </div>
                  <div className="activity-description">
                    <strong>{execution.serviceVersion.service.name}</strong>
                    <code>{execution.input.address ?? execution.input.hash}</code>
                    <small>{new Date(execution.createdAt).toLocaleString()}</small>
                  </div>
                  <Status value={execution.status} />
                  <ArrowUpRight size={17} />
                </Link>
              ))}
          </div>
          {query.data.pages[0]?.data.length === 0 && (
            <div className="feedback">
              <FileText size={28} />
              <h2>Your first report starts here</h2>
              <p>Choose an account or transaction from the marketplace.</p>
              <Link to="/" className="button button-primary">
                Explore services
              </Link>
            </div>
          )}
          {query.hasNextPage && (
            <Button
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => {
                void query.fetchNextPage();
              }}
            >
              Load older reports
            </Button>
          )}
        </>
      )}
    </div>
  );
}
export function ExecutionPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const session = useSession();
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const query = useQuery({
    queryKey: ['execution', id],
    queryFn: () => fetchJson<ExecutionView>(`/api/executions/${id}`),
    refetchInterval: (q) => (q.state.data && terminal.has(q.state.data.status) ? false : 5000),
  });
  const done = query.data ? terminal.has(query.data.status) : false;
  useEffect(() => {
    if (!id || done) return;
    const stream = new EventSource(`/api/executions/${id}/events`);
    stream.onmessage = () => {
      void client.invalidateQueries({ queryKey: ['execution', id] });
    };
    stream.addEventListener('expired', () => {
      stream.close();
      void client.invalidateQueries({ queryKey: sessionQuery.queryKey });
    });
    return () => stream.close();
  }, [id, done, client]);
  async function cancel() {
    setCancelling(true);
    setError('');
    try {
      await postJson(`/api/executions/${id}/cancel`, {}, session.csrfToken);
      await client.invalidateQueries({ queryKey: ['execution', id] });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to cancel.');
    } finally {
      setCancelling(false);
    }
  }
  if (query.isPending) return <LoadingState />;
  if (query.isError)
    return query.error instanceof ApiError && query.error.status === 404 ? (
      <div className="feedback">
        <h1>Report not found</h1>
        <Link to="/activity">Back to activity</Link>
      </div>
    ) : (
      <ErrorState
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const execution = query.data;
  return (
    <div className="page">
      <Link className="back-link" to="/activity">
        <ArrowLeft size={16} /> Back to activity
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SAVED REPORT · VERSION {execution.serviceVersion.version}</span>
          <h1>
            {execution.serviceVersion.service.name}
            <span>.</span>
          </h1>
          <p className="break-text">{execution.input.address ?? execution.input.hash}</p>
        </div>
        <Status value={execution.status} />
      </div>
      <div className="report-layout">
        <div>
          {execution.result ? (
            <Report result={execution.result} />
          ) : (
            <section className="detail-card">
              <h2>
                {execution.status === 'FAILED'
                  ? 'Analysis could not be completed'
                  : execution.status === 'CANCELLED'
                    ? 'Execution cancelled'
                    : 'Preparing your report'}
              </h2>
              <p>
                {execution.errorMessage ??
                  (done
                    ? 'No report was generated.'
                    : 'The worker is retrieving and checking Stellar Testnet data. You can leave this page; progress is saved.')}
              </p>
              {!done && (
                <div className="loading-state">
                  <span className="loader" /> Waiting for the worker
                </div>
              )}
            </section>
          )}
        </div>
        <aside className="detail-card timeline-card">
          <h2>
            <Clock size={17} /> Execution timeline
          </h2>
          <div className="preview-label">
            {execution.accessMode === 'PAID_TESTNET'
              ? 'Paid · Stellar Testnet'
              : 'Internal preview · No charge'}
          </div>
          <ol className="timeline">
            {execution.events.map((event) => (
              <li key={event.id}>
                <strong>{event.type.toLowerCase()}</strong>
                <p>{event.message}</p>
                <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
              </li>
            ))}
          </ol>
          <p>
            {execution.attempts} attempt{execution.attempts === 1 ? '' : 's'} · Created{' '}
            {new Date(execution.createdAt).toLocaleString()}
          </p>
          <details>
            <summary>Execution identifiers</summary>
            <code className="break-text">{execution.id}</code>
          </details>
          {!done && (
            <Button
              variant="outline"
              disabled={cancelling}
              onClick={() => {
                void cancel();
              }}
            >
              Cancel execution
            </Button>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
// Reports are persisted by our validated adapter. Keep rendering tolerant of older schema versions.
function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    : [];
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
function ExternalLink({ url, children }: { url: unknown; children: React.ReactNode }) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return <span>{children}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {children} ↗
    </a>
  );
}
function Report({ result }: { result: Record<string, unknown> }) {
  const evidence = object(result.evidence);
  const coverage = object(result.coverage);
  return (
    <div className="report-sections">
      <section className="detail-card">
        <span className="eyebrow">STELLAR TESTNET</span>
        <h2>Analysis summary</h2>
        <p>{String(result.summary)}</p>
        {result.type === 'transaction' && (
          <dl>
            <dt>Ledger</dt>
            <dd>{String(result.ledger)}</dd>
            <dt>Fee charged</dt>
            <dd>{String(result.feeStroops)} stroops</dd>
            <dt>Outcome</dt>
            <dd>{result.successful ? 'Succeeded' : 'Failed'}</dd>
            <dt>Memo</dt>
            <dd className="break-text">{String(result.memo ?? 'None')}</dd>
          </dl>
        )}
      </section>
      {result.type === 'account' && (
        <>
          <section className="detail-card">
            <h2>Assets & trustlines</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Balance</th>
                    <th>Issuer / pool</th>
                    <th>Trust limit</th>
                  </tr>
                </thead>
                <tbody>
                  {records(result.assets).map((asset, i) => (
                    <tr key={i}>
                      <td>
                        <strong>{String(asset.code)}</strong>
                        <small>{String(asset.type)}</small>
                      </td>
                      <td className="number">{String(asset.balance)}</td>
                      <td className="address-cell">
                        {String(asset.issuer ?? asset.poolId ?? 'Native asset')}
                      </td>
                      <td className="number">{String(asset.trustLimit ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="detail-card">
            <h2>Recent transactions</h2>
            <p>
              Latest {String(coverage.returned ?? 0)} available transactions, up to 20. This is a
              bounded history sample.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Transaction</th>
                    <th>Outcome</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {records(result.recentTransactions).map((tx) => (
                    <tr key={String(tx.hash)}>
                      <td>
                        <ExternalLink
                          url={`https://stellar.expert/explorer/testnet/tx/${String(tx.hash)}`}
                        >
                          <code>{String(tx.hash).slice(0, 16)}…</code>
                        </ExternalLink>
                      </td>
                      <td>{tx.successful ? 'Succeeded' : 'Failed'}</td>
                      <td>{new Date(String(tx.createdAt)).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {records(result.recentTransactions).length === 0 && (
              <p>No transactions in the provider’s available history.</p>
            )}
          </section>
        </>
      )}
      {result.type === 'transaction' && (
        <section className="detail-card">
          <h2>Operations</h2>
          <p>
            {String(coverage.returned)} of {String(result.operationCount)} operations returned.
          </p>
          <ol className="operation-list">
            {records(result.operations).map((operation, i) => (
              <li key={i}>
                <span className="operation-index">{i + 1}</span>
                <div>
                  <strong>{String(operation.type).replaceAll('_', ' ')}</strong>
                  <p className="break-text">{String(operation.explanation)}</p>
                  {!operation.decoded && (
                    <span className="preview-label">
                      Raw data available · Explanation unsupported
                    </span>
                  )}
                  <details>
                    <summary>Raw operation</summary>
                    <pre>{JSON.stringify(operation.raw, null, 2)}</pre>
                  </details>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="detail-card">
        <h2>Evidence & coverage</h2>
        <p>
          Retrieved {new Date(String(evidence.retrievedAt)).toLocaleString()}. This saved report is
          not a live balance.
        </p>
        <ExternalLink url={evidence.explorer}>View in Stellar Expert</ExternalLink>
        <ul className="evidence-list">
          {Array.isArray(evidence.sources) &&
            evidence.sources.map((source, i) => (
              <li key={i}>
                <ExternalLink url={source}>Source {i + 1}</ExternalLink>
              </li>
            ))}
        </ul>
        {Array.isArray(evidence.limitations) &&
          evidence.limitations.map((limit, i) => <p key={i}>{String(limit)}</p>)}
        <details>
          <summary>Complete report JSON</summary>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </details>
      </section>
    </div>
  );
}
