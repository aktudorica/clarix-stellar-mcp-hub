# Identity and execution behavior

## Access

The server derives workspace and user identifiers from the authenticated session and membership. Clients cannot select a workspace in the request body. Better Auth manages new sessions with signed HttpOnly cookies and its Prisma session representation. Legacy 256-bit opaque cookies still resolve through SHA-256 digests in the old Session table until expiry. Sessions expire after eight hours and logout revokes them. See [authentication migration](integrations.md#authentication). Argon2id uses 19 MiB, two iterations and one lane. Login applies Redis-backed limits by email and IP. Mutations require an allowed Origin, JSON content type and the session's CSRF token, except login/registration which establish the session and still require Origin validation.

No user password, cookie, signing key or authorization header belongs in logs. The localhost preview uses SameSite=Lax, HttpOnly cookies; Secure is required for HTTPS deployment. There is no public recovery flow yet. The proxy does not trust arbitrary forwarded IP headers; rate limits behind this local proxy can share its IP bucket. Configure a known proxy trust boundary before public deployment.

## API

| Method | Path                          | Behavior                                                             |
| ------ | ----------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/auth/configuration`     | Whether private-preview registration is enabled                      |
| POST   | `/api/auth/register`          | Create user, workspace and membership, then issue session            |
| POST   | `/api/auth/login`             | Authenticate and issue session                                       |
| GET    | `/api/auth/session`           | Current user, workspace and CSRF token                               |
| POST   | `/api/auth/logout`            | Revoke current session                                               |
| POST   | `/api/executions`             | Validate service/input, enforce access, accept idempotently          |
| GET    | `/api/executions?cursor=<id>` | Workspace history, 20 rows per page                                  |
| GET    | `/api/executions/:id`         | Saved result, implementation version, attempts and latest 100 events |
| POST   | `/api/executions/:id/cancel`  | Cancel an active execution; late results cannot commit               |
| GET    | `/api/executions/:id/events`  | SSE; resumes after `Last-Event-ID` or `after`                        |
| GET    | `/api/stellar/examples`       | Current public Testnet account and transaction example               |

Create body: `{"service":"analyze_account","input":{"address":"<G-address>"}}` or `{"service":"explain_transaction","input":{"hash":"<transaction-hash>"}}`. The required `Idempotency-Key` is 16–100 URL-safe characters, normally a UUID. Keys are scoped to the workspace. Identical normalized input returns the existing execution; a different request with the same key returns 409. Each workspace can have ten active executions; acceptance is serialized through a short workspace row lock.

## Durable processing

An execution pins a service version, validated input, input fingerprint and access mode. Execution, initial event and outbox record commit together. The dispatcher claims outbox records with `FOR UPDATE SKIP LOCKED`, publishes using the outbox UUID as BullMQ job ID, then acknowledges delivery. A new service implementation must publish a new version; a PostgreSQL trigger rejects updates to existing version definitions.

A worker atomically claims a queued/retrying execution with a unique lease token, increments the attempt number and persists the attempt/event. Leases last 60 seconds and are renewed every ten seconds. A result or failure commits only if the attempt still owns a non-expired lease and the execution is running. Cancellation removes ownership, so a late result is discarded. Expired leases generate a recovery event and a new outbox record. A queued execution with no pending/recent delivery is redelivered after 60 seconds; this also covers delivery failures before the worker can claim a job.

There are at most three analysis attempts. Only transient upstream failures retry, with two/four-second backoff. Each worker consumes two product jobs concurrently. Queue delivery is at-least-once; execution claims and terminal state checks prevent duplicate logical completion. PostgreSQL is authoritative; queue data alone is insufficient to prove success. Queue recovery may perform duplicate public reads, which have no chain side effects.

SSE events are persisted, ordered by database ID and scoped to the workspace. The API revalidates session membership while streaming. The UI invalidates the saved report on events, reconnects automatically and uses five-second polling as a fallback. Refresh restores the report from PostgreSQL without requerying Stellar.

## Validation

`./scripts/test.sh` builds the application and runs a disposable Compose project, separate from local product volumes. It applies both migrations, checks readiness contracts and executes fixture-backed flows for auth/CSRF/tenant isolation, concurrent idempotency, immutable versions, successful/failed/unsupported/missing Stellar records, oversized/invalid responses, wrong-network rejection, outbox recovery after API restart, duplicate delivery, SSE replay, cancellation, killed-worker recovery, retry limits, lost delivery and pagination with identical timestamps.

`docker compose exec -e LIVE_TESTNET=1 api node scripts/live-testnet.mjs` is the separate optional chain-read test. Browser verification covers sign-in, example selection, execution, saved report after refresh, history, transaction analysis and sign-out. No Testnet funds or wallet signatures are needed for these reads.

Before paid/public access: finish payment entitlements, wallet ownership verification, reconciliation, tenant-wide operational quotas and storage retention; add distributed tracing, mail/recovery, deployment-specific proxy/cookie settings and database backups. Wallets, MCP and agents must call the same application access policy.
