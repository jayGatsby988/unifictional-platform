-- Free website/SEO inspections from the landing page (leads). Reconstructed from the
-- live schema: this table was created live (as part of "admin_writes_and_public_audits")
-- but its file was never saved, which broke rebuilding the database from these files.
create table if not exists public.audit_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  url text not null,
  email text,
  name text,
  phone text,
  company text,
  report jsonb not null,
  ghl_contact_id text,
  ip_hash text
);
alter table public.audit_reports enable row level security;
drop policy if exists "admin read" on public.audit_reports;
create policy "admin read" on public.audit_reports for select using (public.is_portal_admin());
-- 0006 adds "admin write" and the anonymous "public insert"; 0007 adds status/notes/updated_at.
