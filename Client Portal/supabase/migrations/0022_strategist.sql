-- The SEO strategist: the client talks to it about where they want to go
-- (more of X, a town, a product line) and it acts on the plan. The priority
-- searches it records feed the brief; the conversation is kept so it carries
-- on across visits.
alter table public.seo_autopilot add column if not exists focus_keywords jsonb not null default '[]'::jsonb;
alter table public.seo_autopilot add column if not exists chat jsonb not null default '[]'::jsonb;
notify pgrst, 'reload schema';
