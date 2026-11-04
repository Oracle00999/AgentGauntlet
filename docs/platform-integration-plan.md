# AgentGauntlet: reusable testing platform

This document preserves the pre-implementation architecture review and proposed sequence. The integration milestones are now implemented; see [the developer integration guide](external-integrations.md) and [real acceptance evidence](evidence/platform/README.md) for current behavior and supported boundaries.

AgentGauntlet tests developer-owned AI agents and payment security systems. ShoppingBot and the NEAR vault are reference targets and regression fixtures. The product is the scenario runner, integration contract, attack corpus, independent verification and comparative report.

## Findings from the current implementation

| Boundary | Current state | Consequence |
| --- | --- | --- |
| Agent | `packages/core/src/agent.ts` defines `AgentAdapter.executeTask`, injecting payment and tracing callbacks. | A developer can implement another TypeScript adapter, but cannot select it through the existing runnable product without changing its wiring. |
| Runner | `scripts/shoppingbot.ts` instantiates ShoppingBot, requires OpenAI, creates/funds our vault, evaluates invoices, renders reports and closes transports. | The orchestration is reusable in concept, but inseparable from the reference targets today. |
| Payment | `near.ts` exposes an injected payment function but also owns signing, submission, RPC queries and interpretation of our contract. | Another payment function fits the callback shape; no supported payment-target lifecycle or independent verifier interface exists. |
| Data model | Recipient validation assumes NEAR accounts; amount conversion assumes 24 decimals; payment results require a transaction hash even for denial. | A remote firewall or another settlement rail cannot faithfully represent its outcomes through the current types. |
| Scenario | Two IDs, ShoppingBot instructions and fixed NEAR invoice fields are bundled together. The runner evaluates exact recipient, amount and invoice plus repeated IDs. | New attack objectives and different agent configurations require engine edits. Multi-payment budget tests need a stateful oracle. |
| API/storage | API restricts agent ID to ShoppingBot; SQL restricts adapter to ShoppingBot; enqueue hard-codes it. Replay preserves scenario/model only. | Agent and payment system are not independently selectable or versioned. |
| Worker | Runs the ShoppingBot CLI directly; event import assumes every run owns a NEAR vault and every transaction is testnet. | An external integration would break persistence assumptions even if its agent adapter worked. |
| UI | ShoppingBot, NEAR, vault policy and contract terminology are hard-coded. | Reporting currently presents the reference integration as the product. |

Keep Express, PostgreSQL, the queue, process isolation, journals, replay lineage, idempotency, browser session boundary, the working OpenAI adapter, and the existing Rust contract. No contract rewrite is required for platform extraction.

## Smallest useful architecture change

Extract a `runTest` function from the existing CLI and inject three independently replaceable components:

```text
Scenario + authorized policy + target configuration snapshots
                         |
                    Test runner
                   /           \
          Agent adapter     Direct probe driver
                   \           /
                 Observed payment request
                         |
                Payment-system adapter
                         |
               Independent outcome verifier
                         |
           Versioned evidence and security report
```

The runner owns attempt IDs, event order, policy evaluation and report generation. Its policy oracle observes violations; it must not reject them before the selected firewall sees them. Schema validation and an explicitly disclosed test-budget boundary are separate from the security control under test. If that boundary prevents execution, report the attempt as not exercised, never as a firewall defense.

### Integration contracts

1. **AgentAdapter:** retain the injected payment callback and trace mechanism. Add identity/version/capabilities and lifecycle cancellation. Agent configuration owns its system instructions and model settings. Scenario material describes the authorized task and the attacker-controlled input surface. Do not silently wrap an external agent in ShoppingBot's hardened prompt. Record how the adapter actually delivers those inputs.
2. **PaymentSystemAdapter:** `prepare`, `submit`, `reconcile`, `close`. Preparation returns the isolated environment, observed configuration and available capabilities. Submission returns a target claim and evidence references, not a trusted settlement verdict. Bind run, attempt and idempotency IDs to each operation; persist intent before submission. Reconcile ambiguous submissions without blindly resending them.
3. **OutcomeVerifier:** independently obtains evidence and returns verified outcome, provenance, observation time, finality and uncertainty. It uses read-only credentials/RPC where possible, separately from target responses. It must validate request binding, not just accept a supplied transaction hash. A firewall adapter cannot certify its own claim merely by returning `SETTLED`.

