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

-- Starting point: every plan shows "Custom" (the studio quotes on a call, per the pricing policy).
-- Local SEO is published; the others are drafts until the studio publishes them.
insert into public.plans (name, tagline, price_cents, features, highlight, published, sort)
select * from (values
  ('Local SEO', 'Show up when homeowners near you search for what you do.', null::integer,
    array['Google Business Profile kept current and posted to','Local keyword tracking for your trade and towns','Monthly fixes from your website health check','Service-area pages written and published','Monthly report in this portal'], true, true, 20),
  ('Website care', 'Your site kept fast, safe and up to date.', null::integer,
    array['Hosting, uptime and speed monitoring','Small edits and photo swaps each month','Security and software updates','Monthly health check'], false, false, 10),
  ('SEO + Social', 'Local SEO plus a steady, professional social feed.', null::integer,
    array['Everything in Local SEO','Posts on Facebook and Instagram every week','Before-and-after project highlights','Monthly social report'], false, false, 30),
  ('Growth', 'SEO, social and paid ads working together.', null::integer,
    array['Everything in SEO + Social','Google and Meta ad campaigns managed','Instant-quote tool on your website','Monthly strategy call'], false, false, 40)
) as seed(name, tagline, price_cents, features, highlight, published, sort)
where not exists (select 1 from public.plans);

-- 2026-10-10: the 3D quote tool as its own plan (published, custom-priced).
insert into public.plans (name, tagline, price_cents, features, highlight, published, sort)
select '3D Quote Tool', 'Homeowners design their project in 3D on your website and get a price range on the spot.', null::integer,
  array['Interactive 3D project builder on your website','Instant price ranges from your own rates and options','Every quote lands in this portal as a lead with contact info','Change your prices anytime from the Quote tool page','Set up and styled to match your site'],
  false, true, 25
where not exists (select 1 from public.plans where name = '3D Quote Tool');
