# Implementation plan after the Docker foundation

Status: stages 1–4 implemented on 2026-09-25. The next milestone (authenticated account analysis with persistent history) is implemented, together with deterministic transaction analysis. Stages 5–6 now have package-backed demonstration flows: Freighter/x402 with persisted orders, scoped MCP v2 and an AI SDK runner with explicit UI approval. Live wallet/facilitator/model validation, automatic reconciliation and monetary spending budgets remain pending. See [current integration behavior](integrations.md). OpenTelemetry spans/export also remain pending; current logs correlate API acceptance, outbox dispatch and worker processing by execution ID.

See [execution behavior and tests](executions.md).

## Original baseline (before this implementation)

The repository contains a NestJS API, a separate NestJS/BullMQ worker, a React application, PostgreSQL/Prisma and Redis. The catalog persists provider/service definitions. Both seeded services are planned. The worker handles infrastructure probes only.

Authentication, product executions, Stellar analysis, wallet signing, payments and MCP are not implemented. Continue using the agreed stack and additive migrations.

## Implemented milestone

A user signs in, opens Account intelligence, submits a Stellar testnet account, watches a durable execution progress, and receives a source-backed report that remains available after refresh or worker restart.

Initially this is an explicitly authorized internal preview without a charge. The same execution pipeline will later require a paid entitlement. Never expose a separate unprotected route that bypasses the payment/access policy.

## 1. Identity and workspace ownership

- Add `User`, `Workspace`, `WorkspaceMember` and `Session` models.
- Implement email/password sign-in, sign-out, current session and initial workspace creation. Use an established Argon2id implementation; do not implement password cryptography.
- Persist hashed opaque session tokens, expiration and revocation. Send the browser token only through HttpOnly cookies, with Secure cookies under HTTPS and a documented localhost development exception.
- Enforce CSRF protection for mutations, login throttling, input validation and generic authentication errors.
- Derive resource access from the authenticated membership, not a workspace ID trusted from the request.
- UI: login, protected application shell, current workspace and logout.
- Registration remains a local/private-preview capability. Email verification, recovery and a mail delivery provider are required before public registration; do not create an unverified reset mechanism.

Acceptance: two users from different workspaces cannot list or retrieve each other's private resources; expired/revoked sessions cannot authorize requests; logout revokes the stored session.

## 2. Durable execution pipeline

- Add immutable `ServiceVersion` definitions with input/output schema and implementation version.
- Add `Execution`, `ExecutionAttempt`, `ExecutionEvent` and `OutboxMessage` models, with appropriate ownership and lookup indexes.
- Snapshot the service version, validated input and input fingerprint when accepting a request.
- Require an idempotency key scoped to the workspace. Repeating the same request returns its execution; reusing the key with a different input returns a conflict.
- Store an execution and its outbox message in one PostgreSQL transaction. Dispatch to BullMQ with a deterministic job ID, then acknowledge the outbox record.
- Treat queue delivery as at-least-once. Use durable attempt ownership/leases and guarded state transitions so a late/stalled worker cannot overwrite a newer result.
- Bound execution duration, concurrency and retry count. Retry only transient failures, with backoff.
- Persist progress events and results. Expose workspace-scoped execution creation, detail, cursor-paginated history and SSE events with reconnect support.
- UI: Activity list, execution detail, meaningful loading/error states and a live timeline restored after refresh.

Acceptance: duplicate delivery does not create duplicate logical executions; an API failure between database commit and dispatch is recovered by the outbox; a killed worker can resume work; SSE reconnects without losing stored events.

## 3. First real service: account intelligence

- Add a Stellar data adapter behind an explicit application interface, using the official TypeScript SDK.
- Start on testnet. Use RPC where it supplies the required state; isolate Horizon access for account balances/trustlines and bounded recent history where needed.
- Validate account encoding/checksum and distinguish an invalid address, an unfunded/missing account and an upstream failure.
- Return balances, asset identifiers, trustlines, account metadata and a bounded sample of recent transactions. Store source, retrieval timestamp and coverage limits with the report.
- Avoid mixing XLM/asset quantities with fiat valuations. Do not produce undocumented risk scores.
- UI: account input, run action, summary, asset table, recent activity, evidence links and JSON view.
- Mark the service active only after the end-to-end implementation and its access policy are enabled.

