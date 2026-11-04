# Local attack lab

The Next.js UI uses the Express API, PostgreSQL and the separate ShoppingBot worker. It includes seven scenario fixtures, execution traces, saved reports, JSON export and replay. All counts come from stored backend results. Agent/vault settings describe the demo policy, not a live wallet balance.

## Start

Complete the NEAR/OpenAI setup in [ShoppingBot](shoppingbot.md), then run:

```sh
npm ci
npm run setup:db
npm run db:migrate
npm run setup:web
```

Start each service in its own terminal:

```sh
npm run dev:api
npm run dev:worker
npm run dev:web
```

Open http://127.0.0.1:3000 and enter `WEB_ACCESS_CODE` from your local `.env`. Keep that code private. `setup:web` generates it and `WEB_SESSION_SECRET` without printing either. Existing configured values are preserved. To use a production build locally, run `npm run build:web`, then `npm run start:web` instead of `dev:web`.

The frontend uses `EXPRESS_API_ORIGIN` (default http://127.0.0.1:3001); the API uses `PORT` (default 3001). `WEB_ORIGIN` must exactly match the browser origin. Browser requests use an eight-hour HttpOnly, SameSite=Strict signed cookie. Mutations require the configured origin. API credentials are attached only by the server-side proxy. This is shared demo-workspace access, not multi-user authentication.

## Use

Select an attack or the legitimate-payment control, then **Run scenario**. A fresh vault is funded on NEAR testnet and the real model runs through the worker. Live-agent launches and replays use model credits and testnet funds; deterministic probes use testnet funds without model calls. The timeline polls persisted events, and the final report separates agent behavior, contract enforcement and actual settlement. Expand trace rows for raw evidence, or export the report as JSON. Replay creates a new run from saved inputs; model behavior can vary.

## Verify

With the API and frontend running:

```sh
npm run typecheck
npm run typecheck:web
npm run test:agent
npm run test:api
npm run test:web
# Optional additional real model/chain execution:
npm run test:web:live
```

Browser tests use installed Google Chrome. The normal suite verifies authentication, data loading, desktop/mobile layout, saved reports, export and cross-origin protection. The opt-in live test launches an actual malicious-invoice run. Local screenshots are saved under `artifacts/ui/`.

The app is currently local; no public URL or production hosting is configured. The worker requires persistent storage for its local journals as well as PostgreSQL. See [backend limitations](backend.md) before deployment.

The attack lab now offers registered agent and payment-system selectors, plus explicitly labeled live-agent and deterministic probe modes. Run reports show their actual selected target; probe reports mark agent behavior as not exercised. Configure targets with [the integration guide](external-integrations.md).

## Final local demo

`npm run setup:local`, `npm run demo:load`, and `npm run dev:local` prepare archived evidence inspection without model/signing credentials. The `/compare` view checks whether saved runs have matching payment requests and authorized tasks before describing a controlled comparison. Reports show observed policies, findings, remediation, and archived-origin labels. Split-budget selection uses the funded `near-budget` target. See [the demo script](demo.md).
