create extension if not exists pgcrypto;
create schema if not exists app_private;

create type public.user_role as enum ('admin', 'member');
create type public.quote_status as enum ('pending', 'won', 'invoiced');
create type public.plan_type as enum ('free', 'pro');
create type public.tax_kind as enum ('taxable', 'exempt');
create type public.activity_kind as enum ('quote-created', 'quote-updated', 'status-updated', 'invoice-created', 'memo-added');
create type public.join_request_status as enum ('pending', 'approved', 'rejected', 'canceled');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invoice_registration_no text not null default '',
  plan public.plan_type not null default 'free',
  free_quote_limit integer not null default 20 check (free_quote_limit > 0),
  created_at timestamptz not null default now()
);
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null,
  created_at timestamptz not null default now()
);
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.user_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create table public.organization_join_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  requester_display_name text not null default '',
  requester_email text not null default '',
  message text not null default '',
  status public.join_request_status not null default 'pending',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text not null default '',
  phone text not null default '',
  contact text not null default '',
  contact_title text not null default '',
  email text not null default '',
  invoice_registration_no text not null default '',
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.item_masters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  category text not null default '',
  unit_price integer not null check (unit_price >= 0),
  unit text not null default '式',
  tax_kind public.tax_kind not null default 'taxable',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.quote_number_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  prefix text not null default 'Q',
  year integer not null,
  next_sequence integer not null default 1 check (next_sequence >= 1),
  tax_rate numeric(5,2) not null default 10 check (tax_rate >= 0),
  updated_at timestamptz not null default now()
);
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  quote_no text not null,
  project text not null,
  memo text not null default '',
  amount integer not null check (amount >= 0),
  status public.quote_status not null default 'pending',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, quote_no)
);
create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  item_master_id uuid references public.item_masters(id),
  name text not null,
  unit text not null default '式',
  unit_price integer not null check (unit_price >= 0),
  quantity numeric(12,2) not null check (quantity > 0),
  tax_kind public.tax_kind not null default 'taxable',
  sort_order integer not null default 0
);
create table public.quote_interaction_notes (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  author_id uuid references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid not null references public.quotes(id),
  invoice_no text not null,
  amount integer not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (organization_id, invoice_no)
);
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind public.activity_kind not null,
  title text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create unique index organization_memberships_one_admin_per_org_idx on public.organization_memberships (organization_id) where role = 'admin';
create unique index organization_join_requests_one_pending_per_user_org_idx on public.organization_join_requests (organization_id, user_id) where status = 'pending';
create index organizations_company_id_idx on public.organizations (company_id);
create index organization_memberships_user_id_idx on public.organization_memberships (user_id);
create index organization_join_requests_organization_status_idx on public.organization_join_requests (organization_id, status, created_at desc);
create index organization_join_requests_user_created_at_idx on public.organization_join_requests (user_id, created_at desc);
create index organization_join_requests_reviewed_by_idx on public.organization_join_requests (reviewed_by);
create index activity_logs_organization_created_at_idx on public.activity_logs (organization_id, created_at desc);
create index activity_logs_actor_id_idx on public.activity_logs (actor_id);
create index customers_organization_name_idx on public.customers (organization_id, name);
create index item_masters_organization_name_idx on public.item_masters (organization_id, name);
create index quotes_organization_created_at_idx on public.quotes (organization_id, created_at desc);
create index quotes_organization_status_idx on public.quotes (organization_id, status);
create index quotes_customer_id_idx on public.quotes (customer_id);
create index quotes_created_by_idx on public.quotes (created_by);
create index quote_items_quote_sort_order_idx on public.quote_items (quote_id, sort_order);
create index quote_items_item_master_id_idx on public.quote_items (item_master_id);
create index quote_interaction_notes_quote_id_idx on public.quote_interaction_notes (quote_id);
create index quote_interaction_notes_author_id_idx on public.quote_interaction_notes (author_id);
create index invoices_organization_created_at_idx on public.invoices (organization_id, created_at desc);
create index invoices_quote_id_idx on public.invoices (quote_id);

create or replace function app_private.is_org_member(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = target_organization_id and m.user_id = (select auth.uid())
  );
$$;
create or replace function app_private.is_org_admin(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = target_organization_id and m.user_id = (select auth.uid()) and m.role = 'admin'
  );
$$;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;
revoke all on function app_private.is_org_member(uuid) from public;
revoke all on function app_private.is_org_admin(uuid) from public;
grant execute on function app_private.is_org_member(uuid) to authenticated, service_role;
grant execute on function app_private.is_org_admin(uuid) to authenticated, service_role;

grant usage on schema public to authenticated, service_role;
grant usage on type public.user_role to authenticated, service_role;
grant usage on type public.quote_status to authenticated, service_role;
grant usage on type public.plan_type to authenticated, service_role;
grant usage on type public.tax_kind to authenticated, service_role;
grant usage on type public.activity_kind to authenticated, service_role;
grant usage on type public.join_request_status to authenticated, service_role;
grant select, insert, update, delete on table
  public.organizations,
  public.profiles,
  public.organization_memberships,
  public.organization_join_requests,
  public.customers,
  public.item_masters,
  public.quote_number_settings,
  public.quotes,
  public.quote_items,
  public.quote_interaction_notes,
  public.invoices,
  public.activity_logs
