# Framework and package integrations

NestJS remains the API/worker framework. React + Vite remains the UI. No second HTTP framework or authentication implementation is exposed alongside it.

## Authentication

Better Auth 1.7.5 owns new identities, credential verification and sessions through its Prisma adapter. The existing Nest endpoints `/api/auth/register`, `/login`, `/session` and `/logout` retain their response contract and CSRF/origin protections. Registration writes the framework identity, session, workspace and membership in one Prisma transaction. The library's raw routes are not mounted; this prevents signup from bypassing workspace creation and application throttling.

The additive migration copies existing Argon2 hashes into `AuthAccount`, preserving user IDs, memberships and passwords. Old `clarix_session` records remain accepted until their original expiry. New cookies are signed by Better Auth, HttpOnly and SameSite=Lax. Framework session tokens are stored in `AuthSession` using the adapter's default representation; legacy `Session` continues to hold hashes. Database access and backups must be protected accordingly. No new passwords are copied into the legacy column.

`./scripts/start.sh --dev` adds a random `BETTER_AUTH_SECRET` to an existing `.env` without replacing database credentials. Keep this secret stable. Local Secure-cookie=false settings must be changed for HTTPS deployments. Account recovery/email verification are not yet configured; registration is for private preview.

## Freighter and UI

Use **Integrations → Wallet** in a browser with the Freighter extension installed. Connection reads a public G-address and checks the Testnet passphrase. It is local to the tab and does not link/prove an identity on the server. There is no server-held wallet secret.

UI primitives use installed Radix packages and Sonner. `components/ui/card.tsx` is the MIT-licensed shadcn/ui Card from the official `new-york-v4` registry, with its local utility import adapted. Existing application styling is retained. Wallet, AI and payment modules are lazy-loaded.

## MCP

**Integrations → MCP access** issues a seven-day token for the current user/workspace. Choose read-only or read plus preview execution. One active token per user/workspace: rotation and revocation invalidate the old token atomically in Redis. Only a SHA-256 digest is stored. Redis data loss revokes tokens; it cannot grant access. Membership is checked on every request.

Endpoint: `http://localhost:4311/api/mcp`, Streamable HTTP. Supply `Authorization: Bearer <token>`. Do not put tokens in URLs or commit client configuration containing them. The endpoint accepts bearer credentials, not browser-session cookies, and validates Host and any supplied Origin. It uses the official MCP v2 server and Express host validation adapter.

Tools: `discover_services`, `list_executions`, `get_execution`, and (with permission) `run_analysis`. Analyses go through the shared `ExecutionService`, including workspace limits and idempotency. MCP cannot initiate payments. Internal-preview access is an explicit deployment setting, not a paid entitlement.

## AI assistant

Set in `.env` and restart with `./scripts/start.sh --dev`:

```dotenv
LLM_PROVIDER=nvidia
LLM_BASE_URL=https://integrate.api.nvidia.com/v1
LLM_MODEL=nvidia/nemotron-3-ultra-550b-a55b
LLM_API_KEY=
LLM_ENABLE_THINKING=true
LLM_MAX_OUTPUT_TOKENS=16384
LLM_TIMEOUT_MS=180000
```

