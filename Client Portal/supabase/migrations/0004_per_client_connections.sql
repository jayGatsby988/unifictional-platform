-- Per-company connections. The studio can connect a company's own Google /
-- Meta account instead of (or in addition to) the studio-wide ones; the sync
-- prefers the company's own credentials when present.
alter table client_integrations add column if not exists google_account_label text;
alter table client_integrations add column if not exists meta_user_token text;
alter table client_integrations add column if not exists meta_account_label text;
alter table client_integrations add column if not exists meta_expires_at timestamptz;
