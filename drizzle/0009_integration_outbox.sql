CREATE TABLE IF NOT EXISTS integration_outbox (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  event_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, event_key)
);
CREATE INDEX IF NOT EXISTS idx_integration_outbox_due
  ON integration_outbox(status, next_attempt_at, lease_until);
