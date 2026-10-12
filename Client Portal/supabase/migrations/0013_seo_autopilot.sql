-- SEO Autopilot. The client turns it on once from /autopilot (two questions: where the
-- site lives, and whether to publish straight away or ask first). A daily cron
-- (/api/autopilot/run) then writes a local-search blog post on the chosen cadence,
-- publishes it (GitHub commit for sites we host, WordPress REST, or "ready to paste"),
-- and proposes on-page fixes from the nightly health check and Search Console data.

create table if not exists public.seo_autopilot (
  client_id uuid primary key references public.clients(id) on delete cascade,
  enabled boolean not null default false,
  cadence text not null default 'weekly' check (cadence in ('twice_weekly','weekly','biweekly','monthly')),
  mode text not null default 'approve' check (mode in ('auto','approve')),      -- auto = publish, approve = client OKs each post
  target text not null default 'hosted' check (target in ('hosted','wordpress','manual')),
  wp_connected boolean not null default false,                                 -- the client's WordPress login was verified
  notes text,                                                                  -- what to push / avoid, in the owner's words
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.seo_autopilot enable row level security;
drop policy if exists "member read" on public.seo_autopilot;
create policy "member read" on public.seo_autopilot for select using (public.is_client_member(client_id));
drop policy if exists "member insert" on public.seo_autopilot;
create policy "member insert" on public.seo_autopilot for insert with check (public.is_client_member(client_id));
drop policy if exists "member update" on public.seo_autopilot;
create policy "member update" on public.seo_autopilot for update using (public.is_client_member(client_id)) with check (public.is_client_member(client_id));
drop policy if exists "admin all" on public.seo_autopilot;
create policy "admin all" on public.seo_autopilot for all using (public.is_portal_admin()) with check (public.is_portal_admin());

create table if not exists public.seo_posts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  created_at timestamptz default now(),
  title text not null,
  slug text not null,
  target_query text,
  meta_description text,
  excerpt text,
  body_md text not null,
  word_count int default 0,
  -- awaiting_approval → approved → published | ready (no auto-publish path, client pastes it) | failed; skipped = client said no
  status text not null default 'awaiting_approval' check (status in ('awaiting_approval','approved','ready','published','skipped','failed')),
  published_url text,
  published_at timestamptz,
  error text,
  updated_at timestamptz default now(),
  unique (client_id, slug)
);
create index if not exists seo_posts_client_created on public.seo_posts (client_id, created_at desc);
alter table public.seo_posts enable row level security;
drop policy if exists "member read" on public.seo_posts;
create policy "member read" on public.seo_posts for select using (public.is_client_member(client_id));
drop policy if exists "member update" on public.seo_posts;
create policy "member update" on public.seo_posts for update using (public.is_client_member(client_id)) with check (public.is_client_member(client_id));
drop policy if exists "admin all" on public.seo_posts;
create policy "admin all" on public.seo_posts for all using (public.is_portal_admin()) with check (public.is_portal_admin());

create table if not exists public.seo_autopilot_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ran_at timestamptz default now(),
  ok boolean not null,
  summary text,
  post_id uuid references public.seo_posts(id) on delete set null,
  fixes jsonb not null default '[]'     -- [{title, where, why, how, impact}]
);
create index if not exists seo_autopilot_runs_client_ran on public.seo_autopilot_runs (client_id, ran_at desc);
alter table public.seo_autopilot_runs enable row level security;
drop policy if exists "member read" on public.seo_autopilot_runs;
create policy "member read" on public.seo_autopilot_runs for select using (public.is_client_member(client_id));
drop policy if exists "admin all" on public.seo_autopilot_runs;
create policy "admin all" on public.seo_autopilot_runs for all using (public.is_portal_admin()) with check (public.is_portal_admin());

-- Where posts get published. client_integrations is admin-only; the client writes their
-- WordPress login through the definer function below and can never read it back.
alter table public.client_integrations add column if not exists site_repo text;        -- GitHub owner/name of a site we host (Vercel deploys the commit)
alter table public.client_integrations add column if not exists site_blog_dir text;    -- folder the post .md goes in, default content/blog
alter table public.client_integrations add column if not exists wp_url text;
alter table public.client_integrations add column if not exists wp_user text;
alter table public.client_integrations add column if not exists wp_app_password text;

create or replace function public.autopilot_set_wordpress(p_client uuid, p_url text, p_user text, p_password text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_client_member(p_client) then raise exception 'not allowed'; end if;
  insert into public.client_integrations (client_id, wp_url, wp_user, wp_app_password, updated_at)
  values (p_client, p_url, p_user, p_password, now())
  on conflict (client_id) do update
    set wp_url = excluded.wp_url, wp_user = excluded.wp_user, wp_app_password = excluded.wp_app_password, updated_at = now();
  return true;
end $$;
revoke all on function public.autopilot_set_wordpress(uuid, text, text, text) from public, anon;
grant execute on function public.autopilot_set_wordpress(uuid, text, text, text) to authenticated;
