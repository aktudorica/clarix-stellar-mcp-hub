import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router';
import type { SessionView } from '@clarix/contracts';
import { fetchJson, postJson, sessionQuery } from '../lib/api';
import { Button } from '../components/ui/button';
export function Login() {
  const current = useQuery(sessionQuery);
  const configuration = useQuery({
    queryKey: ['auth-configuration'],
    queryFn: () => fetchJson<{ registration: boolean }>('/api/auth/configuration'),
  });
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [register, setRegister] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const from = (location.state as { from?: string } | null)?.from;
  const target = from?.startsWith('/') && !from.startsWith('//') && from !== '/login' ? from : '/';
  if (current.data) return <Navigate to={target} replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const data = new FormData(event.currentTarget);
    const body = {
      email: data.get('email'),
      password: data.get('password'),
      ...(register ? { name: data.get('name'), workspaceName: data.get('workspaceName') } : {}),
    };
    try {
      const session = await postJson<SessionView>(
        `/api/auth/${register ? 'register' : 'login'}`,
        body,
      );
      await client.cancelQueries();
      client.clear();
      client.setQueryData(sessionQuery.queryKey, session);
      navigate(target, { replace: true });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to sign in.');
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <img src="/favicon.svg" alt="Clarix" />
        <span className="eyebrow">CLARIX AGENT HUB · TESTNET</span>
        <h1>
          Understand the chain.
          <br />
          <span>Keep the evidence.</span>
        </h1>
        <p>
          Explore accounts and transactions with traceable Stellar data. Every report stays in your
          workspace.
        </p>
        <div className="preview-label">Internal preview · No payment required</div>
      </section>
      <section className="auth-card">
        <span className="eyebrow">YOUR WORKSPACE</span>
        <h2>{register ? 'Create your account' : 'Welcome back'}</h2>
        <p>
          {register
            ? 'Create a private workspace for your reports.'
            : 'Sign in to continue your analysis.'}
        </p>
        <form className="form-stack" onSubmit={submit}>
          {register && (
            <>
              <label htmlFor="name">Your name</label>
              <input
                id="name"
                name="name"
                autoComplete="name"
                minLength={2}
                maxLength={80}
                required
              />
              <label htmlFor="workspace">Workspace name</label>
              <input id="workspace" name="workspaceName" minLength={2} maxLength={80} required />
            </>
          )}
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={register ? 'new-password' : 'current-password'}
            minLength={12}
            maxLength={128}
            required
          />
          {register && <small>At least 12 characters.</small>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? 'Please wait…' : register ? 'Create workspace' : 'Sign in'}
          </Button>
        </form>
        {configuration.data?.registration && (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setRegister(!register);
              setError('');
            }}
          >
            {register ? 'Already have an account? Sign in' : 'New here? Create a workspace'}
          </Button>
        )}
        <p className="auth-footnote">
          Private preview. Account recovery and public registration are not available.
        </p>
      </section>
    </main>
  );
}
