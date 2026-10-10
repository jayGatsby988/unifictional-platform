-- Nightly website health check (inspection engine run on the client's own site).
alter table public.website_snapshots add column if not exists health jsonb;
alter table public.website_snapshots add column if not exists health_at timestamptz;
