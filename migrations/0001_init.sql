-- Cloudflare D1 schema for the website backend.
-- Apply with: npx wrangler d1 migrations apply <your-db-name> --remote

CREATE TABLE IF NOT EXISTS site_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS site_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  saved_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'auto',
  note TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS site_backups_created_idx ON site_backups (created_at DESC);

CREATE TABLE IF NOT EXISTS admin_accounts (
  name TEXT PRIMARY KEY,
  pass_hash TEXT NOT NULL,
  is_main INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_accounts_one_main ON admin_accounts (is_main) WHERE is_main = 1;

CREATE TABLE IF NOT EXISTS admin_account_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL REFERENCES admin_accounts(name) ON DELETE CASCADE ON UPDATE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
  UNIQUE (account_name, role)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  account_name TEXT NOT NULL REFERENCES admin_accounts(name) ON DELETE CASCADE ON UPDATE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  who TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  ua TEXT
);
CREATE INDEX IF NOT EXISTS activity_log_at_idx ON activity_log (at DESC);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_key_idx ON login_attempts (key, at DESC);

CREATE TABLE IF NOT EXISTS media_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  alt TEXT NOT NULL DEFAULT '',
  opt INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'image',
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media_uploads (
  id TEXT PRIMARY KEY,
  upload_url TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  opt INTEGER NOT NULL DEFAULT 0,
  chunk INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media_upload_parts (
  id TEXT NOT NULL,
  n INTEGER NOT NULL,
  etag TEXT NOT NULL,
  PRIMARY KEY (id, n)
);

CREATE TABLE IF NOT EXISTS tool_data (
  tool TEXT PRIMARY KEY,
  data TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_zips (
  id TEXT NOT NULL,
  v TEXT NOT NULL,
  entry TEXT,
  name TEXT,
  admin TEXT,
  files TEXT,
  finalized INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (id, v)
);

CREATE TABLE IF NOT EXISTS tool_tickets (
  t TEXT PRIMARY KEY,
  zid TEXT NOT NULL,
  v TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
