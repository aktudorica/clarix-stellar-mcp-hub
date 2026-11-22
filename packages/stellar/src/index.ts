import { Networks, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { z } from 'zod';

export const serviceInput = z.discriminatedUnion('service', [
  z
    .object({
      service: z.literal('analyze_account'),
      input: z
        .object({
          address: z
            .string()
            .trim()
            .refine(StrKey.isValidEd25519PublicKey, 'Enter a valid Stellar G… account address'),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      service: z.literal('explain_transaction'),
      input: z
        .object({
          hash: z
            .string()
            .trim()
            .regex(/^[a-fA-F0-9]{64}$/, 'Enter a 64-character transaction hash')
            .transform((hash) => hash.toLowerCase()),
        })
        .strict(),
    })
    .strict(),
]);
export type ServiceRequest = z.infer<typeof serviceInput>;

export class AnalysisError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

const transactionSchema = z.object({
  hash: z.string(),
  successful: z.boolean(),
  ledger: z.number(),
  created_at: z.string(),
  source_account: z.string(),
  fee_charged: z.string(),
  operation_count: z.number(),
  envelope_xdr: z.string(),
  result_xdr: z.string(),
  memo_type: z.string(),
  memo: z.string().optional(),
});
const balanceSchema = z.object({
  balance: z.string(),
  asset_type: z.string(),
  asset_code: z.string().optional(),
  asset_issuer: z.string().optional(),
  liquidity_pool_id: z.string().optional(),
  limit: z.string().optional(),
  is_authorized: z.boolean().optional(),
});
const accountSchema = z.object({
  account_id: z.string(),
  sequence: z.string(),
  subentry_count: z.number(),
  last_modified_ledger: z.number(),
  home_domain: z.string().optional(),
  balances: z.array(balanceSchema),
  thresholds: z.object({
    low_threshold: z.number(),
    med_threshold: z.number(),
    high_threshold: z.number(),
  }),
  signers: z.array(z.object({ key: z.string(), weight: z.number(), type: z.string() })),
});

export interface StellarAnalysisSource {
  analyze(request: ServiceRequest): Promise<Record<string, unknown>>;
}
export class StellarReader implements StellarAnalysisSource {
  readonly horizonUrl: string;
  constructor(url = process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org') {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && process.env.NODE_ENV !== 'test')
      throw new Error('Stellar data source must use HTTPS');
    this.horizonUrl = parsed.toString().replace(/\/$/, '');
  }

  private async read(path: string): Promise<unknown> {
    try {
      const response = await fetch(`${this.horizonUrl}${path}`, {
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
        headers: { Accept: 'application/json' },
      });
      if (response.status === 404)
        throw new AnalysisError(
          'NOT_FOUND',
          'This record was not found in the testnet provider’s available history. The account may be unfunded or the record may no longer be retained.',
        );
      if (!response.ok)
        throw new AnalysisError(
          'UPSTREAM_UNAVAILABLE',
          'The Stellar data provider is temporarily unavailable.',
          response.status === 429 || response.status >= 500,
        );
      const reader = response.body?.getReader();
      if (!reader)
        throw new AnalysisError(
          'INVALID_PROVIDER_RESPONSE',
          'The provider returned an empty response.',
        );
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 2_000_000) {
            await reader.cancel();
            throw new AnalysisError(
              'RESPONSE_TOO_LARGE',
              'The provider response exceeded the allowed size.',
            );
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new AnalysisError('INVALID_PROVIDER_RESPONSE', 'The provider returned invalid JSON.');
      }
    } catch (error) {
      if (error instanceof AnalysisError) throw error;
      throw new AnalysisError(
        'UPSTREAM_UNAVAILABLE',
        'The Stellar data request could not be completed. It will be retried within the execution limit.',
        true,
      );
    }
  }

  private async verifyNetwork() {
    const root = z.object({ network_passphrase: z.string() }).parse(await this.read('/'));
    if (root.network_passphrase !== Networks.TESTNET)
      throw new AnalysisError(
        'WRONG_NETWORK',
        'This data provider is not connected to Stellar Testnet.',
      );
  }

  async examples() {
    await this.verifyNetwork();
    const result = z
      .object({ _embedded: z.object({ records: z.array(transactionSchema) }) })
      .parse(await this.read('/transactions?limit=1&order=desc&include_failed=false'));
    const transaction = result._embedded.records[0];
    if (!transaction)
      throw new AnalysisError('NO_EXAMPLES', 'No recent testnet transaction is available.');
    if (
      !StrKey.isValidEd25519PublicKey(transaction.source_account) ||
      !/^[a-f0-9]{64}$/.test(transaction.hash)
    )
      throw new AnalysisError('INVALID_PROVIDER_RESPONSE', 'The example could not be validated.');
    return {
      address: transaction.source_account,
      hash: transaction.hash,
      network: 'stellar:testnet',
    };
  }

  async analyze(request: ServiceRequest): Promise<Record<string, unknown>> {
    try {
      await this.verifyNetwork();
      return request.service === 'analyze_account'
        ? await this.account(request.input.address)
        : await this.transaction(request.input.hash);
    } catch (error) {
      if (error instanceof AnalysisError) throw error;
      throw new AnalysisError(
        'INVALID_PROVIDER_RESPONSE',
        'The provider returned data that could not be safely interpreted.',
      );
    }
  }

  private evidence(resource: string, apiPaths: string[]) {
    return {
      network: 'stellar:testnet',
      retrievedAt: new Date().toISOString(),
      provider: this.horizonUrl,
      sources: apiPaths.map((path) => `${this.horizonUrl}${path}`),
      explorer: `https://stellar.expert/explorer/testnet/${resource}`,
      limitations: [
        'Testnet data; no fiat valuations or security/risk assessment.',
        'Provider reads are bounded and are not an atomic ledger snapshot.',
      ],
    };
  }

  private async account(address: string) {
    const path = `/accounts/${address}`;
    const historyPath = `${path}/transactions?limit=20&order=desc&include_failed=true`;
    const [accountData, historyData] = await Promise.all([this.read(path), this.read(historyPath)]);
    const account = accountSchema.parse(accountData);
    if (account.account_id !== address)
      throw new AnalysisError('RESOURCE_MISMATCH', 'The provider returned a different account.');
    const transactions = z
      .object({ _embedded: z.object({ records: z.array(transactionSchema) }) })
      .parse(historyData)._embedded.records;
    return {
      type: 'account',
      address,
      sequence: account.sequence,
      lastModifiedLedger: account.last_modified_ledger,
      homeDomain: account.home_domain ?? null,
      subentryCount: account.subentry_count,
      thresholds: account.thresholds,
      signers: account.signers,
      assets: account.balances.map((balance) => ({
        code: balance.asset_type === 'native' ? 'XLM' : (balance.asset_code ?? 'POOL_SHARE'),
        issuer: balance.asset_issuer ?? null,
        poolId: balance.liquidity_pool_id ?? null,
        balance: balance.balance,
        type: balance.asset_type,
        trustLimit: balance.limit ?? null,
        authorized: balance.is_authorized ?? null,
      })),
      recentTransactions: transactions.map((tx) => ({
        hash: tx.hash,
        successful: tx.successful,
        ledger: tx.ledger,
        createdAt: tx.created_at,
        operationCount: tx.operation_count,
        feeStroops: tx.fee_charged,
      })),
      coverage: {
        maxTransactions: 20,
        returned: transactions.length,
        oldest: transactions.at(-1)?.created_at ?? null,
        newest: transactions[0]?.created_at ?? null,
        completeHistory: false,
      },
      summary: `The account holds ${account.balances.length} balance ${account.balances.length === 1 ? 'entry' : 'entries'}. This report includes up to 20 recent transactions; it does not represent the account’s complete history.`,
      evidence: this.evidence(`account/${address}`, [path, historyPath]),
    };
  }

  private async transaction(hash: string) {
    const path = `/transactions/${hash}`;
    const tx = transactionSchema.parse(await this.read(path));
    if (tx.hash !== hash)
      throw new AnalysisError(
        'RESOURCE_MISMATCH',
        'The provider returned a different transaction.',
      );
    const envelope = TransactionBuilder.fromXDR(tx.envelope_xdr, Networks.TESTNET);
    if (Buffer.from(envelope.hash()).toString('hex') !== hash)
      throw new AnalysisError(
        'RESOURCE_MISMATCH',
        'The transaction envelope does not match the requested hash.',
      );
    const inner = 'innerTransaction' in envelope ? envelope.innerTransaction : envelope;
    const opPath = `${path}/operations?limit=100&order=asc&include_failed=true`;
    const operations = z
      .object({ _embedded: z.object({ records: z.array(z.record(z.string(), z.unknown())) }) })
      .parse(await this.read(opPath))._embedded.records;
    return {
      type: 'transaction',
      hash,
      successful: tx.successful,
      ledger: tx.ledger,
      createdAt: tx.created_at,
      sourceAccount: tx.source_account,
      feeStroops: tx.fee_charged,
      operationCount: tx.operation_count,
      memo: tx.memo ?? null,
      memoType: tx.memo_type,
      envelopeXdr: tx.envelope_xdr,
      resultXdr: tx.result_xdr,
      operationTypes: inner.operations.map((operation) => operation.type),
      operations: operations.map((operation) => this.describeOperation(operation, tx.successful)),
      coverage: {
        maxOperations: 100,
        returned: operations.length,
        complete: operations.length === tx.operation_count,
      },
      summary:
        `This transaction ${tx.successful ? 'succeeded' : 'failed'} in ledger ${tx.ledger}. It contains ${tx.operation_count} operations and was charged ${tx.fee_charged} stroops. ${tx.successful ? '' : 'The listed operations describe intent, not successful transfers.'}`.trim(),
      evidence: this.evidence(`tx/${hash}`, [path, opPath]),
    };
  }

  private describeOperation(operation: Record<string, unknown>, succeeded: boolean) {
    const { _links, ...raw } = operation;
    const prefix = succeeded ? '' : 'Attempted: ';
    let explanation: string | null = null;
    if (operation.type === 'payment')
      explanation = `${prefix}Transfer ${operation.amount} ${operation.asset_code ?? 'XLM'} from ${operation.from} to ${operation.to}.`;
    if (operation.type === 'create_account')
      explanation = `${prefix}Create ${operation.account} with ${operation.starting_balance} XLM.`;
    if (operation.type === 'change_trust')
      explanation = `${prefix}Set trust limit ${operation.limit} for ${operation.asset_code ?? 'pool share'}.`;
    return {
      id: String(operation.id),
      type: String(operation.type),
      decoded: explanation !== null,
      explanation:
        explanation ??
        'No human explanation is implemented for this operation type. Inspect the raw operation data.',
      raw,
    };
  }
}
