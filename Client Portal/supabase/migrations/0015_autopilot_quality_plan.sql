-- SEO Autopilot, second pass: every post carries why it was chosen and its SEO
-- checklist score; every company carries a content plan the bot writes from;
-- clients can tick the suggested fixes done (runs.fixes[].done) and skip or
-- reorder planned topics.
alter table public.seo_posts add column if not exists rationale text;
alter table public.seo_posts add column if not exists quality jsonb;          -- {score, checks:[{id,label,ok,detail}]}
alter table public.seo_autopilot add column if not exists plan jsonb not null default '[]';  -- [{id,title,targetQuery,angle,status}]

drop policy if exists "member update" on public.seo_autopilot_runs;
create policy "member update" on public.seo_autopilot_runs for update using (public.is_client_member(client_id)) with check (public.is_client_member(client_id));
