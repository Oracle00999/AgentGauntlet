# Foundation decisions

The Rust multi-vault contract is the authority for funds. The TypeScript command-line runner is an owner-operated integration harness, not a public API. It signs testnet transactions and records independently queried final receipts and payment state. Direct probes are explicitly not AI-agent behavior tests.

Each vault has one owner, one authorized agent, one permitted recipient, exact yoctoNEAR limits, available funds, pending reservations, a UTC-day counter, and a storage reserve. One recipient and immutable authorization/policy are deliberate first-slice restrictions. Owner pause is available. Multi-recipient configuration, revocation, policy changes and callback-safe owner withdrawal are subsequent contract work.

An accepted request moves funds from available to reserved and immediately consumes the request day's budget. Only its private transfer callback can mark it settled or failed. Failure restores funds and restores the original day's counter only if that day remains current. Payment IDs remain consumed even after transfer failure; retries query existing state rather than transfer again. Denied IDs are not persisted, consume no storage and can be retried after correcting the request. Denials have structured events.

Storage funding is separate from payment funding. Creation retains 4,096 bytes worth of storage cost and each accepted request retains 2,048 bytes, covering bounded serialized records conservatively. Vault IDs are at most 64 bytes; payment IDs at most 128. Storage deposits are not withdrawable in this slice. Deployment funding covers contract code and initial state. The initial contract has no withdrawal or upgrade methods; the deployment account still has its full-access key, so its operator is a trusted administrator.

The runner uses FASTNEAR testnet RPC and checks its reported network. Account keys live in ignored `.env`, mode 0600 when generated. No web server, agent prompt, or browser receives credentials. The demonstration agent's account is separate from the owner. ShoppingBot uses a separately generated function-call key restricted to `request_payment` on the contract, verified before each run. Administrative keys remain local for provisioning and deterministic probes.

ShoppingBot uses real OpenAI tool calling through a typed payment adapter, with scenario snapshots and evidence-based classification. The backend now uses Express (the user's chosen framework), PostgreSQL, authenticated execution endpoints, and a separate persistent worker. The attack lab UI is implemented. A generic runner now injects agent, payment-system and verifier interfaces; external HTTP agents and configured targets are supported. See [integration architecture and protocol](external-integrations.md). Model refusal does not prove contract enforcement; unavailable RPC never means a defense succeeded.

References checked during implementation:

- https://docs.near.org/tools/near-api
- https://docs.rs/near-sdk/5.29.1/near_sdk/
- https://github.com/near/near-workspaces-js
- https://github.com/near/NEPs/blob/master/neps/nep-0297.md
