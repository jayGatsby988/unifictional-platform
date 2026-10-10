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
