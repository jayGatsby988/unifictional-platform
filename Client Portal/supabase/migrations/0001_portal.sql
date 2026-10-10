-- Unifictional client portal schema. Run in the Supabase SQL editor or via
-- `supabase db push`. Every table is client-scoped and locked down with RLS:
-- a signed-in user sees only the clients they are a member of; admins see all.

create extension if not exists pgcrypto;

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  industry text,
  city text,
  website_url text,
  launched_at date,
  services text[] default '{}',
  manager_name text default 'Trishank',
  manager_email text default 'unifictional@gmail.com',
  ghl_contact_id text,
  created_at timestamptz default now()
);

create table if not exists portal_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists client_members (
  client_id uuid references clients(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text default 'owner',
  primary key (client_id, user_id)
);

-- Website ------------------------------------------------------------------
create table if not exists website_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  captured_at timestamptz default now(),
  status text default 'live' check (status in ('live','building','maintenance')),
  uptime_pct numeric(5,2),
  perf_score int, seo_score int, a11y_score int, bp_score int,
  lcp_ms int, cls numeric(5,3), inp_ms int,
  sources jsonb default '[]',    -- [{name, sharePct}]
  top_pages jsonb default '[]'   -- [{path, views, conversions}]
);

create table if not exists website_daily (
  client_id uuid references clients(id) on delete cascade,
  date date not null,
  sessions int default 0, users int default 0, pageviews int default 0,
  form_submissions int default 0, calls int default 0,
  primary key (client_id, date)
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  at timestamptz default now(),
  type text check (type in ('form','call')),
  detail text
);

-- Search -------------------------------------------------------------------
create table if not exists seo_daily (
  client_id uuid references clients(id) on delete cascade,
  date date not null,
  clicks int default 0, impressions int default 0, ctr numeric(6,2), position numeric(6,1),
  primary key (client_id, date)
);

create table if not exists seo_keywords (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  keyword text not null,
  position numeric(6,1) not null,
  prev_position numeric(6,1),
  clicks int default 0, impressions int default 0,
  url text,
  checked_at timestamptz default now(),
  unique (client_id, keyword)
);

create table if not exists gbp_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  period_start date not null,
  views int, searches int, calls int, directions int, website_clicks int,
  reviews int, rating numeric(2,1), new_reviews int
);

create table if not exists work_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  area text check (area in ('website','seo','social','estimator','account')),
  at timestamptz default now(),
  title text not null,
  detail text
);

-- Social -------------------------------------------------------------------
create table if not exists social_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  platform text check (platform in ('instagram','facebook')),
  handle text, url text,
  followers int, followers_delta_30 int, reach_30 int, profile_visits_30 int, posts_30 int,
  engagement_rate numeric(5,2),
  synced_at timestamptz default now(),
  unique (client_id, platform)
);

create table if not exists social_daily (
  client_id uuid references clients(id) on delete cascade,
  platform text,
  date date not null,
  followers int, reach int, impressions int, profile_visits int, engagement int,
  primary key (client_id, platform, date)
);

create table if not exists social_posts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  platform text, kind text, caption text, media_url text, permalink text,
  posted_at timestamptz, status text check (status in ('published','scheduled')),
  likes int default 0, comments int default 0, saves int default 0, reach int default 0
);

-- Instant-quote tool (embedded on the client's website) ----------------------
-- The contractor edits pricing here; the embed reads `config` and writes a row
-- into estimator_generations every time a homeowner generates a 3D quote.
create table if not exists estimator_settings (
  client_id uuid primary key references clients(id) on delete cascade,
  embedded boolean default false,
  embed_path text default '/get-a-quote',
  sessions_30 int, sessions_prev_30 int,
  config jsonb not null default '{"projectTypes":[],"options":[],"markupPct":0,"rangePct":8,"depositPct":10,"disclaimer":""}',
  updated_at timestamptz default now()
);

create table if not exists estimator_generations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  at timestamptz default now(),
  project_type_id text, project_type text,
  size numeric, unit text default 'sqft',
  options text[] default '{}',
  quote_low numeric, quote_high numeric,
  contact_name text, contact_email text, contact_phone text, contact_address text,
  status text default 'new' check (status in ('new','contacted','quoted','won','lost')),
  source_page text,
  notes text,
  model_url text   -- the generated 3D scene, if the embed stores one
);
create index if not exists estimator_generations_client_at on estimator_generations (client_id, at desc);

-- Requests + activity --------------------------------------------------------
create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  type text check (type in ('website','seo','social','estimator','other')),
  title text not null, body text,
  status text default 'open' check (status in ('open','in_progress','done')),
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists activity (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  area text check (area in ('website','seo','social','estimator','account')),
  at timestamptz default now(),
  title text not null
);

-- RLS ------------------------------------------------------------------------
create or replace function is_portal_admin() returns boolean language sql stable as $$
  select exists (select 1 from portal_admins where user_id = auth.uid());
$$;

create or replace function is_client_member(cid uuid) returns boolean language sql stable as $$
  select is_portal_admin() or exists (select 1 from client_members where client_id = cid and user_id = auth.uid());
$$;

do $$
declare t text;
begin
  foreach t in array array['clients','website_snapshots','website_daily','leads','seo_daily','seo_keywords','gbp_snapshots','work_log',
                           'social_accounts','social_daily','social_posts','estimator_settings','estimator_generations','requests','activity']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "member read" on %I', t);
    if t = 'clients' then
      execute 'create policy "member read" on clients for select using (is_client_member(id))';
    else
      execute format('create policy "member read" on %I for select using (is_client_member(client_id))', t);
    end if;
  end loop;
end $$;

alter table portal_admins enable row level security;
create policy "self read" on portal_admins for select using (user_id = auth.uid());
alter table client_members enable row level security;
create policy "self read" on client_members for select using (user_id = auth.uid() or is_portal_admin());

-- Clients can open requests; only the studio (service role / admins) edits anything else.
create policy "member insert" on requests for insert with check (is_client_member(client_id));
create policy "admin all" on requests for all using (is_portal_admin());

-- Contractors own their pricing and can work their quote leads.
create policy "member upsert settings" on estimator_settings for insert with check (is_client_member(client_id));
create policy "member update settings" on estimator_settings for update using (is_client_member(client_id));
create policy "member update generations" on estimator_generations for update using (is_client_member(client_id));
-- The website embed inserts generations with the service role (server-side), never the anon key.
