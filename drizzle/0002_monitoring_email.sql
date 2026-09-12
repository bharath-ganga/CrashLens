CREATE TABLE IF NOT EXISTS uptime_monitors (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL, created_by TEXT NOT NULL,
  name TEXT NOT NULL, url TEXT NOT NULL, service TEXT NOT NULL,
  interval_seconds INTEGER NOT NULL DEFAULT 300, failure_threshold INTEGER NOT NULL DEFAULT 3,
  enabled INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'pending',
  consecutive_failures INTEGER NOT NULL DEFAULT 0, last_checked_at INTEGER,
  next_check_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
  last_latency_ms INTEGER, last_http_status INTEGER, last_error TEXT,
  outage_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_monitors_due ON uptime_monitors(enabled, next_check_at);
CREATE INDEX IF NOT EXISTS idx_monitors_team ON uptime_monitors(team_id);
CREATE TABLE IF NOT EXISTS uptime_checks (
  id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL, checked_at INTEGER NOT NULL,
  ok INTEGER NOT NULL, latency_ms INTEGER NOT NULL, http_status INTEGER, error TEXT
);
CREATE INDEX IF NOT EXISTS idx_checks_monitor_time ON uptime_checks(monitor_id, checked_at DESC);
CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY, event_key TEXT NOT NULL, team_id TEXT NOT NULL, recipient TEXT NOT NULL,
  subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at TEXT, UNIQUE(event_key, recipient)
);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON email_outbox(status, next_attempt_at);
CREATE TABLE IF NOT EXISTS scheduler_state (
  id TEXT PRIMARY KEY, last_run_at INTEGER NOT NULL
);
