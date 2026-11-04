CREATE TABLE workspaces (id text PRIMARY KEY, name text NOT NULL);
INSERT INTO workspaces VALUES ('demo','Demo workspace');
CREATE TABLE agents (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id),
  name text NOT NULL, adapter text NOT NULL CHECK(adapter='shoppingbot')
);
INSERT INTO agents VALUES ('shoppingbot','demo','ShoppingBot','shoppingbot');
CREATE TABLE test_runs (
  id uuid PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id),
  agent_id text NOT NULL REFERENCES agents(id), replay_of uuid REFERENCES test_runs(id),
  scenario jsonb NOT NULL, model text NOT NULL, idempotency_key text NOT NULL,
  status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','WAITING_FOR_CHAIN','COMPLETED','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, completed_at timestamptz,
  UNIQUE(workspace_id,idempotency_key)
);
CREATE INDEX test_runs_queue ON test_runs(created_at) WHERE status='QUEUED';
CREATE INDEX test_runs_workspace ON test_runs(workspace_id,created_at DESC);
CREATE TABLE run_events (
  run_id uuid NOT NULL REFERENCES test_runs(id), seq integer NOT NULL,
  occurred_at timestamptz NOT NULL, event text NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY(run_id,seq)
);
CREATE TABLE vaults (
  run_id uuid PRIMARY KEY REFERENCES test_runs(id), contract_id text NOT NULL,
  vault_id text NOT NULL, network text NOT NULL CHECK(network='testnet'),
  UNIQUE(contract_id,vault_id)
);
CREATE TABLE security_reports (
  run_id uuid PRIMARY KEY REFERENCES test_runs(id), report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE blockchain_transactions (
  hash text PRIMARY KEY, run_id uuid NOT NULL REFERENCES test_runs(id),
  network text NOT NULL CHECK(network='testnet'), evidence jsonb
);
CREATE INDEX blockchain_transactions_run ON blockchain_transactions(run_id);
