CREATE TABLE IF NOT EXISTS telemetry_spans (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL, trace_id TEXT NOT NULL,
  parent_span_id TEXT, service TEXT NOT NULL, operation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok', started_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0, environment TEXT NOT NULL DEFAULT 'production',
  attributes_json TEXT NOT NULL DEFAULT '{}', source TEXT NOT NULL DEFAULT 'otel',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL, service TEXT NOT NULL,
  version TEXT NOT NULL, environment TEXT NOT NULL DEFAULT 'production',
  status TEXT NOT NULL DEFAULT 'success', actor TEXT, deployed_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS service_objectives (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL, service TEXT NOT NULL,
  target_percent REAL NOT NULL DEFAULT 99.9, window_days INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(team_id, service)
);
CREATE TABLE IF NOT EXISTS postmortems (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL, incident_id TEXT,
  title TEXT NOT NULL, report_markdown TEXT NOT NULL, created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_spans_team_started ON telemetry_spans(team_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_spans_trace ON telemetry_spans(team_id, trace_id, started_at);
CREATE INDEX IF NOT EXISTS idx_deployments_team_time ON deployments(team_id, deployed_at DESC);
CREATE INDEX IF NOT EXISTS idx_postmortems_team_created ON postmortems(team_id, created_at DESC);
