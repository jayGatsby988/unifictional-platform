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
-- One connection per provider for the studio's own accounts. The studio
-- connects Google (Analytics + Search Console + Business Profile) and Meta
-- (Facebook Pages + Instagram) once; clients are then assigned from the
-- properties, listings and pages those accounts can already see.

create table if not exists studio_connections (
  provider text primary key check (provider in ('google','meta')),
  refresh_token text,          -- Google: OAuth refresh token
  access_token text,           -- Meta: long-lived user token (~60 days, re-connect to renew)
  account_label text,          -- e-mail / name shown on the admin page
  scopes text,
  expires_at timestamptz,
  connected_at timestamptz default now()
);

alter table studio_connections enable row level security;
create policy "admin all" on studio_connections for all using (is_portal_admin());
-- Per-company connections. The studio can connect a company's own Google /
-- Meta account instead of (or in addition to) the studio-wide ones; the sync
-- prefers the company's own credentials when present.
alter table client_integrations add column if not exists google_account_label text;
alter table client_integrations add column if not exists meta_user_token text;
alter table client_integrations add column if not exists meta_account_label text;
alter table client_integrations add column if not exists meta_expires_at timestamptz;
-- Free website/SEO inspections from the landing page (leads). Reconstructed from the
-- live schema: this table was created live (as part of "admin_writes_and_public_audits")
-- but its file was never saved, which broke rebuilding the database from these files.
create table if not exists public.audit_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  url text not null,
  email text,
  name text,
  phone text,
  company text,
  report jsonb not null,
  ghl_contact_id text,
  ip_hash text
);
alter table public.audit_reports enable row level security;
drop policy if exists "admin read" on public.audit_reports;
create policy "admin read" on public.audit_reports for select using (public.is_portal_admin());
-- 0006 adds "admin write" and the anonymous "public insert"; 0007 adds status/notes/updated_at.
-- Admins (portal_admins) can write every client-scoped table through their own
-- session, so the sync and the admin page work without the service-role key.
do $$
declare t text;
begin
  foreach t in array array['clients','website_snapshots','website_daily','leads','seo_daily','seo_keywords','gbp_snapshots','work_log',
                           'social_accounts','social_daily','social_posts','estimator_settings','estimator_generations','activity',
                           'sync_runs','uptime_checks','client_members','portal_admins','audit_reports']
  loop
    execute format('drop policy if exists "admin write" on public.%I', t);
    execute format('create policy "admin write" on public.%I for all using (public.is_portal_admin()) with check (public.is_portal_admin())', t);
  end loop;
end $$;

-- The public landing page stores inspection reports with the anon key: insert only, never read.
drop policy if exists "public insert" on public.audit_reports;
create policy "public insert" on public.audit_reports for insert to anon, authenticated with check (true);

-- What a client may know about their own connections: booleans only, never tokens.
create or replace view public.client_connection_status
with (security_invoker = false) as
  select c.id as client_id,
         coalesce(i.site_url, c.website_url) is not null as site,
         i.ga4_property_id is not null as ga4,
         i.gsc_site_url is not null as gsc,
         i.gbp_location_id is not null as gbp,
         (i.fb_page_id is not null or i.ig_user_id is not null) as meta,
         i.updated_at
  from public.clients c
  left join public.client_integrations i on i.client_id = c.id
  where public.is_client_member(c.id);
grant select on public.client_connection_status to authenticated;
-- Studio CRM: account requests table, pipeline fields on inspection leads and
-- support requests, and admin-only helpers to link logins to companies.
create table if not exists public.signup_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text, company text, email text not null, phone text, website text,
  status text default 'new' check (status in ('new','contacted','qualified','won','lost')),
  notes text,
  client_id uuid references public.clients(id) on delete set null,
  updated_at timestamptz default now()
);
alter table public.signup_requests enable row level security;
drop policy if exists "public insert" on public.signup_requests;
create policy "public insert" on public.signup_requests for insert to anon, authenticated with check (true);
drop policy if exists "admin write" on public.signup_requests;
create policy "admin write" on public.signup_requests for all using (public.is_portal_admin()) with check (public.is_portal_admin());

alter table public.audit_reports add column if not exists status text default 'new';
alter table public.audit_reports add column if not exists notes text;
alter table public.audit_reports add column if not exists updated_at timestamptz default now();
alter table public.audit_reports drop constraint if exists audit_reports_status_check;
alter table public.audit_reports add constraint audit_reports_status_check check (status in ('new','contacted','qualified','won','lost'));

alter table public.requests add column if not exists reply text;
alter table public.requests add column if not exists requester_email text;
alter table public.requests add column if not exists updated_at timestamptz default now();