to authenticated, service_role;
grant select on table public.companies to authenticated;
grant update (plan) on table public.companies to authenticated;
grant select, insert, update, delete on table public.companies to service_role;
grant select on table public.platform_admins to authenticated;
grant select, insert, update, delete on table public.platform_admins to service_role;

alter table public.companies enable row level security;
alter table public.platform_admins enable row level security;
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_join_requests enable row level security;
alter table public.customers enable row level security;
alter table public.item_masters enable row level security;
alter table public.quote_number_settings enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.quote_interaction_notes enable row level security;
alter table public.invoices enable row level security;
alter table public.activity_logs enable row level security;

create policy "profiles read self" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles insert self" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles update self" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy platform_admins_read_self on public.platform_admins for select to authenticated using ((select auth.uid()) = user_id);
create policy "members read memberships" on public.organization_memberships for select to authenticated using (app_private.is_org_member(organization_id));
create policy "admins add approved member memberships" on public.organization_memberships for insert to authenticated with check (app_private.is_org_admin(organization_id) and role = 'member' and exists (select 1 from public.organization_join_requests r where r.organization_id = organization_memberships.organization_id and r.user_id = organization_memberships.user_id and r.status = 'approved'));
create policy "admins update member memberships" on public.organization_memberships for update to authenticated using (app_private.is_org_admin(organization_id) and role = 'member') with check (app_private.is_org_admin(organization_id) and role = 'member');
create policy "admins delete member memberships" on public.organization_memberships for delete to authenticated using (app_private.is_org_admin(organization_id) and role = 'member');
create policy "requesters read own join requests" on public.organization_join_requests for select to authenticated using ((select auth.uid()) = user_id);
create policy "admins read organization join requests" on public.organization_join_requests for select to authenticated using (app_private.is_org_admin(organization_id));
create policy "users create own join requests" on public.organization_join_requests for insert to authenticated with check ((select auth.uid()) = user_id and status = 'pending' and not app_private.is_org_member(organization_id));
create policy "requesters cancel pending join requests" on public.organization_join_requests for update to authenticated using ((select auth.uid()) = user_id and status = 'pending') with check ((select auth.uid()) = user_id and status = 'canceled' and reviewed_by is null and reviewed_at is null);
create policy "admins review join requests" on public.organization_join_requests for update to authenticated using (app_private.is_org_admin(organization_id)) with check (app_private.is_org_admin(organization_id) and status in ('approved', 'rejected') and reviewed_by = (select auth.uid()) and reviewed_at is not null);
create policy "members read organizations" on public.organizations for select to authenticated using (app_private.is_org_member(id));
create policy members_or_platform_admins_read_companies on public.companies for select to authenticated using (
  exists (select 1 from public.organizations o where o.company_id = companies.id and app_private.is_org_member(o.id))
  or exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()))
);
create policy platform_admins_update_company_plans on public.companies for update to authenticated using (exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()))) with check (exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));
create policy "members manage customers" on public.customers for all to authenticated using (app_private.is_org_member(organization_id)) with check (app_private.is_org_member(organization_id));
create policy "members manage items" on public.item_masters for all to authenticated using (app_private.is_org_member(organization_id)) with check (app_private.is_org_member(organization_id));
create policy "members manage quote settings" on public.quote_number_settings for all to authenticated using (app_private.is_org_member(organization_id)) with check (app_private.is_org_member(organization_id));
create policy "members manage quotes" on public.quotes for all to authenticated using (app_private.is_org_member(organization_id)) with check (app_private.is_org_member(organization_id));
create policy "members manage invoices" on public.invoices for all to authenticated using (app_private.is_org_member(organization_id)) with check (app_private.is_org_member(organization_id));
create policy "members manage quote items" on public.quote_items for all to authenticated using (exists (select 1 from public.quotes q where q.id = quote_items.quote_id and app_private.is_org_member(q.organization_id))) with check (exists (select 1 from public.quotes q where q.id = quote_items.quote_id and app_private.is_org_member(q.organization_id)));
create policy "members manage quote notes" on public.quote_interaction_notes for all to authenticated using (exists (select 1 from public.quotes q where q.id = quote_interaction_notes.quote_id and app_private.is_org_member(q.organization_id))) with check (exists (select 1 from public.quotes q where q.id = quote_interaction_notes.quote_id and app_private.is_org_member(q.organization_id)));
create policy "members read activity logs" on public.activity_logs for select to authenticated using (app_private.is_org_member(organization_id));
create policy "members add activity logs" on public.activity_logs for insert to authenticated with check (app_private.is_org_member(organization_id) and ((select auth.uid()) = actor_id or actor_id is null));
