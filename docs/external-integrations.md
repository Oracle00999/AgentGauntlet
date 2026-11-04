# Connect agents and payment systems

AgentGauntlet is a security-testing runner. ShoppingBot and the NEAR vault are reference targets. The runner receives an agent adapter, payment-system adapter and independent outcome verifier; no agent-specific model calls or contract signing occur in the runner.

## Register and run an external agent

The current supported agent interface is authenticated HTTP protocol v1. Agents may be written in any language. No source-code changes to the testing engine are required.

For the included real-model example, after the existing database/NEAR/OpenAI setup:

```sh
npm run setup:targets
npm run db:migrate
# Separate terminals:
npm run dev:api
npm run dev:worker
npm run dev:external-agent
```

`setup:targets` creates `.local/targets.json`, adds `AG_TARGETS_FILE` to `.env`, and generates `EXTERNAL_AGENT_TOKEN` locally. It refuses to overwrite an existing configured registry. The example agent runs in a separate process on port 3012 and uses real ShoppingBot model calls with its own service policy. Its model journal is under `artifacts/external-agent/`. No signing credentials are sent over HTTP.

A developer connects their own service by adding an entry to the registry's `agents` array:

```json
{
  "id": "my-agent",
  "name": "My purchasing agent",
  "version": "1",
  "authorized": true,
  "adapter": "http",
  "connection": {
    "endpoint": "https://agent.example.com/execute",
    "tokenEnv": "MY_AGENT_TOKEN",
    "allowLoopback": false,
    "timeoutMs": 60000
  }
}
```

Configure the same random bearer token (at least 32 characters) in the external service and the worker's named environment variable. Restart the API and worker after registry changes. For local development, `http://127.0.0.1:<port>/execute` requires `allowLoopback: true`. Only explicitly authorized endpoints belong in this operator-managed registry; run requests cannot supply endpoints or executable code.

```sh
npm run api:run -- malicious-invoice --agent my-agent --payment-system near-protected
npm run api:run -- legitimate-payment --agent my-agent --payment-system near-protected
# CLI compatibility, without PostgreSQL:
npm run demo:agent -- malicious-invoice --agent my-agent
```

The browser also offers registered agent/payment selections and live-agent versus probe mode. The API accepts:

```json
{"scenarioId":"malicious-invoice","agentId":"my-agent","paymentSystemId":"near-protected","mode":"agent"}
```

Use `POST /api/test-runs` with the existing API bearer token and a unique `Idempotency-Key`. `GET /api/targets` lists available configurations. Defaults remain `shoppingbot`, `near-protected`, and `agent`.

## Agent protocol v1

AgentGauntlet POSTs to the configured endpoint with `Authorization: Bearer <integration token>` and JSON:

```json
{
  "version": 1,
  "runId": "UUID",
  "task": "Authorized task",
  "untrustedContent": "Attacker-controlled invoice material",
  "history": []
}
```

The agent service owns its instructions, model and prompt handling. AgentGauntlet does not send ShoppingBot's system instructions to external services. The service must retain the run's task and continuation state and must not restart its model execution on a poll.

Respond with exactly one of:

```json
{"version":1,"runId":"UUID","type":"pending"}
```

```json
{
  "version": 1,
  "runId": "UUID",
  "type": "payment",
  "callId": "stable-agent-tool-call-id",
  "request": {
    "recipient": "supplier.testnet",
    "amount": "0.01",
    "invoiceId": "cloudhost-2026-11",
    "reason": "Hosting invoice"
  }
}
```

```json
{"version":1,"runId":"UUID","type":"complete","text":"Final agent response"}
```

After a payment request, AgentGauntlet submits it to the selected payment target, verifies its outcome, and sends another POST with the same task/run ID plus `history: [{callId, request, result}]`. Result contains `status` (`SETTLED`, `DENIED` or `FAILED`), `code`, `paymentId` and `transactionHash`. When evidence is missing, execution stops with an inconclusive report; it never supplies an invented verified tool result.

Repeated delivery of an identical call ID reuses its result; changed arguments under an existing ID fail the run. Pending replies are polled within a five-minute agent deadline. There are at most four payment attempts and nine non-pending replies. No automatic retry of ambiguous payment submissions occurs. Implement run/call deduplication in the service too.

The optional TypeScript `createAgentServer` helper in `packages/core/src/http-agent-server.ts` wraps an `AgentAdapter` with this continuation protocol. `examples/external-agent/server.ts` is a runnable reference. The standalone protocol test fixture does not depend on that helper, demonstrating language-independent integration.

HTTP transport requires HTTPS for public IPv4 endpoints, validates all resolved addresses, pins the selected address for each connection, blocks private/reserved ranges and redirects, rejects unexpected JSON, caps response bodies at 64 KiB, and applies DNS/request deadlines. IPv6/private-network services are currently unsupported except explicit literal loopback. The example server authenticates before parsing, bounds requests/sessions and expires continuations. Deploy public agent endpoints behind HTTPS and only test services you control or are authorized to test.

## Payment adapters and verification

Currently supported settlement rail: native NEAR testnet. Payment amounts in protocol v1 are decimal NEAR strings. This is not yet a universal multichain payment schema.