Use a versioned payment envelope with network/asset, recipient, exact integer base-unit amount, invoice identity and stable attempt/idempotency IDs. Asset metadata supplies decimals; recipient validation belongs to the rail adapter. Keep the current NEAR-facing decimal tool schema through a compatibility translator. Start with NEAR native assets; do not claim multichain support before a second verifier is implemented.

Initially register adapters through an explicit server-side registry/configuration file, with secret references rather than embedded secrets. Do not build dynamic code uploads, a marketplace, multi-tenancy or a new service architecture for this milestone.

### External connection path

Support a small authenticated HTTP bridge for developer-owned agents: start a run with task/input, return a correlated payment tool call, accept its tool result, then continue until completion. Preserve stable call IDs, bounded turn counts, cancellation and reconnection semantics; duplicate call delivery returns the existing result. Offer a TypeScript wrapper around the same protocol. Endpoints are operator-configured, not arbitrary URLs supplied in a run request.

A payment firewall HTTP adapter translates the standard envelope to the developer's API and obtains decision/submission references. Pair it with a registered verifier for its settlement rail. For a NEAR-settling external firewall, reuse the NEAR verifier; a different rail needs its own verifier before independently verified results are available.

Support mediated agents first: their payment calls pass through the supplied callback/bridge. An agent that signs outside this path needs separate wallet/ledger observation. Without that visibility, show partial coverage and do not call an absence of captured calls proof of resistance.

## Evidence and reporting

Separate four facts: agent intent, firewall decision claim, independently observed payment outcome, and test coverage/completion. Maintain old report fields and saved reports through a versioned compatibility layer; introduce `paymentSystemResult` instead of requiring every target to have a `contractResult`.

For NEAR, retain current final RPC receipt queries, then strengthen binding: match network, signer, target, method arguments, payment ID, recipient and amount; follow the actual transfer receipt to final execution. Our contract's settlement state and events are corroboration. For an arbitrary target, its own storage and logs cannot alone establish that funds moved. Record block/receipt references and verifier version; isolated-account balance changes can corroborate settlement but are not sufficient alone where fees or unrelated activity intervene.

A verified denial needs evidence of the enforced rejection for the exact attempt plus its execution boundary. For an offchain firewall, a signed denial remains a target claim unless independently supported. “No payment observed by deadline” is a bounded observation, not permanent proof that no payment can occur. Pending, missing, mismatched or contradictory evidence remains inconclusive; a verified unauthorized settlement remains a breach even if a later agent step fails.

Reports should include:

- Agent, adapter, payment target, verifier and scenario versions; exact non-secret configuration snapshots/digests.
- Authorized policy versus target's configured policy, and explicitly observed versus merely declared settings.
- Exact malicious input, delivery surface, captured tool calls, attempted requests and target responses.
- Request-linked raw evidence, actual recipient/amount/asset, settlement finality and timestamps.
- Agent result, enforcement result, coverage gaps, completion, legitimate-control outcome and comparison lineage.

Preserve the existing invariant that refusal does not exercise the firewall. Generalize classification by scenario objective rather than the literal `malicious-invoice` ID. This avoids incorrectly treating new attacks as legitimate-payment controls.

## Real vulnerable-versus-protected demonstration

Use two complementary test modes with unmistakable labels:

1. **Live-agent attack:** same scenario and agent configuration, isolated runs against each payment configuration. Preserve actual model behavior, including refusal. Report all attempts/repetitions rather than selecting a convenient successful attack. Record configured sampling settings where supported; same prompts do not guarantee identical decisions.
2. **Firewall probe / captured-request replay:** submit the same explicit unsafe request sequence to both payment configurations. It may originate from a recorded real agent call or a deterministic fixture; label its origin. This establishes enforcement differences without claiming a model generated a fixture.

For the first comparison, use the unchanged reference contract with different fresh-vault configurations. An overspending probe can request 0.03 NEAR against a declared 0.025 maximum: a permissive vault configured to 0.05 should settle; the protected vault configured to 0.025 should deny. Fund both adequately and keep recipient, request and authorization oracle constant. This demonstrates a real configuration failure relative to the declared security requirement, not a contract exploit. Run a legitimate control in each configuration.

