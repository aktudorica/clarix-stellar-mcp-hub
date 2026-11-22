import { Card, CardContent } from '../components/ui/card';
import { useMemo, useState, type FormEvent } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Sparkles, Send } from 'lucide-react';
import { useSession } from '../components/auth';
import { Button } from '../components/ui/button';
import { fetchJson, postJson } from '../lib/api';
import { toast } from 'sonner';

export function AgentPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [starting, setStarting] = useState(false);
  const config = useQuery({
    queryKey: ['agent-configuration'],
    queryFn: () =>
      fetchJson<{ agent: { enabled: boolean; model: string | null } }>('/api/integrations'),
  });
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/agent/chat',
        headers: { 'X-CSRF-Token': session.csrfToken },
        credentials: 'same-origin',
      }),
    [session.csrfToken],
  );
  const { messages, sendMessage, setMessages, status, error, stop } = useChat({ transport });
  const busy = status === 'submitted' || status === 'streaming';
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim() || busy || !config.data?.agent.enabled) return;
    const text = input.trim();
    setInput('');
    setMessages([]);
    await sendMessage({ text });
  }
  async function approve(request: unknown, callId: string) {
    setStarting(true);
    try {
      const encoded = new TextEncoder().encode(callId);
      const digest = await crypto.subtle.digest('SHA-256', encoded);
      const key =
        'agent_' +
        Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      const execution = await postJson<{ id: string }>(
        '/api/executions',
        request,
        session.csrfToken,
        { 'Idempotency-Key': key },
      );
      navigate(`/activity/${execution.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to start analysis.');
    } finally {
      setStarting(false);
    }
  }
  return (
    <div className="integrations-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">STELLAR ASSISTANT</span>
          <h1>Ask Clarix</h1>
          <p>Explore services, inspect a saved report, or prepare an analysis.</p>
        </div>
        <Sparkles size={30} />
      </div>
      <Card className="agent-card">
        <CardContent>
          {config.isError ? (
            <div role="alert">
              <p>Cannot load agent configuration.</p>
              <Button variant="outline" onClick={() => void config.refetch()}>
                Retry configuration
              </Button>
            </div>
          ) : !config.data?.agent.enabled ? (
            <div className="integration-stack">
              {config.isPending
                ? 'Loading…'
                : 'The agent is not configured. Set LLM_BASE_URL and LLM_MODEL in the server environment, plus LLM_API_KEY if your provider requires it.'}
            </div>
          ) : (
            <p className="muted">
              Model: {config.data.agent.model}. Each request starts a new context. Reports remain
              available in Activity.
            </p>
          )}
          <div className="agent-messages" aria-live="polite">
            {messages.map((message) => (
              <article key={message.id} className={`agent-message ${message.role}`}>
                <strong>{message.role === 'user' ? 'You' : 'Clarix'}</strong>
                {message.parts.map((part, index) => {
                  if (part.type === 'text')
                    return (
                      <p key={index} className="agent-text">
                        {part.text}
                      </p>
                    );
                  if (part.type.startsWith('tool-') && 'state' in part) {
                    const item = part as unknown as {
                      state: string;
                      toolCallId: string;
                      output?: { request?: unknown; approvalRequired?: boolean };
                    };
                    if (
                      part.type === 'tool-propose_analysis' &&
                      item.state === 'output-available' &&
                      item.output?.approvalRequired
                    )
                      return (
                        <div key={index} className="agent-proposal">
                          <strong>Review proposed analysis</strong>
                          <pre>{JSON.stringify(item.output.request, null, 2)}</pre>
                          <Button
                            disabled={starting || busy}
                            onClick={() =>
                              void approve(item.output!.request, `${message.id}:${item.toolCallId}`)
                            }
                          >
                            Approve and run preview analysis
                          </Button>
                        </div>
                      );
                    return (
                      <small key={index}>
                        {part.type.slice(5).replaceAll('_', ' ')} ·{' '}
                        {item.state === 'output-available'
                          ? 'Completed'
                          : item.state === 'output-error'
                            ? 'Failed'
                            : 'Working…'}
                      </small>
                    );
                  }
                  return null;
                })}
              </article>
            ))}
          </div>
          {busy && (
            <p role="status" className="muted">
              Clarix is processing your request…
            </p>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error.message}
            </p>
          )}
          <form className="form-stack" onSubmit={submit}>
            <label htmlFor="agent-prompt">Your request</label>
            <textarea
              id="agent-prompt"
              rows={3}
              maxLength={4000}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="What can you analyze on Stellar Testnet?"
              disabled={busy || !config.data?.agent.enabled}
            />
            <div className="integration-actions">
              <Button type="submit" disabled={busy || !input.trim() || !config.data?.agent.enabled}>
                <Send size={16} /> Ask Clarix
              </Button>
              {busy && (
                <Button type="button" variant="outline" onClick={() => void stop()}>
                  Stop
                </Button>
              )}
            </div>
          </form>
          <p className="muted">
            The agent can read workspace reports and propose actions. Starting an analysis requires
            your confirmation. It cannot sign or pay.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
