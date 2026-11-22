import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { requestAccess, getNetwork, getAddress, signAuthEntry } from '@stellar/freighter-api';
import { Networks, StrKey } from '@stellar/stellar-sdk';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import type { PaymentRequirements } from '@x402/core/types';
import { useSession } from './auth';
import { Button } from './ui/button';
import { ConfirmDialog } from './ui/dialog';
import { fetchJson, postJson } from '../lib/api';

type Quote = {
  request: unknown;
  id: string;
  status: string;
  expiresAt: string;
  requirement: PaymentRequirements;
  executionId: string | null;
  transactionHash: string | null;
};
export function PaidAnalysis({ request, disabled }: { request: unknown; disabled: boolean }) {
  const session = useSession();
  const prepareButton = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const intent = useRef({ value: '', key: crypto.randomUUID() });
  const config = useQuery({
    queryKey: ['payments-config'],
    queryFn: () => fetchJson<{ payments: { enabled: boolean } }>('/api/integrations'),
  });
  async function prepare() {
    setBusy(true);
    setError('');
    try {
      const value = JSON.stringify(request);
      if (value !== intent.current.value) intent.current = { value, key: crypto.randomUUID() };
      const prepared = await postJson<Quote>('/api/payments/quotes', request, session.csrfToken, {
        'Idempotency-Key': intent.current.key,
      });
      setQuote(prepared);
      setOpen(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to prepare payment.');
    } finally {
      setBusy(false);
    }
  }
  async function pay() {
    if (!quote) return;
    setBusy(true);
    setError('');
    try {
      // Check persisted status first. Reopening the dialog must not authorize another transfer.
      const current = await fetchJson<Quote>(`/api/payments/${quote.id}`);
      setQuote(current);
      if (current.executionId) {
        navigate(`/activity/${current.executionId}`);
        return;
      }
      if (!['QUOTED', 'PAID'].includes(current.status))
        throw new Error('This payment requires reconciliation. Do not pay again.');
      if (current.status === 'QUOTED' && new Date(current.expiresAt) <= new Date())
        throw new Error('Quote expired. Close the dialog and request a new quote.');
      let paidFetch: typeof fetch = fetch;
      if (current.status === 'QUOTED') {
        const access = await requestAccess();
        if (access.error || !StrKey.isValidEd25519PublicKey(access.address))
          throw new Error(access.error?.message ?? 'Freighter access was not granted.');
        const network = await getNetwork();
        if (network.error || network.networkPassphrase !== Networks.TESTNET)
          throw new Error('Select Stellar Testnet in Freighter.');
        const client = new x402Client().register(
          'stellar:testnet',
          new ExactStellarScheme({
            address: access.address,
            signAuthEntry: async (entry, options) => {
              const active = await getAddress();
              const network = await getNetwork();
              if (
                active.address !== access.address ||
                network.networkPassphrase !== Networks.TESTNET
              )
                throw new Error('Wallet or network changed. Review the payment again.');
              const signed = await signAuthEntry(entry, {
                ...options,
                address: access.address,
                networkPassphrase: Networks.TESTNET,
              });
              if (
                signed.error ||
                !signed.signedAuthEntry ||
                signed.signerAddress !== access.address
              )
                throw new Error(signed.error?.message ?? 'Payment signature was not approved.');
              return {
                signedAuthEntry: signed.signedAuthEntry,
                signerAddress: signed.signerAddress,
              };
            },
          }),
        );
        client.registerPolicy((version, requirements) =>
          version === 2
            ? requirements.filter(
                (item) =>
                  item.network === 'stellar:testnet' &&
                  item.scheme === 'exact' &&
                  item.amount === current.requirement.amount &&
                  item.asset === current.requirement.asset &&
                  item.payTo === current.requirement.payTo,
              )
            : [],
        );
        // The automatic 402 retry is only enabled after this explicit confirmation.
        paidFetch = wrapFetchWithPayment(fetch, client);
      }
      const result = await paidFetch(`/api/payments/${current.id}/pay`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken },
        body: '{}',
        signal: AbortSignal.timeout(180000),
      });
      const data = await result.json();
      if (!result.ok)
        throw new Error(
          data.message ?? 'Payment did not complete. Check status before trying again.',
        );
      navigate(`/activity/${data.id}`);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Payment status unknown. Check before retrying.',
      );
    } finally {
      setBusy(false);
    }
  }
  const amount = quote
    ? `${BigInt(quote.requirement.amount) / 10000000n}.${(BigInt(quote.requirement.amount) % 10000000n).toString().padStart(7, '0')}`
    : '';
  return (
    <div className="paid-analysis">
      <Button
        type="button"
        variant="outline"
        disabled={disabled || busy || !config.data?.payments.enabled}
        ref={prepareButton}
        onClick={() => void prepare()}
      >
        Try paid Testnet flow
      </Button>
      {!config.data?.payments.enabled && (
        <small>Paid demo awaits a recipient wallet and facilitator configuration.</small>
      )}
      {!open && error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <ConfirmDialog
        returnFocus={prepareButton}
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            if (
              !value &&
              quote &&
              new Date(quote.expiresAt) <= new Date() &&
              quote.status === 'QUOTED'
            )
              intent.current.value = '';
          }
        }}
        title="Confirm Testnet payment"
        description="Review this transfer before opening Freighter. Testnet tokens have no monetary value."
      >
        {quote && (
          <>
            <p>
              <strong>{amount} USDC · Stellar Testnet</strong>
            </p>
            <p>Status: {quote.status}</p>
            <div className="code-box">
              <code>{JSON.stringify(quote.request, null, 2)}</code>
            </div>
            <p>Recipient</p>
            <div className="code-box">
              <code>{quote.requirement.payTo}</code>
            </div>
            <small>
              Quote expires {new Date(quote.expiresAt).toLocaleTimeString()}. Settlement is recorded
              before the analysis is queued. Failed analyses do not automatically refund the test
              payment.
            </small>
          </>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="integration-actions">
          <Button disabled={busy} onClick={() => void pay()}>
            {busy ? 'Waiting for wallet / settlement…' : 'Confirm and continue'}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </ConfirmDialog>
    </div>
  );
}