Acceptance: an authenticated user receives real testnet data; invalid/missing accounts are explained accurately; provider timeouts leave a recoverable execution state; the saved result remains available without querying Stellar again.

This completes the next milestone. It does not depend on an LLM or a funded payment wallet.

## 4. Second service: transaction explanation

- Reuse the execution pipeline for `explain_transaction`.
- Validate the transaction hash and return decoded operations, transfers, fees, execution outcome and ledger metadata.
- Preserve unsupported operations as explicitly undecoded data. Report unavailable/pruned records honestly.
- Produce a deterministic explanation from the decoded data first. A later LLM may summarize these facts without replacing them.
- UI: transaction input and a readable operations timeline with raw evidence.

Acceptance: account and transaction services share ownership, idempotency, history and progress behavior; fixtures cover successful, failed, missing and unsupported cases.

## 5. Wallet-owned signing and x402 payments

Resolve the signing/facilitator integration against pinned SDK versions before finalizing billing migrations. Keep the first integration experiment in the eventual payment adapter.

- Connect the Freighter browser extension and verify the selected network. Prove wallet ownership with a fresh, expiring challenge before recording a verified user-wallet association; a supplied address alone is insufficient.
- Use x402 v2 on Stellar testnet, with USDC and OpenZeppelin's documented facilitator integration. Configure secrets server-side only.
- Add immutable pricing versions/quotes, payment attempts, settlement records and an entitlement bound to the execution. Store amounts as integer base units and explicit network/asset identifiers.
- Keep payment status separate from execution status. Reserve/validate the intended price, asset, recipient, payer and resource association before settlement.
- Grant execution access only after the application verifies the settlement result. Retrying or retrieving an already-paid result must not request another payment.
- Reconcile uncertain settlement outcomes; a timeout is not proof of non-payment. Block automatic resubmission while the prior attempt is unresolved.
- Validate input and service availability before requesting payment. Make failures after payment visible and support controlled recovery; refunds require a separately designed operation.
- UI: wallet/network state, exact payment preview, explicit signature request, cancellation/expiry handling and a receipt linked to the execution.

Acceptance: genuine testnet settlement can be verified independently; rejected signatures do not run a paid service; a request retry or browser refresh does not charge again; uncertain settlement and paid-but-failed execution remain distinguishable.

External prerequisites: a testnet wallet with the correct asset trustline/balance and facilitator credentials. These are setup dependencies, not reasons to simulate a successful payment.

## 6. MCP and the agent playground

- Expose catalog discovery and the two analysis tools through the official MCP SDK and Streamable HTTP.
- REST and MCP use the same application services and access/payment policies. Validate the authentication requirements of the target MCP client; do not assume arbitrary clients implement x402.
- Add a bounded agent runner with a provider adapter, persisted tool calls, maximum steps and execution timeouts. Treat tool output as data, not authority to change spending policy.
- Snapshot per-run spending limits and reserve/release budget atomically in PostgreSQL. Separate external LLM cost from service payment totals.
- UI: prompt, selected tool, requested approval, result, cost and evidence timeline.
- The first browser-wallet flow pauses for each signature. Autonomous delegated signing is a separate extension and is not implied by connecting a wallet.

Acceptance: a real prompt can discover a service, request approval, obtain data and answer with evidence. Cancellation, insufficient budget and exhausted step limits stop further actions. No server-held user secret is introduced to bypass approvals.

## Quality gates

- Build, type checking and formatting in Docker.
- Unit tests for validation, state transitions and budget arithmetic.
- PostgreSQL/Redis integration tests for isolation, idempotency, outbox recovery and worker interruption.
- Browser verification for login, execution, history, reconnection and wallet rejection.
- Correlated structured logs across API, outbox, worker and payment attempts; OpenTelemetry spans for cross-process execution.
- Separate stable fixture-based tests from explicitly invoked live testnet checks.
- Keep all amounts, request IDs, failures and implementation versions inspectable. Never log credentials or signing material.

## Deferred until these flows are reliable

Public provider onboarding, fee splitting, subscriptions, mainnet launch, autonomous smart-wallet delegation, contract security analysis and additional infrastructure.

## References verified during planning

- [NestJS authentication](https://docs.nestjs.com/security/authentication)
- [Stellar x402 and compatible wallets](https://developers.stellar.org/docs/build/agentic-payments/x402)
- [Existing architecture decisions](architecture.md)
