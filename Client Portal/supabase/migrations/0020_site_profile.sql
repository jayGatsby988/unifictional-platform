-- What the site scan learned about the business (industry, who they sell to,
-- what they offer, searches their customers type), cached for a week so the
-- daily run doesn't re-derive it. Filled by lib/autopilot/profile.ts.
alter table public.seo_autopilot add column if not exists site_profile jsonb;
notify pgrst, 'reload schema';
