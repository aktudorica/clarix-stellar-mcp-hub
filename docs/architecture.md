# Architecture decisions

## Product lifecycle

This repository is the product foundation, not a disposable demo. The MVP narrows the feature set; subsequent work extends the same applications and database through additive migrations.

## Fixed technology choices

- Node.js 24 LTS and TypeScript; pnpm workspace monorepo.
- NestJS with Express for the API; NestJS application context for the worker.
- React, Vite, React Router, TanStack Query, Tailwind CSS, shadcn/ui source components and Radix primitives.
- PostgreSQL and Prisma for persistence and versioned migrations.
- BullMQ and Redis for asynchronous delivery; PostgreSQL remains the source of truth.
- Official Stellar TypeScript SDK, Freighter, x402 v2 Stellar integration, and official TypeScript MCP SDK v2.
- Better Auth with Prisma/Argon2 and the AI SDK with a configurable provider adapter.
- Server-Sent Events for execution progress; persistent events allow recovery after refresh.
- Pino logs; OpenTelemetry instrumentation when executing cross-process product requests.
- Jest/Supertest and Playwright browser verification.
- Docker Compose for the local stack, no dependencies installed on the host.

## Boundaries

Keep the application a modular monolith. HTTP and MCP are adapters over the same application services. API and worker share domain behavior but run independently. Do not add microservices, a generic agent framework, a second backend language or an extra database without a demonstrated requirement.

Initial packages cover actual shared functionality. Add domain, Stellar, payment and MCP packages when the corresponding feature is implemented, not as empty scaffolds. Shared UI currently belongs to the sole web application; extract a workspace UI package if another application consumes it.

## Delivery status

1. Implemented: user/workspace ownership, sessions and API access control.
2. Implemented: account and transaction intelligence using bounded, source-backed Stellar queries.
3. Implemented: persistent executions, state transitions, transactional outbox and SSE.
4. Implemented for the opt-in demo: Freighter authorization and x402 Testnet orders, settlement persistence and retry protection. Live wallet/facilitator validation and automated reconciliation remain pending.
5. Implemented: scoped MCP adapter and bounded AI SDK agent with user-approved analysis proposals. NVIDIA Nemotron 3 Ultra is configured and live streaming/tool calling is validated. Monetary budget reservations remain pending.

See [integration setup and limitations](integrations.md).

Browser wallet signing and future delegated signing must implement a distinct signing boundary. Do not make server-held user secrets the foundation of the product. A facilitator timeout produces an unresolved payment, not an automatic second charge. Pricing and asset amounts use integer base units; no floating point in financial calculations.

The initial provider is Clarix/StellarChain. Provider onboarding and fee distribution are extensions to this architecture, not simulated MVP revenue.
