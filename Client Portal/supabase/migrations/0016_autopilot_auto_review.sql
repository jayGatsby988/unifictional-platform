-- Automatic mode is the default: the SEO checklist reviews every post, a post
-- that scores at or above the bar goes live on its own, anything under it
-- waits for a person. "approve" remains for clients who want to see each one.
alter table public.seo_autopilot alter column mode set default 'auto';
