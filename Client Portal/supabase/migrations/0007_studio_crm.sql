-- Studio CRM: account requests table, pipeline fields on inspection leads and
-- support requests, and admin-only helpers to link logins to companies.
create table if not exists public.signup_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text, company text, email text not null, phone text, website text,
  status text default 'new' check (status in ('new','contacted','qualified','won','lost')),
  notes text,
  client_id uuid references public.clients(id) on delete set null,
  updated_at timestamptz default now()
);
alter table public.signup_requests enable row level security;
drop policy if exists "public insert" on public.signup_requests;
create policy "public insert" on public.signup_requests for insert to anon, authenticated with check (true);
drop policy if exists "admin write" on public.signup_requests;
create policy "admin write" on public.signup_requests for all using (public.is_portal_admin()) with check (public.is_portal_admin());

alter table public.audit_reports add column if not exists status text default 'new';
alter table public.audit_reports add column if not exists notes text;
alter table public.audit_reports add column if not exists updated_at timestamptz default now();
alter table public.audit_reports drop constraint if exists audit_reports_status_check;
alter table public.audit_reports add constraint audit_reports_status_check check (status in ('new','contacted','qualified','won','lost'));

alter table public.requests add column if not exists reply text;
alter table public.requests add column if not exists requester_email text;
alter table public.requests add column if not exists updated_at timestamptz default now();

create or replace function public.admin_link_member(p_email text, p_client uuid, p_role text default 'owner')
returns boolean language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not public.is_portal_admin() then raise exception 'not allowed'; end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_user is null then return false; end if;
  insert into public.client_members (client_id, user_id, role) values (p_client, v_user, coalesce(p_role, 'owner')) on conflict do nothing;
  return true;
end $$;
revoke all on function public.admin_link_member(text, uuid, text) from public, anon;
grant execute on function public.admin_link_member(text, uuid, text) to authenticated;

create or replace function public.admin_client_logins()
returns table (client_id uuid, email text) language sql stable security definer set search_path = public as $$
  select m.client_id, u.email::text from public.client_members m join auth.users u on u.id = m.user_id
  where public.is_portal_admin();
$$;
revoke all on function public.admin_client_logins() from public, anon;
grant execute on function public.admin_client_logins() to authenticated;
