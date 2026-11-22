import { lazy, Suspense } from 'react';
const PaidAnalysis = lazy(() =>
  import('../components/paid-analysis').then((module) => ({ default: module.PaidAnalysis })),
);
import { useState, useRef, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useNavigate } from 'react-router';
import { ArrowLeft, Check, Fingerprint, LockKeyhole } from 'lucide-react';
import type { CatalogService } from '@clarix/contracts';
import { fetchJson, postJson } from '../lib/api';
import { ErrorState, LoadingState } from '../components/feedback';

import { useSession } from '../components/auth';
import { Button } from '../components/ui/button';
export function ServiceDetail() {
  const { slug } = useParams();
  const query = useQuery({
    queryKey: ['service', slug],
    queryFn: () =>
      fetchJson<{ data: CatalogService }>(`/api/services/${encodeURIComponent(slug ?? '')}`),
  });
  if (query.isPending) return <LoadingState />;
  if (query.isError)
    return (
      <ErrorState
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const service = query.data.data;
  return (
    <div className="page detail-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} /> Back to marketplace
      </Link>
      <div className="detail-layout">
        <section className="detail-card">
          <div className="service-icon purple">
            <Fingerprint size={25} />
          </div>
          <span className="eyebrow">{service.provider.name}</span>
          <h1>{service.name}</h1>
          <p>{service.description}</p>
          <h2>Capabilities</h2>
          <ul className="capabilities-list">
            {service.capabilities.map((capability) => (
              <li key={capability}>
                <Check size={17} />
                {capability}
              </li>
            ))}
          </ul>
          <dl>
            <dt>Tool identifier</dt>
            <dd>
              <code>{service.slug}</code>
            </dd>
            <dt>Network</dt>
            <dd>{service.network}</dd>
            <dt>Status</dt>
            <dd>{service.status === 'PLANNED' ? 'In development' : service.status}</dd>
          </dl>
        </section>
        <RunAnalysis key={service.slug} service={service} />
      </div>
    </div>
  );
}

function RunAnalysis({ service }: { service: CatalogService }) {
  const session = useSession();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [loadingExample, setLoadingExample] = useState(false);
  const [error, setError] = useState('');
  const requestKey = useRef({ value: '', key: crypto.randomUUID() });
  const account = service.slug === 'analyze_account';
  async function example() {
    setLoadingExample(true);
    setError('');
    try {
      const data = await fetchJson<{ address: string; hash: string }>('/api/stellar/examples');
      setValue(account ? data.address : data.hash);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No example is available.');
    } finally {
      setLoadingExample(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const normalized = value.trim();
    if (requestKey.current.value !== normalized)
      requestKey.current = { value: normalized, key: crypto.randomUUID() };
    try {
      const execution = await postJson<{ id: string }>(
        '/api/executions',
        { service: service.slug, input: account ? { address: normalized } : { hash: normalized } },
        session.csrfToken,
        { 'Idempotency-Key': requestKey.current.key },
      );
      navigate(`/activity/${execution.id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to start analysis.');
    } finally {
      setPending(false);
    }
  }
  return (
    <aside className="detail-card execution-note">
      <LockKeyhole size={24} />
      <h2>Run an analysis</h2>
      <p>Read Stellar Testnet data and save an evidence-backed report to your workspace.</p>
      <div className="preview-label">Internal preview · No charge</div>
      <form className="form-stack" onSubmit={submit}>
        <label htmlFor="analysis-input">
          {account ? 'Stellar account address' : 'Transaction hash'}
        </label>
        <input
          id="analysis-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={account ? 'G…' : '64-character transaction hash'}
          required
          spellCheck={false}
          autoComplete="off"
          maxLength={account ? 56 : 64}
          disabled={pending}
        />
        <small>
          {account ? 'An existing G-address on Testnet.' : 'A transaction recorded on Testnet.'}
        </small>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button disabled={pending || service.status !== 'ACTIVE'} type="submit">
          {pending ? 'Starting analysis…' : 'Generate report'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={loadingExample || pending}
          onClick={() => {
            void example();
          }}
        >
          {loadingExample ? 'Finding recent activity…' : 'Use a recent Testnet example'}
        </Button>
      </form>
      <Suspense fallback={null}>
        <PaidAnalysis
          disabled={pending || !value.trim() || service.status !== 'ACTIVE'}
          request={{
            service: service.slug,
            input: account ? { address: value.trim() } : { hash: value.trim() },
          }}
        />
      </Suspense>
    </aside>
  );
}