Supply your NVIDIA key only in the ignored local `.env` (mode 600). Compose passes it only to the API container; it is never a Vite variable. The NVIDIA profile sends `temperature=1`, `top_p=0.95` and top-level `chat_template_kwargs.enable_thinking`, using the installed OpenAI-compatible adapter. See [NVIDIA reasoning controls](https://docs.nvidia.com/dynamo/dev/recipes/nemotron-3-ultra). For another provider, set `LLM_PROVIDER=openai-compatible`.

The endpoint must implement OpenAI-compatible chat completions with streaming and tool calling. The provider adapter is configurable; no vendor endpoint/model is selected automatically. HTTPS is required except localhost/127.0.0.1/host.docker.internal for a local model. In Docker, use `host.docker.internal` to reach a model on the Mac. An API key is optional for providers that do not require one.

**AI assistant** uses `@ai-sdk/react` and the AI SDK UI-message stream. Each submitted question starts a new context. Tools may read services/reports or prepare an analysis proposal. The user clicks **Approve and run preview analysis** to execute through the regular API. No signing/payment tools are available to the model. Four model steps, configurable output tokens per generation (16,384 in the NVIDIA example), a configurable overall deadline (180 seconds in the example, at most 300 seconds), one active request per workspace and five requests/minute bound usage; these are technical limits, not a monetary spending budget. Provider requests are not automatically retried. Report data may be sent to the configured provider when requested; provider choice determines its processing/storage policies.

The workspace lock outlives the configured deadline by 30 seconds. Raw reasoning is consumed by the SDK for tool continuations but omitted from the browser stream and persisted output; the UI shows a processing indicator. `AgentRun` stores prompt, visible output/tool results and status. A process crash can leave a RUNNING record; no automatic retry occurs. There is no conversation-memory feature or run-history UI yet.

## x402 Testnet paid demonstration

Ordinary **Generate report** stays free in internal preview. **Try paid Testnet flow** is enabled only when these values are configured:

```dotenv
X402_ENABLED=true
X402_PAY_TO=
X402_PRICE_USDC=0.01
OZ_API_KEY=
```

Use your intended recipient address and an OpenZeppelin Channels Testnet API key. The facilitator URL and network are fixed to Testnet. Prices are limited to 0.01–0.99 USDC for this demonstration. The wallet needs the Testnet USDC asset supported by the facilitator. Activation/account funding and trustline creation are not automated.

The server persists an immutable quote (10-minute expiry), its normalized request and service version. The UI displays amount, recipient and network before calling the payment-enabled fetch wrapper. The wrapper uses the official Stellar scheme and Freighter `signAuthEntry`; it only runs after explicit confirmation and its policy accepts the reviewed recipient/asset/amount on Testnet. Account/network are checked again at signing.

The x402 resource server builds requirements, verifies and settles through the facilitator. An Express adapter reads the protocol header inside the Nest route. A database claim precedes settlement. Payload hashes and transaction hashes are unique; successful settlement is persisted before the execution and outbox are created. Paid execution consumes its matching order in the same transaction as enqueueing. Repeating a paid request resumes the same execution without settling again. The `payment_` idempotency prefix is reserved for this flow.

`SETTLING` or `UNKNOWN` blocks another settlement or a new quote in that workspace. A timeout, malformed facilitator result or process crash must never be interpreted as a failed transfer. There is no automatic resettlement. **Integrations → Payments** shows the latest 20 orders, chain transaction hashes, report links, and **Resume paid analysis** if settlement succeeded but queueing did not. Failed/cancelled analyses do not automatically refund their test payment.

Reconciliation is an operator responsibility for now: inspect the persisted order and facilitator/chain evidence before changing its state. Do not mark an uncertain order PAID without verifying recipient, asset, exact amount and a transaction not consumed elsewhere. Do not delete or reset uncertain orders merely to unblock payment. No reconciliation write command is supplied because the evidence must be reviewed per order. This is not ready for real funds or Mainnet deployment.

## Validation

`./scripts/test.sh` runs an isolated, disposable database/Redis stack. Tests cover credential migration and legacy-session continuity; MCP using the official client, token scopes and cross-workspace access; AI streaming/tool proposals via a local HTTP model fixture; and actual x402 protocol handling against a mock facilitator, including replay and uncertain-settlement behavior. The mocks do not prove live wallet compatibility, payment settlement or the availability of an external LLM. Those require the user's configured provider and wallet approval.

Live provider check (2026-09-25): NVIDIA Nemotron 3 Ultra completed an authenticated application request, called `discover_services`, continued from its result, and produced Romanian text in about 10 seconds. The temporary test workspace was removed. Fixture tests also verify NVIDIA request fields and that reasoning is absent from UI/persisted output. This verifies chat/tool integration, not wallet settlement.
