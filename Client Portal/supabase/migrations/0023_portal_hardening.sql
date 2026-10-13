-- Portal hardening (audit 2026-10-12).
--
-- 1. Billing columns on seo_autopilot are server-only. Members may still update their own
--    row (settings, plan, site profile), but a client login can no longer flip `comped`,
--    the Square subscription fields or the package and so unlock SEO Autopilot for free.
--    The service role (our API) and studio admins are unaffected.
create or replace function public.seo_autopilot_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_portal_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.comped := false;
    new.square_subscription_id := null;
    new.subscription_status := null;
    new.subscription_plan := null;
    new.subscription_checked_at := null;
    new.package := null;
    new.recommendation := null;
    new.recommended_at := null;
  else
    new.comped := old.comped;
    new.square_subscription_id := old.square_subscription_id;
    new.subscription_status := old.subscription_status;
    new.subscription_plan := old.subscription_plan;
    new.subscription_checked_at := old.subscription_checked_at;
    new.package := old.package;
    new.recommendation := old.recommendation;
    new.recommended_at := old.recommended_at;
  end if;
  return new;
end $$;

drop trigger if exists seo_autopilot_guard on public.seo_autopilot;
create trigger seo_autopilot_guard before insert or update on public.seo_autopilot
  for each row execute function public.seo_autopilot_guard();

-- 2. Rate limits for the public forms (sign-up, "email me a sign-in link", website check).
--    Keys are hashed (ip:<sha>, email:<sha>); only the service role touches this table.
create table if not exists public.rate_events (
  id bigint generated always as identity primary key,
  key text not null,
  at timestamptz not null default now()
);
create index if not exists rate_events_key_at on public.rate_events (key, at desc);
alter table public.rate_events enable row level security;
revoke all on public.rate_events from anon, authenticated;
