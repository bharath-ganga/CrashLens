CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
 verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS account_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_sessions_user ON account_sessions(user_id);
CREATE TABLE IF NOT EXISTS account_tokens (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_tokens_user ON account_tokens(user_id,kind);
CREATE TABLE IF NOT EXISTS auth_limits (
 key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 1, window_start INTEGER NOT NULL
);
