-- Membership helpers must bypass RLS. As plain SQL functions, is_portal_admin() reads
-- portal_admins, whose "admin write" policy calls is_portal_admin() again: infinite
-- recursion ("stack depth limit exceeded") for every non-admin, so client logins saw no
-- company. These definitions match the original live project (applied there directly,
-- never saved to a file until now).
create or replace function public.is_portal_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.portal_admins where user_id = auth.uid());
$$;

create or replace function public.is_client_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_portal_admin() or exists (select 1 from public.client_members where client_id = cid and user_id = auth.uid());
$$;
