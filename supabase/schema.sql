create extension if not exists pgcrypto;
create schema if not exists app_private;

create type public.user_role as enum ('admin', 'member');
create type public.quote_status as enum ('pending', 'won', 'invoiced');
create type public.plan_type as enum ('free', 'pro');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan public.plan_type not null default 'free',
  free_quote_limit integer not null default 20,
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
create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.user_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  contact text not null default '',
  email text not null default '',
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
revoke all on function app_private.is_org_member(uuid) from public;
revoke all on function app_private.is_org_admin(uuid) from public;
grant execute on function app_private.is_org_member(uuid) to authenticated;
grant execute on function app_private.is_org_admin(uuid) to authenticated;

alter table public.companies enable row level security;
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.customers enable row level security;
alter table public.item_masters enable row level security;
alter table public.quote_number_settings enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.quote_interaction_notes enable row level security;
alter table public.invoices enable row level security;

create policy "profiles read self" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles update self" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "members read memberships" on public.organization_memberships for select to authenticated using (app_private.is_org_member(organization_id));
create policy "admins manage memberships" on public.organization_memberships for all to authenticated using (app_private.is_org_admin(organization_id)) with check (app_private.is_org_admin(organization_id));
create policy "members read organizations" on public.organizations for select to authenticated using (app_private.is_org_member(id));
create policy "members read companies" on public.companies for select to authenticated using (exists (select 1 from public.organizations o where o.company_id = companies.id and app_private.is_org_member(o.id)));
create policy "members manage customers" on public.customers for all to authenticated using (app_private.is_org_member(organization_id)) with check (app_private.is_org_member(organization_id));
create policy "members manage items" on public.item_masters for all to authenticated using (app_private.is_org_member(organization_id)) with check (app_private.is_org_member(organization_id));
create policy "members manage quote settings" on public.quote_number_settings for all to authenticated using (app_private.is_org_member(organization_id)) with check (app_private.is_org_member(organization_id));
create policy "members manage quotes" on public.quotes for all to authenticated using (app_private.is_org_member(organization_id)) with check (app_private.is_org_member(organization_id));
create policy "members manage invoices" on public.invoices for all to authenticated using (app_private.is_org_member(organization_id)) with check (app_private.is_org_member(organization_id));
create policy "members manage quote items" on public.quote_items for all to authenticated using (exists (select 1 from public.quotes q where q.id = quote_items.quote_id and app_private.is_org_member(q.organization_id))) with check (exists (select 1 from public.quotes q where q.id = quote_items.quote_id and app_private.is_org_member(q.organization_id)));
create policy "members manage quote notes" on public.quote_interaction_notes for all to authenticated using (exists (select 1 from public.quotes q where q.id = quote_interaction_notes.quote_id and app_private.is_org_member(q.organization_id))) with check (exists (select 1 from public.quotes q where q.id = quote_interaction_notes.quote_id and app_private.is_org_member(q.organization_id)));
