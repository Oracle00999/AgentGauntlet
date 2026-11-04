ALTER TABLE agents DROP CONSTRAINT agents_adapter_check;
ALTER TABLE agents ADD COLUMN configuration jsonb;
CREATE TABLE payment_systems(id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), configuration jsonb NOT NULL);
ALTER TABLE test_runs ADD COLUMN target_snapshot jsonb;
ALTER TABLE test_runs ADD COLUMN snapshot_digest text;
-- An attempt may refer to a transaction already observed by another run (e.g. reconciliation).
ALTER TABLE blockchain_transactions DROP CONSTRAINT blockchain_transactions_pkey;
ALTER TABLE blockchain_transactions ADD PRIMARY KEY(network,hash,run_id);
CREATE FUNCTION preserve_run_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.scenario IS DISTINCT FROM OLD.scenario OR NEW.model IS DISTINCT FROM OLD.model OR
 NEW.agent_id IS DISTINCT FROM OLD.agent_id OR NEW.target_snapshot IS DISTINCT FROM OLD.target_snapshot OR
 NEW.snapshot_digest IS DISTINCT FROM OLD.snapshot_digest OR NEW.replay_of IS DISTINCT FROM OLD.replay_of THEN
 RAISE EXCEPTION 'Run inputs are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_run_inputs BEFORE UPDATE ON test_runs FOR EACH ROW EXECUTE FUNCTION preserve_run_inputs();
