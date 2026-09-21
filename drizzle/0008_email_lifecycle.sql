CREATE TABLE IF NOT EXISTS email_preferences (
  user_id TEXT PRIMARY KEY,
  incident_alerts INTEGER NOT NULL DEFAULT 1,
  team_activity INTEGER NOT NULL DEFAULT 1,
  product_updates INTEGER NOT NULL DEFAULT 0,
  digest_frequency TEXT NOT NULL DEFAULT 'none',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_provider_messages (
  provider_email_id TEXT PRIMARY KEY,
  outbox_id TEXT NOT NULL UNIQUE,
  recipient TEXT NOT NULL,
  last_event TEXT NOT NULL DEFAULT 'sent',
  last_event_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_provider_outbox ON email_provider_messages(outbox_id);
CREATE INDEX IF NOT EXISTS idx_email_provider_recipient ON email_provider_messages(recipient, created_at DESC);

CREATE TABLE IF NOT EXISTS email_delivery_events (
  id TEXT PRIMARY KEY,
  provider_email_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider_email_id, event_type, occurred_at)
);
CREATE INDEX IF NOT EXISTS idx_email_events_provider ON email_delivery_events(provider_email_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS email_suppressions (
  email TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  provider_email_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