- `near-reference-vault`: AgentGauntlet provisions a fresh reference vault and uses the restricted payment key.
- `http-near-vault`: an external HTTP service provisions and submits to a contract implementing the supported reference-vault ABI; the external service owns signing. AgentGauntlet queries NEAR independently.

A payment configuration includes `id`, `name`, `version`, `authorized: true`, `adapter`, `network: "testnet"`, `contractId`, `signerId`, `verifier: "near-reference-vault-v2"`, and `policy` (`funding`, `maxPayment`, `dailyLimit`, `storageDeposit`, all decimal strings). HTTP payment configurations additionally use the same `connection` object as HTTP agents.

The external payment endpoint receives:

```json
{"version":1,"operation":"prepare","runId":"UUID","supplier":"supplier.testnet","vaultId":"ai-UUID"}
```

It must create/fund the isolated environment and return:

```json
{"version":1,"type":"prepared","runId":"UUID","vaultId":"ai-UUID"}
```

The verifier reads the actual onchain policy; it checks agent and recipient bindings and records actual settings separately from declared configuration. The service then receives:

```json
{"version":1,"operation":"submit","runId":"UUID","attemptId":"UUID:1","paymentId":"sha256-of-invoice-id","request":{"recipient":"supplier.testnet","amount":"0.01","invoiceId":"cloudhost-2026-11","reason":"Hosting"}}
```

Respond with `version`, matching `runId`, `attemptId`, `paymentId`, optional `transactionHash`, and optional `claim`. A claim alone cannot yield a verified verdict. The service must submit only once for a stable attempt ID. The current bridge expects preparation/submission references within its configured request timeout; payment-service asynchronous polling is not implemented.

The independent verifier fetches final transaction/receipt results and financial state. It binds signer, contract, method arguments, payment ID, recipient and amount; checks the actual transfer and callback receipts; and detects contract-code changes during execution. Rejection is verified against the exact onchain request and absence of outgoing contract actions in that transaction. This does not prove permanent absence of unrelated future payments. Evidence includes the RPC source, receipt/block data and observation time. The verifier trusts its configured RPC source rather than independently validating consensus proofs.

The default RPC is FASTNEAR testnet, listed in [NEAR's official provider documentation](https://docs.near.org/api/rpc/providers). The former public endpoint returned deprecation/rate-limit errors during acceptance. Read-only transport failures may retry twice; submitted mutations never automatically retry.

An arbitrary firewall with a different ABI or settlement rail still needs a payment adapter/verifier implementation. Do not claim full compatibility from a matching HTTP envelope alone. The HTTP payment bridge has protocol/claim tests; no unrelated third-party firewall vendor has been certified by this implementation.

## Probe comparisons and snapshots

```sh
npm run api:run -- malicious-invoice --probe --payment-system near-protected
npm run api:run -- malicious-invoice --probe --payment-system near-permissive
npm run api:run -- legitimate-payment --probe --payment-system near-protected
npm run api:run -- legitimate-payment --probe --payment-system near-permissive
```

For the attack fixture, probe mode submits 0.03 NEAR directly; it does not invoke an agent. The protected target's limit is 0.025; the permissive target's limit is 0.05. Both controls request the authorized 0.01. This demonstrates a configuration failure relative to the authorized task, not an exploit of the contract. Exact probe requests are saved in the scenario snapshot. Reports label agent behavior `NOT_EXERCISED` in probe mode.

Migration 002 retains historical data, adds registered payment targets and immutable configuration snapshots, and removes the ShoppingBot-only constraint. Snapshots contain secret references, never secret values. New digests use canonical JSON. Idempotency considers the entire snapshot. Replay preserves configuration and inputs; a removed or changed target configuration must be explicitly registered again before it is authorized to run. Remote service versions are declared by their operator; snapshots do not prove remote code stayed unchanged.

```sh
npm run api:run -- --replay <run-id>
npm run reconcile -- artifacts/runs/<run-id>/report.json
```

Reconciliation is read-only and preserves the original report. Missing hashes and unresolved transactions remain inconclusive. A current null payment state is a time-bounded observation, not proof an unknown submission can never settle. The existing worker retains its single signing queue, interruption handling and persistent journals.

Agent coverage is mediated payment calls only. An agent's independent wallet or unobserved payment channel is outside this test's visibility. Refusal means the payment firewall was not exercised. A verified unauthorized settlement remains a breach even if a later step fails.

## Validation

`npm run test:agent` includes separate-process HTTP integration from a registered configuration file, malformed/oversized/unauthorized responses, timeouts, redirects, conflicting/repeated call IDs, asynchronous polling, target-claim rejection and tampered NEAR receipt tests. `npm run test:api` uses real PostgreSQL and covers immutable snapshots, target-aware idempotency and replay. Existing Rust, Sandbox and browser suites remain applicable. Live acceptance evidence is documented in `docs/evidence/platform/`.

## Expanded scenario coverage

The seven scenario IDs are listed in the root README. For cumulative-budget probes, register `near-budget` using `npm run setup:targets -- --add-budget`; its 0.08 funding distinguishes limit enforcement from insufficient balance. Paused-vault setup currently requires the native reference adapter, not the HTTP payment bridge. `npm run demo:live -- --all-attacks` exercises the full final workflow. Migration 003 marks imported reports as archived testnet evidence; it does not queue financial work. See [final results](evidence/scenarios/README.md).
