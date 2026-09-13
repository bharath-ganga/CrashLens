ALTER TABLE uptime_monitors ADD COLUMN method TEXT NOT NULL DEFAULT 'HEAD';
ALTER TABLE uptime_monitors ADD COLUMN timeout_ms INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE uptime_monitors ADD COLUMN expected_min INTEGER NOT NULL DEFAULT 200;
ALTER TABLE uptime_monitors ADD COLUMN expected_max INTEGER NOT NULL DEFAULT 299;
ALTER TABLE uptime_monitors ADD COLUMN assertion_type TEXT NOT NULL DEFAULT 'none';
ALTER TABLE uptime_monitors ADD COLUMN assertion_value TEXT;
ALTER TABLE uptime_monitors ADD COLUMN request_headers_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE uptime_monitors ADD COLUMN request_body TEXT;
ALTER TABLE uptime_monitors ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE uptime_monitors ADD COLUMN project_id TEXT;
ALTER TABLE uptime_checks ADD COLUMN region TEXT NOT NULL DEFAULT 'origin';
ALTER TABLE uptime_checks ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS monitor_projects (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL, name TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, name)
);
CREATE INDEX IF NOT EXISTS idx_monitor_projects_team ON monitor_projects(team_id, created_at DESC);
