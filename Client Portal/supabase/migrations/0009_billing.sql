-- Billing: each company can be linked to one Square customer.
-- Invoices, plans and cards stay in Square and are read live; only the link lives here.
alter table public.clients add column if not exists square_customer_id text;
create unique index if not exists clients_square_customer_id_key on public.clients (square_customer_id) where square_customer_id is not null;

-- Clients can ask about a charge from the Billing page.
alter table public.requests drop constraint if exists requests_type_check;
alter table public.requests add constraint requests_type_check check (type in ('website','seo','social','estimator','billing','other'));