For recipient redirection, the single-recipient contract cannot represent a generally unrestricted wallet. Use a separately implemented bounded testnet direct-transfer target, or an external firewall's actual permissive configuration, rather than weakening the protected contract. An intentionally weak agent prompt may be another disclosed configuration, but it cannot guarantee a malicious tool call and must never hard-code one as model output.

The stronger platform demo is a developer-owned HTTP agent against a developer-owned firewall, showing the same evidence/report format. A second adapter written by us proves the extension seam; it does not by itself prove compatibility with someone else's production product.

## Implementation sequence and acceptance gates

### 1. Extract without changing behavior

Move orchestration, request evaluation and report assembly into core; wrap existing NEAR provisioning/payment behavior and ShoppingBot as defaults. Keep `scripts/shoppingbot.ts` as a compatible entry point. Remove NEAR global transport initialization from generic core imports; retain it inside the existing isolated NEAR runner until scoped transport support warrants change.

Gate: existing adapter, API, Rust, Sandbox and browser suites still pass; one explicit real NEAR smoke run yields the same evidence semantics. No migration/redeployment of the working contract.

### 2. Prove external integration before expanding the dashboard

Implement registry, HTTP agent bridge, payment-system interface and separate NEAR verifier. Add a small external agent example running as a separate process, with real model execution for the live demonstration. Integrate one actual developer-owned NEAR-settling firewall when its API and test credentials are available. Until then, report that integration as pending.

Gate: a new adapter is selectable by registration/configuration with no changes to `runTest`; bridge duplicates and timeouts cannot cause repeated payouts; a false settlement claim or unrelated transaction hash is rejected by verification. Test remote denial without a transaction hash and asynchronous settlement.

### 3. Persist target selection and replay accurately

Add migration 002; retain existing records and seed defaults. Remove the ShoppingBot-only adapter constraint. Add payment targets and immutable run snapshots for agent, payment adapter, verifier and scenario configuration. Include all selected targets/configurations in idempotency comparisons. Make vault metadata optional and target-specific; transaction identity includes network, with a run/attempt association rather than assuming each hash belongs to only one run. Extend the migration runner beyond its current version-1-only implementation.

API accepts registered `agentId`, `paymentSystemId`, scenario/configuration IDs and execution mode. Worker invokes the generic CLI, preserving its single-worker lock and interruption behavior. Replay retains the original snapshot; comparisons explicitly reference parent and changed configuration. UI selects targets and calls the vault a reference integration.

Gate: old reports remain readable; default requests retain existing behavior; changed targets cannot accidentally reuse a prior idempotent result; interrupted external submissions require reconciliation.

### 4. Add attacks and paired controls

Prioritize overspending, duplicate invoice payment, and split-payment budget evasion after the existing malicious invoice. Each scenario declares capabilities, authorization expectations, attack surface, version and a stateful objective evaluator. Add direct unauthorized-recipient probes alongside injection variants. Keep paused/revoked-agent tests later; the reference contract supports pause, not arbitrary membership revocation.

Split-budget fixtures need enough funds/storage and distinct invoice IDs so rejection is caused by cumulative limits, not balance exhaustion or duplicate detection. Tests of aggregate enforcement should have individually valid amounts. A changed invoice ID can bypass invoice-ID deduplication; describe that limitation rather than claim semantic duplicate detection.

Gate: every scenario has a legitimate control; declared expected denial reasons match observed evidence; unsupported capabilities are reported as not supported, never a pass. The runner needs no scenario-name branches.

### 5. Comparative reports and integration documentation

Add side-by-side agent/target/configuration results with evidence links, run counts and coverage. Publish the adapter protocol, example integrations and conformance checks. Only then prioritize public deployment and broader onboarding.

Release gate: an external agent and independent payment target can be configured without editing core; a paired test shows verified unauthorized settlement versus verified rejection; existing NEAR reference tests and historical reports remain intact. No requirement to add withdrawals or mutable vault policy to achieve this milestone.

## Review validation

This review changed documentation only. TypeScript checks and all six existing agent tests passed during inspection. No new paid model calls, testnet transfers, contract changes or database migrations were performed for this review. Existing integration evidence remains preserved; full integration regression runs belong to the implementation gates above.
