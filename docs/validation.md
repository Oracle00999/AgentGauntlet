# Final validation record

Executed during final preparation on 2026-11-03. These are observed results, not guarantees about future network/model behavior.

| Check | Result |
| --- | --- |
| Root TypeScript and web TypeScript | Passed |
| Core/agent suite | 12 tests passed, including independent HTTP process, hostile responses, transport restrictions, verifier tampering, scenario ledger and probe expectations |
| PostgreSQL API integration | Passed; authentication, target snapshots, idempotency, replay, configuration compatibility and isolated test schema |
| Rust unit tests | 7 passed |
| Contract Wasm build | Passed |
| Actual NEAR Sandbox integration | 2 passed, including scenario library with exact denials, transfer receipts and financial balances |
| Browser suite | Passed; login/proxy protections, scenario/target selection, reports/export, comparison and mobile layout |
| Next.js production build | Passed |
| Live final testnet workflow | All 10 executions completed with verified outcomes; see linked evidence |
| Archived evidence import | 17 reports imported into a fresh isolated database; second import added zero; zero queued payments |
| Secret-value scan | No configured secret values found in 141 source/documentation files |
| Clean-source local setup | Fresh dependency installation from npm cache, setup, archived import, PostgreSQL tests and production build passed without OpenAI/signing credentials |

The clean-source check used installed Node/PostgreSQL and a local npm cache, with an isolated database. It did not test installing operating-system prerequisites or a fresh faucet request. Browser checks used installed Google Chrome. Screenshots of desktop/mobile comparisons and reports were inspected locally.

## Real financial outcomes

[Final evidence](evidence/scenarios/README.md) records permissive settlement, protected limit denial, split-budget cumulative denial after two settlements, duplicate-payment denial, unauthorized-recipient denial, paused-vault denial, legitimate external-agent settlement, malicious-invoice resistance, live split-budget resistance, and replay. Each has saved reports/events. Genuine agent decisions are preserved separately from deterministic probes.

Sandbox executes actual Wasm with locally created accounts and no testnet funds. Scenario checks verify the recipient balance and vault state as well as exact transaction evidence. API tests use an isolated schema; live runs use distinct vault IDs. A replay creates a new environment; idempotent resubmission does not create another queued test.

## Remaining boundaries

- Membership revocation is unsupported; paused-vault behavior is tested separately.
- External payment services must implement the supported NEAR reference-vault ABI. No unrelated third-party firewall certification is claimed.
- Duplicate identity protection does not detect semantically equivalent invoices with different IDs.
- Evidence covers mediated payment requests, with trust in the configured RPC. Out-of-band agent wallets are not observed.
- The reference vault has no withdrawal path and is not production custody software.
- Local workspace authentication is shared, not multi-tenant identity management.
- Model decisions, provider availability and faucet funding can vary. Inconclusive executions require investigation, not relabeling as protection.

No public deployment, repository publication, video recording, or hackathon submission was performed. See [demo instructions](demo.md) for the remaining owner actions.
