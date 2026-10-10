-- Live data sources per client, written by the studio (admin) and read by the
-- daily sync job. Clients never see this table: RLS allows admins only.

create table if not exists client_integrations (
  client_id uuid primary key references clients(id) on delete cascade,
  site_url text,                      -- homepage to check for uptime + PageSpeed
  ga4_property_id text,               -- GA4 numeric property id, e.g. 412345678
  gsc_site_url text,                  -- Search Console property, e.g. sc-domain:example.com or https://example.com/
  gbp_location_id text,               -- Business Profile location id (numeric)
  gbp_account_id text,                -- Business Profile account id (for reviews)
  google_refresh_token text,          -- OAuth refresh token of the profile manager (GBP only)
  ig_user_id text,                    -- Instagram professional account id
  fb_page_id text,                    -- Facebook page id
  meta_page_token text,               -- long-lived Page access token
  ghl_contact_id text,
  updated_at timestamptz default now()
);

create table if not exists sync_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  source text not null,               -- ga4 | search_console | pagespeed | uptime | gbp | meta
  ok boolean not null,
  message text,
  rows int default 0,
  ran_at timestamptz default now()
);
create index if not exists sync_runs_client_ran on sync_runs (client_id, ran_at desc);

create table if not exists uptime_checks (
  client_id uuid references clients(id) on delete cascade,
  at timestamptz default now(),
  ok boolean not null,
  status int,
  ms int,
  primary key (client_id, at)
);

alter table client_integrations enable row level security;
create policy "admin all" on client_integrations for all using (is_portal_admin());
alter table sync_runs enable row level security;
create policy "member read" on sync_runs for select using (is_client_member(client_id));
alter table uptime_checks enable row level security;
create policy "member read" on uptime_checks for select using (is_client_member(client_id));

-- Upsert keys the sync job relies on.
alter table social_posts add column if not exists external_id text;
create unique index if not exists social_posts_external on social_posts (client_id, external_id);
create unique index if not exists gbp_snapshots_period on gbp_snapshots (client_id, period_start);
