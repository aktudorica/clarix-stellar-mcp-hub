# Clarix Stellar Agent Hub

An evolving product built on NestJS, React, PostgreSQL and BullMQ. All application processes, package installation, builds and migrations run inside Docker. No Node.js, pnpm, PostgreSQL or Redis installation is required on the host.

## Start locally

Prerequisite: Docker Desktop or another running Docker Engine with Compose v2+.

```sh
./scripts/start.sh
```

The first start creates a private `.env` with a random local database password, builds the application, starts PostgreSQL and Redis, applies versioned migrations, seeds the catalog without replacing existing entries, and waits for readiness.

- Application: http://localhost:4311
- API readiness: http://localhost:4310/health/ready
- API liveness: http://localhost:4310/health/live
- Catalog: http://localhost:4310/api/services

Only the web and API ports bind to the host, on `127.0.0.1`. PostgreSQL and Redis have no published ports. This configuration is for local development, not public deployment.

## Development with hot reload

```sh
./scripts/start.sh --dev
```

React HMR and the NestJS API/worker source watchers run in their containers. Source directories are mounted read-only; dependencies stay in the image. Both modes use the same database and Redis volumes. For changes to shared packages, dependency manifests, Prisma schema or Docker configuration, rebuild with the same start command. To return to the built application, run `./scripts/start.sh`.

## Verify

```sh
docker compose ps
docker compose exec api pnpm typecheck
docker compose exec api pnpm test
docker compose exec api pnpm smoke
./scripts/test.sh
```

The isolated integration suite starts a separate PostgreSQL/Redis Compose project with temporary data, applies migrations from scratch, and runs the API and worker against deterministic Stellar fixtures. It checks authentication, CSRF, tenancy, concurrent idempotency, immutable versions, SSE replay, cancellation, retries, pagination, API restart, worker interruption and lost queue delivery. It never modifies the application database.

To explicitly verify both services against real public Testnet data:

```sh
docker compose exec -e LIVE_TESTNET=1 api node scripts/live-testnet.mjs
```

This creates and removes only its own disposable local workspace. It reads the chain without signing or submitting transactions. A provider outage can fail this optional check independently of the stable fixture suite.

The smoke check validates HTTP readiness and catalog storage, then sends a real BullMQ job through the worker into PostgreSQL. It repeats the delivery to verify idempotency, and cleans only its own diagnostic records. Unit/API tests verify degraded readiness and the implemented-feature contract.

## Services

| Service    | Responsibility                                                         |
| ---------- | ---------------------------------------------------------------------- |
| `web`      | Built React app served by unprivileged Nginx; Vite in development mode |
| `api`      | NestJS/Express, sessions, catalog, execution API and SSE               |
| `worker`   | Durable outbox, leased executions, Stellar analysis and heartbeat      |
| `postgres` | PostgreSQL 17, persistent application data                             |
| `redis`    | Redis 8.2, persistent queue transport with `noeviction`                |
| `migrate`  | One-shot Prisma migration and non-destructive catalog initialization   |

The application processes run as non-root. API, worker and migration root filesystems are read-only, with writable temporary filesystems. PostgreSQL and Redis use named volumes scoped to the Compose project `clarix-stellar-hub`.

```sh
docker compose logs --tail=100 api worker
docker compose stop
docker compose start
```

`stop` preserves containers and volumes. Do not remove the named volumes unless intentionally deleting local data. Back up PostgreSQL before changing a database image major version. Keep `.env` with the same credentials when restarting an existing database volume.

## Structure

```text
apps/api             NestJS HTTP application
apps/worker          NestJS background processor
apps/web             React UI with shared shadcn-style components
packages/contracts   Public TypeScript API response contracts
packages/database    Prisma schema, migrations and database client
packages/platform    Shared runtime infrastructure and structured logging
packages/application Shared execution policy and application services
packages/stellar     Validated, bounded Stellar data adapter
docker               Images and reverse-proxy configuration
scripts              Container bootstrap, health and smoke checks
```

Prisma 7.10 is pinned; Prisma 8 is still a release candidate at bootstrap time. The pnpm lockfile pins resolved dependencies. Node 24 LTS is the runtime. Base images track their supported major/minor branches so they can receive security patches; release images should additionally be pinned to reviewed digests.

## Current scope

Implemented: private-preview registration and sign-in, Better Auth with Prisma, Argon2id passwords, signed session cookies (legacy hashed sessions accepted until expiry), CSRF checks, workspace ownership, immutable service versions, persistent executions, idempotency, transactional outbox, leased worker attempts, bounded retries, cancellation, SSE progress and cursor-paginated history. Both seeded services are active: account intelligence and deterministic transaction explanation. Their UI presents saved results, raw JSON and source evidence.

Open http://localhost:4311, choose **Create a workspace**, then select a service. **Use a recent Testnet example** fills an existing public address or transaction hash; **Generate report** runs the service. History is available under **Activity**.

The local Compose configuration explicitly enables `EXECUTION_ACCESS=internal_preview`: authenticated users can run analyses without a charge. It is not a payment entitlement. `ALLOW_REGISTRATION=true` and `SESSION_COOKIE_SECURE=false` are localhost-only defaults. For a private HTTPS deployment, set explicit `APP_ORIGINS`, enable Secure cookies, and disable registration until an onboarding policy is ready. Public registration also requires email verification, account recovery and mail delivery.

Account queries include balances/trustlines and up to 20 recent transactions. Transaction queries decode the XDR using Stellar SDK 17, verify its hash, preserve raw operations and explain payment/create-account/change-trust operations. Other operation types are clearly marked unsupported for human explanation. Provider reads have 10-second timeouts, a 2 MB response limit and an explicit Testnet network check. Reports are provider snapshots, not atomic ledger snapshots or financial/risk assessments.

Integrated: Freighter Testnet connection and payment authorization, MCP v2 with scoped revocable tokens, AI SDK with a configurable model and user-approved analysis proposals, shadcn/ui Card and Radix dialogs/tabs/selects/tooltips, and x402 Testnet quotes/settlement with persisted order state. See [integration setup and limits](docs/integrations.md).

Not implemented: verified wallet linking as an account identity, automatic reconciliation/refunds, production payment entitlements, autonomous spending budgets, public provider onboarding, and OpenTelemetry export. The paid path is an opt-in Testnet demonstration; ordinary preview executions remain free. AI and payments are disabled until configured. Tests use explicitly labeled local model/facilitator fixtures; the application never fabricates a successful model response or payment.

See [architecture decisions](docs/architecture.md) and [execution behavior](docs/executions.md).