create or replace function public.admin_link_member(p_email text, p_client uuid, p_role text default 'owner')
returns boolean language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not public.is_portal_admin() then raise exception 'not allowed'; end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_user is null then return false; end if;
  insert into public.client_members (client_id, user_id, role) values (p_client, v_user, coalesce(p_role, 'owner')) on conflict do nothing;
  return true;
end $$;
revoke all on function public.admin_link_member(text, uuid, text) from public, anon;
grant execute on function public.admin_link_member(text, uuid, text) to authenticated;

create or replace function public.admin_client_logins()
returns table (client_id uuid, email text) language sql stable security definer set search_path = public as $$
  select m.client_id, u.email::text from public.client_members m join auth.users u on u.id = m.user_id
  where public.is_portal_admin();
$$;
revoke all on function public.admin_client_logins() from public, anon;
grant execute on function public.admin_client_logins() to authenticated;
-- Nightly website health check (inspection engine run on the client's own site).
alter table public.website_snapshots add column if not exists health jsonb;
alter table public.website_snapshots add column if not exists health_at timestamptz;
-- Billing: each company can be linked to one Square customer.
-- Invoices, plans and cards stay in Square and are read live; only the link lives here.
alter table public.clients add column if not exists square_customer_id text;
create unique index if not exists clients_square_customer_id_key on public.clients (square_customer_id) where square_customer_id is not null;

-- Clients can ask about a charge from the Billing page.
alter table public.requests drop constraint if exists requests_type_check;
alter table public.requests add constraint requests_type_check check (type in ('website','seo','social','estimator','billing','other'));
-- Membership helpers must bypass RLS. As plain SQL functions, is_portal_admin() reads
-- portal_admins, whose "admin write" policy calls is_portal_admin() again: infinite
-- recursion ("stack depth limit exceeded") for every non-admin, so client logins saw no
-- company. These definitions match the original live project (applied there directly,
-- never saved to a file until now).
create or replace function public.is_portal_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.portal_admins where user_id = auth.uid());
$$;

create or replace function public.is_client_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_portal_admin() or exists (select 1 from public.client_members where client_id = cid and user_id = auth.uid());
$$;
-- Pending access: emails the studio gave a company access to before they had a login.
-- Claimed automatically (by the server, with the service role) the first time that email signs in.
create table if not exists public.client_invites (
  client_id uuid not null references public.clients(id) on delete cascade,
  email text not null,
  role text not null default 'owner',
  created_at timestamptz default now(),
  primary key (client_id, email)
);
create index if not exists client_invites_email_idx on public.client_invites (lower(email));
alter table public.client_invites enable row level security;
drop policy if exists "admin all" on public.client_invites;
create policy "admin all" on public.client_invites for all using (public.is_portal_admin()) with check (public.is_portal_admin());
-- Membership plans clients can browse on /plans. The studio edits them on /studio/plans.
-- price_cents null = "Custom" (quoted on a call). Only published plans are visible to clients.
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tagline text,
  price_cents integer,
  interval text not null default 'month',
  features text[] not null default '{}',
  highlight boolean not null default false,
  published boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.plans enable row level security;
drop policy if exists "read published" on public.plans;
create policy "read published" on public.plans for select to authenticated using (published or public.is_portal_admin());
drop policy if exists "admin all" on public.plans;
create policy "admin all" on public.plans for all using (public.is_portal_admin()) with check (public.is_portal_admin());

-- Starting point. Only Local SEO carries a real price ($1,500/mo, the current offer);
-- the others are drafts with no price, hidden until the studio prices and publishes them.
insert into public.plans (name, tagline, price_cents, features, highlight, published, sort)
select * from (values
  ('Local SEO', 'Show up when homeowners near you search for what you do.', 150000,
    array['Google Business Profile kept current and posted to','Local keyword tracking for your trade and towns','Monthly fixes from your website health check','Service-area pages written and published','Monthly report in this portal'], true, true, 20),
  ('Website care', 'Your site kept fast, safe and up to date.', null,
    array['Hosting, uptime and speed monitoring','Small edits and photo swaps each month','Security and software updates','Monthly health check'], false, false, 10),
  ('SEO + Social', 'Local SEO plus a steady, professional social feed.', null,
    array['Everything in Local SEO','Posts on Facebook and Instagram every week','Before-and-after project highlights','Monthly social report'], false, false, 30),
  ('Growth', 'SEO, social and paid ads working together.', null,
    array['Everything in SEO + Social','Google and Meta ad campaigns managed','Instant-quote tool on your website','Monthly strategy call'], false, false, 40)
) as seed(name, tagline, price_cents, features, highlight, published, sort)
where not exists (select 1 from public.plans);
