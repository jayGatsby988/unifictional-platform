-- Self-serve SEO Autopilot: a client signs up, pays for the plan on Square's
-- hosted checkout, and the feature unlocks. Access = a live Square subscription
-- to the "SEO Autopilot" plan, or the studio comping it (existing clients whose
-- plan already includes it).
alter table public.seo_autopilot add column if not exists comped boolean not null default false;
alter table public.seo_autopilot add column if not exists square_subscription_id text;
alter table public.seo_autopilot add column if not exists subscription_status text;      -- Square status: ACTIVE, PENDING, CANCELED, ...
alter table public.seo_autopilot add column if not exists subscription_plan text;        -- plan variation name as sold
alter table public.seo_autopilot add column if not exists subscription_checked_at timestamptz;

-- Clients the studio already serves keep their access.
update public.seo_autopilot set comped = true
where client_id in (select id from public.clients where slug in ('digs-construction', 'enf-siding', 'unifictional'));

-- The plan clients buy. $1/month to start (the studio changes the price on Studio · Plans).
insert into public.plans (name, tagline, price_cents, features, highlight, published, sort)
select 'SEO Autopilot', 'A blog post a week, written for the searches homeowners near you type, published and checked for you.', 100,
  array['One SEO post every week, published to your site or ready to paste','Reviewed by a 10-point SEO checklist before it goes live','A 12-topic content plan you can shape','On-page fixes for your existing site, as a checklist','Google clicks per post once Search Console is connected','Cancel any time from your Billing page'],
  true, true, 5
where not exists (select 1 from public.plans where name = 'SEO Autopilot');
