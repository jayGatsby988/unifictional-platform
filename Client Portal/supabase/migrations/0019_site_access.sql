-- "Somewhere else" sites (GoDaddy, Wix, Squarespace…): how we get posts onto them.
-- The client invites the studio as a collaborator, shares a login, or pastes posts
-- themselves. The non-secret part lives on seo_autopilot (member-readable); the
-- login itself goes into the admin-only client_integrations table through a
-- definer function, like the WordPress application password.

alter table public.seo_autopilot add column if not exists site_platform text;
alter table public.seo_autopilot add column if not exists site_access text check (site_access in ('invite', 'login', 'self'));
alter table public.seo_autopilot add column if not exists site_login_on_file boolean not null default false;
alter table public.seo_autopilot add column if not exists site_invite_sent_at timestamptz;

alter table public.client_integrations add column if not exists site_login_user text;
alter table public.client_integrations add column if not exists site_login_password text;

create or replace function public.autopilot_set_site(p_client uuid, p_url text, p_user text, p_password text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_client_member(p_client) then raise exception 'not allowed'; end if;
  insert into public.client_integrations (client_id, site_url, site_login_user, site_login_password, updated_at)
  values (p_client, nullif(p_url, ''), nullif(p_user, ''), nullif(p_password, ''), now())
  on conflict (client_id) do update set
    site_url = coalesce(excluded.site_url, client_integrations.site_url),
    site_login_user = coalesce(excluded.site_login_user, client_integrations.site_login_user),
    site_login_password = coalesce(excluded.site_login_password, client_integrations.site_login_password),
    updated_at = now();
  if nullif(p_url, '') is not null then
    update public.clients set website_url = coalesce(nullif(website_url, ''), p_url) where id = p_client;
  end if;
  return true;
end $$;
revoke all on function public.autopilot_set_site(uuid, text, text, text) from public, anon;
grant execute on function public.autopilot_set_site(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
