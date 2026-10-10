-- One connection per provider for the studio's own accounts. The studio
-- connects Google (Analytics + Search Console + Business Profile) and Meta
-- (Facebook Pages + Instagram) once; clients are then assigned from the
-- properties, listings and pages those accounts can already see.

create table if not exists studio_connections (
  provider text primary key check (provider in ('google','meta')),
  refresh_token text,          -- Google: OAuth refresh token
  access_token text,           -- Meta: long-lived user token (~60 days, re-connect to renew)
  account_label text,          -- e-mail / name shown on the admin page
  scopes text,
  expires_at timestamptz,
  connected_at timestamptz default now()
);

alter table studio_connections enable row level security;
create policy "admin all" on studio_connections for all using (is_portal_admin());
