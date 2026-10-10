-- Pending access: emails the studio gave a company access to before they had a login.
-- Claimed automatically (by the server, with the service role) the first time that email signs in.
create table if not exists public.client_invites (
  client_id uuid not null references public.clients(id) on delete cascade,
  email text not null,
  role text not null default 'owner',
  created_at timestamptz default now(),
  primary key (client_id, email)
);
create index if not exists client_invites_email_idx on public.client_invites (lower(email));
alter table public.client_invites enable row level security;
drop policy if exists "admin all" on public.client_invites;
create policy "admin all" on public.client_invites for all using (public.is_portal_admin()) with check (public.is_portal_admin());
