import { Link } from 'react-router';
import { useState, useRef } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Label from '@radix-ui/react-label';
import * as Select from '@radix-ui/react-select';
import * as Tooltip from '@radix-ui/react-tooltip';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { isConnected, requestAccess, getNetwork, getAddress } from '@stellar/freighter-api';
import { Networks, StrKey } from '@stellar/stellar-sdk';
import { Wallet, Plug, KeyRound, ChevronDown, Copy, ShieldCheck } from 'lucide-react';
import { useSession } from '../components/auth';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ui/dialog';
import { fetchJson, postJson } from '../lib/api';

export function IntegrationsPage() {
  const session = useSession();
  const createTokenButton = useRef<HTMLButtonElement>(null);
  const [wallet, setWallet] = useState('');
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState('read');
  const [token, setToken] = useState<{ token: string; expiresAt: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const payments = useQuery({
    queryKey: ['payments'],
    queryFn: () =>
      fetchJson<{
        data: Array<{
          id: string;
          status: string;
          executionId: string | null;
          transactionHash: string | null;
        }>;
      }>('/api/payments'),
    refetchInterval: 15000,
  });
  const config = useQuery({
    queryKey: ['integrations'],
    queryFn: () => fetchJson<{ framework: string; authentication: string }>('/api/integrations'),
  });
  async function connect() {
    setBusy(true);
    try {
      const extension = await isConnected();
      if (extension.error || !extension.isConnected)
        throw new Error(
          'Install Freighter and open this app in the browser where its extension is enabled.',
        );
      const access = await requestAccess();
      if (access.error || !StrKey.isValidEd25519PublicKey(access.address))
        throw new Error(access.error?.message ?? 'Wallet access was not granted.');
      const network = await getNetwork();
      if (network.error || network.networkPassphrase !== Networks.TESTNET)
        throw new Error('Switch Freighter to Stellar Testnet and connect again.');
      const current = await getAddress();
      if (current.address !== access.address)
        throw new Error('The selected wallet changed. Connect again.');
      setWallet(access.address);
      toast.success('Freighter connected on Testnet');
    } catch (error) {
      setWallet('');
      toast.error(error instanceof Error ? error.message : 'Wallet connection failed.');
    } finally {
      setBusy(false);
    }
  }
  async function issue() {
    setBusy(true);
    try {
      const issued = await postJson<{ token: string; expiresAt: string }>(
        '/api/integrations/mcp/token',
        { execute: permission === 'execute' },
        session.csrfToken,
      );
      setToken(issued);
      setConfirm(false);
      toast.success('MCP token created. Copy it now.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create a token.');
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    setBusy(true);
    try {
      await postJson('/api/integrations/mcp/revoke', {}, session.csrfToken);
      setToken(null);
      toast.success('Your MCP token was revoked');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not revoke token.');
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copied');
    } catch {
      toast.error('Clipboard unavailable. Select and copy the text manually.');
    }
  }
  return (
    <div className="integrations-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">WORKSPACE CONNECTIONS</span>
          <h1>Integrations</h1>
          <p>Connect a wallet and give your agents scoped access.</p>
        </div>
        <Plug size={30} />
      </div>
      <div className="integration-stack">
        <ShieldCheck size={17} />{' '}
        {config.isError
          ? 'Configuration unavailable'
          : config.data
            ? `${config.data.framework} · ${config.data.authentication} · Stellar Testnet`
            : 'Loading configuration…'}
      </div>
      <Tabs.Root defaultValue="wallet">
        <Tabs.List className="integration-tabs" aria-label="Integration settings">
          <Tabs.Trigger value="wallet">
            <Wallet size={17} />
            Wallet
          </Tabs.Trigger>
          <Tabs.Trigger value="payments">Payments</Tabs.Trigger>
          <Tabs.Trigger value="mcp">
            <KeyRound size={17} />
            MCP access
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="wallet" className="integration-panel">
          <h2>Freighter wallet</h2>
          <p>
            Share your public address with this browser tab. Your secret key stays in Freighter.
          </p>
          <p className="muted">
            Connection alone does not prove ownership to the server or authorize a payment. Any
            future payment requires a separate wallet confirmation.
          </p>
          {wallet && (
            <div className="code-box">
              <code>{wallet}</code>
              <Button
                variant="ghost"
                onClick={() => void copy(wallet)}
                aria-label="Copy wallet address"
              >
                <Copy size={16} />
              </Button>
            </div>
          )}
          <div className="integration-actions">
            <Button disabled={busy} onClick={() => void connect()}>
              {busy ? 'Waiting for wallet…' : wallet ? 'Refresh connection' : 'Connect Freighter'}
            </Button>
            {wallet && (
              <Button variant="outline" onClick={() => setWallet('')}>
                Disconnect this tab
              </Button>
            )}
          </div>
        </Tabs.Content>
        <Tabs.Content value="payments" className="integration-panel">
          <h2>Testnet payments</h2>
          <p>
            Latest 20 orders in this workspace. A pending or uncertain settlement must be reconciled
            before another payment.
          </p>
          {payments.isPending ? (
            <p>Loading payments…</p>
          ) : payments.isError ? (
            <p role="alert">Unable to load payment history.</p>
          ) : payments.data.data.length === 0 ? (
            <p className="muted">
              No payment orders yet. The paid demo is available from each service when the
              facilitator and recipient are configured.
            </p>
          ) : (
            payments.data.data.map((order) => (
              <div className="payment-record" key={order.id}>
                <strong>{order.status}</strong>
                <code>{order.id}</code>
                {order.transactionHash && <code>Transaction: {order.transactionHash}</code>}
                {order.executionId && (
                  <Link to={`/activity/${order.executionId}`}>Open report</Link>
                )}
                {order.status === 'PAID' && !order.executionId && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await postJson(`/api/payments/${order.id}/pay`, {}, session.csrfToken);
                        await payments.refetch();
                        toast.success('Paid analysis queued');
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : 'Unable to queue analysis.',
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Resume paid analysis — no new payment
                  </Button>
                )}
                {['UNKNOWN', 'SETTLING'].includes(order.status) && (
                  <p role="alert">Do not pay again. Retain this order ID for reconciliation.</p>
                )}
              </div>
            ))
          )}
        </Tabs.Content>
        <Tabs.Content value="mcp" className="integration-panel">
          <h2>Agent access</h2>
          <p>
            One token per user and workspace, valid for seven days. Creating a new token revokes
            your previous one.
          </p>
          <Label.Root htmlFor="mcp-permission">Permissions</Label.Root>
          <Select.Root value={permission} onValueChange={setPermission}>
            <Select.Trigger id="mcp-permission" className="integration-select">
              <Select.Value />
              <Select.Icon>
                <ChevronDown size={16} />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content position="popper" className="integration-options">
                <Select.Viewport>
                  <Select.Item value="read">
                    <Select.ItemText>Read catalog and workspace reports</Select.ItemText>
                  </Select.Item>
                  <Select.Item value="execute">
                    <Select.ItemText>Read and run preview analyses</Select.ItemText>
                  </Select.Item>
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>
          <p className="muted">
            Execution permission allows agents to queue internal preview analyses. It does not grant
            permission to spend funds.
          </p>
          <div className="integration-actions">
            <Button ref={createTokenButton} disabled={busy} onClick={() => setConfirm(true)}>
              Create token
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void revoke()}>
              Revoke my token
            </Button>
          </div>
          {token && (
            <div className="token-result">
              <strong>Copy now — shown only in this tab</strong>
              <div className="code-box">
                <code>{token.token}</code>
                <Tooltip.Provider>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Button
                        variant="ghost"
                        onClick={() => void copy(token.token)}
                        aria-label="Copy MCP token"
                      >
                        <Copy size={16} />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content className="tooltip-content">Copy token</Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                </Tooltip.Provider>
              </div>
              <p>Expires {new Date(token.expiresAt).toLocaleString()}</p>
            </div>
          )}
          <h3>Connect your MCP client</h3>
          <p>
            Transport: Streamable HTTP. Add the token as the <code>Authorization: Bearer …</code>{' '}
            header.
          </p>
          <div className="code-box">
            <code>{window.location.origin}/api/mcp</code>
          </div>
          <p className="muted">
            Read-only tools: discover_services, list_executions, get_execution. With execution
            permission: run_analysis.
          </p>
        </Tabs.Content>
      </Tabs.Root>
      <ConfirmDialog
        returnFocus={createTokenButton}
        open={confirm}
        onOpenChange={setConfirm}
        title="Create MCP token?"
        description={`This revokes your previous token and grants ${permission === 'execute' ? 'read and preview execution' : 'read-only'} access to ${session.workspace.name}.`}
      >
        <div className="integration-actions">
          <Button disabled={busy} onClick={() => void issue()}>
            {busy ? 'Creating…' : 'Create token'}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
            Cancel
          </Button>
        </div>
      </ConfirmDialog>
    </div>
  );
}
