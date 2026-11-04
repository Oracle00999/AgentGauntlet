ALTER TABLE test_runs ADD COLUMN evidence_origin text NOT NULL DEFAULT 'live' CHECK(evidence_origin IN ('live','archived-testnet'));
