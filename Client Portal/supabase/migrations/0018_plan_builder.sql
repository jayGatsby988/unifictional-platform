-- Plan builder: clients pick how many posts a month and which add-ons (website,
-- social, Google Business Profile), see what we recommend for their site, and buy
-- the exact combination on Square. Prices stay editable on Studio · Plans.

-- Which part each plan row plays in the builder. Rows without a role are shown as
-- before ("I'm interested" → studio quote).
alter table public.plans add column if not exists role text check (role in ('posts', 'website', 'social', 'gbp'));
-- For the 'posts' row: how many posts a month the price buys (per-post rate = price / this).
alter table public.plans add column if not exists posts_per_month integer;

-- What the client chose at checkout, what we recommended, and when.
alter table public.seo_autopilot add column if not exists package jsonb;
alter table public.seo_autopilot add column if not exists recommendation jsonb;
alter table public.seo_autopilot add column if not exists recommended_at timestamptz;

update public.plans set role = 'posts', posts_per_month = coalesce(posts_per_month, 4) where name = 'SEO Autopilot';

update public.plans set
  role = 'website',
  price_cents = coalesce(price_cents, 14900),
  published = true,
  tagline = 'A site built to turn visitors into calls, hosted and cared for.',
  features = array[
    'A new site built for your trade, or we take over the one you have',
    'Hosting, speed and uptime, handled',
    'Edits and photo swaps every month',
    'Security updates and a monthly health check',
    'Somewhere for every post to point: service and area pages'
  ]
where name = 'Website care';

insert into public.plans (name, tagline, price_cents, features, highlight, published, sort, role)
select 'Social posts', 'A steady, professional feed without you touching it.', 19900,
  array['Facebook and Instagram posts every week', 'Before-and-after project highlights from your photos', 'Each blog post turned into a social post', 'Monthly social report in this portal'],
  false, true, 12, 'social'
where not exists (select 1 from public.plans where role = 'social');

insert into public.plans (name, tagline, price_cents, features, highlight, published, sort, role)
select 'Google Business Profile', 'Get into the map pack homeowners see first.', 7900,
  array['Profile kept complete and current', 'A Business Profile post every week', 'Photos added monthly', 'Review replies drafted for you'],
  false, true, 14, 'gbp'
where not exists (select 1 from public.plans where role = 'gbp');

notify pgrst, 'reload schema';
