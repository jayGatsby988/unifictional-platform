-- SEO Autopilot "portal feed" publishing, for sites we host that aren't deployed
-- from GitHub. The site pulls its published posts from
-- /api/autopilot/feed?client=<slug> (ISR), and after each publish the portal
-- pings this URL (the site's /api/revalidate with its secret) so the post shows
-- up at once instead of at the next revalidation window.
alter table public.client_integrations add column if not exists site_revalidate_url text;
