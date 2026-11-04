# Express API and persistent runner

The backend uses Express 5, PostgreSQL and the existing ShoppingBot runner. The API only queues jobs; a separate worker owns signing and executes one run at a time. There is one demo workspace, with registered ShoppingBot/HTTP agent adapters and configured reference-vault/HTTP payment targets. This is not multi-tenant authentication or arbitrary unapproved endpoint registration.

## Local startup

Requires the existing Node dependencies and PostgreSQL binaries (`pg_config`, `initdb`, `pg_ctl`). On this workspace, PostgreSQL 14 is available. Alternatively supply a PostgreSQL `DATABASE_URL` and your own random `API_TOKEN` of at least 32 characters.

```sh
npm ci
npm run setup:db
npm run db:migrate
# Terminal 1
npm run dev:api
# Terminal 2
npm run dev:worker
# Terminal 3 — real OpenAI/testnet execution
npm run api:run -- malicious-invoice
```

`setup:db` creates a private local cluster under `.local/postgres`, listening only on `127.0.0.1:55432`, and appends credentials plus a random API token to the ignored `.env`. It does not alter another database cluster. Re-running it restarts this local instance if stopped. To stop it:

```sh
pg_ctl -D .local/postgres stop
```

The API binds to `127.0.0.1:3001` by default; set `PORT` to change the port. The worker needs the configured OpenAI and NEAR keys from the earlier setup. The Next.js frontend proxies authenticated requests server-side; the admin API token is never bundled into browser code. See [frontend setup](frontend.md).

## API

All `/api` routes require `Authorization: Bearer <API_TOKEN>`. `/health` checks database availability without authentication. Run-start and replay requests require an `Idempotency-Key` header: 8–128 letters, digits, underscores or hyphens. Reusing a key for the same request returns the existing run; reusing it for different inputs returns 409. The queue allows at most ten unfinished runs.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/stats` | Stored run/outcome/payment counts and demo policy |
| GET | `/api/agents` | Registered agents |
| GET | `/api/targets` | Authorized agent and payment configurations |
| GET | `/api/scenarios` | Versioned malicious and legitimate invoice fixtures |
| POST | `/api/test-runs` | Queue `{ "scenarioId": "malicious-invoice" }` or `legitimate-payment` |
| GET | `/api/test-runs` | Most recent 100 runs |
| GET | `/api/test-runs/:id` | Persistent status and scenario/model snapshot |
| GET | `/api/test-runs/:id/events?after=0` | Ordered event page, at most 200 entries |
| GET | `/api/test-runs/:id/events` | SSE when `Accept: text/event-stream`; resume using `Last-Event-ID` |
| GET | `/api/test-runs/:id/report` | Persisted report; 409 until available |
| POST | `/api/test-runs/:id/replay` | Queue a fresh isolated run with the saved scenario and model |

```sh
npm run api:run -- --replay <run-uuid>
# Reconnect after an API restart without starting another run:
npm run api:run -- --watch <run-uuid>
```

The caller selects registered `agentId`, `paymentSystemId`, and `mode` (`agent` or `probe`); defaults preserve the original behavior. The caller cannot supply signing keys, endpoints, target contracts, amounts, prompts, model names, or recipients to these endpoints. The worker runs only the predefined adapter with server-controlled snapshots. Policies remain enforced onchain.

## Persistence and crash behavior

Versioned SQL migrations create workspaces, agents, test runs, events, vault references, transaction evidence, and reports. PostgreSQL is authoritative for job status; NEAR remains authoritative for balances and settlement. Event payloads include model requests, observed tool calls, policy snapshots and final RPC evidence. The local journal under `artifacts/runs/<id>` is imported incrementally into PostgreSQL, with `(run_id, seq)` uniqueness.

A PostgreSQL advisory lock permits one worker per database and serializes use of the demo signing accounts. A child process isolates the CLI's HTTP transport and key lifecycle. Loss of the worker's IPC connection stops its child. Worker shutdown terminates the active child, then preserves its evidence. There is a ten-minute execution limit.

On startup, the worker restores any complete local report for an interrupted run. If there is no complete report, it marks the run FAILED/INCONCLUSIVE and retains partial events for reconciliation. It never automatically repeats financial operations. A transfer already submitted can still settle after a crash: inspect payment IDs, transaction hashes and onchain state before choosing to replay. Keep `artifacts/` on the same persistent volume as the worker; events in the brief interval before database import may otherwise be lost on host loss. This is a single-host worker, not a distributed exactly-once payment system.

Queued jobs and already-persisted reports survive API and worker restarts. API restart does not stop the separately running worker. Model behavior remains nondeterministic on replay.

## Tests

```sh
npm run typecheck
npm run test:agent
npm run test:api
```

API tests use a temporary schema in the configured real PostgreSQL database, then drop only that schema. Fixtures in those tests are explicitly unit-test data and are never represented as actual AI or chain results. They cover authentication, request validation, concurrent idempotency, conflicting idempotency keys, replay lineage, persistence across new connections, event resume, recovery and safe HTTP error responses.

Implementation references: [Express error handling](https://expressjs.com/en/guide/error-handling.html) and [node-postgres transactions](https://node-postgres.com/features/transactions).

Migration 002 adds immutable target snapshots and target-aware idempotency. Replay retains the original configuration and requires that configuration to remain authorized. See [external integrations](external-integrations.md).
