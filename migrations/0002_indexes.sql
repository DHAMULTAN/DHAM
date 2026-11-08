-- Indexes for the lookups the backend runs on every request. Safe to apply on an existing database.
-- Apply with: npx wrangler d1 migrations apply <your-db-name> --remote

CREATE INDEX IF NOT EXISTS admin_sessions_account_idx ON admin_sessions (account_name);
CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions (expires_at);
CREATE INDEX IF NOT EXISTS tool_tickets_expires_idx ON tool_tickets (expires_at);
CREATE INDEX IF NOT EXISTS media_items_at_idx ON media_items (at DESC);
CREATE INDEX IF NOT EXISTS media_uploads_created_idx ON media_uploads (created_at);
CREATE INDEX IF NOT EXISTS site_backups_reason_idx ON site_backups (reason, id DESC);
CREATE INDEX IF NOT EXISTS admin_account_roles_name_idx ON admin_account_roles (account_name);
