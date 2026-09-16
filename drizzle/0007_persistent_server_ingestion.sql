CREATE TABLE IF NOT EXISTS log_entries (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  ingestion_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  service TEXT NOT NULL,
  event_name TEXT,
  message TEXT NOT NULL,
  raw_redacted TEXT NOT NULL,
  request_id TEXT,
  trace_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_log_entries_ingestion_time ON log_entries(ingestion_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_entries_team_service ON log_entries(team_id, service, timestamp);
ALTER TABLE incidents ADD COLUMN timeline_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE incidents ADD COLUMN change_text TEXT NOT NULL DEFAULT '+1 event';
PRAGMA optimize;
