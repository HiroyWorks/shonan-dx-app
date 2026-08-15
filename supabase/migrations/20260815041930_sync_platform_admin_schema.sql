set lock_timeout = '5s';

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'companies_free_quote_limit_positive'
      and conrelid = 'public.companies'::regclass
  ) then
    alter table public.companies
      add constraint companies_free_quote_limit_positive
      check (free_quote_limit > 0);
  end if;
end $$;

drop policy if exists "members read companies" on public.companies;
drop policy if exists members_or_platform_admins_read_companies on public.companies;
create policy members_or_platform_admins_read_companies
  on public.companies
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organizations o
      where o.company_id = companies.id
        and app_private.is_org_member(o.id)
    )
    or exists (
      select 1
      from public.platform_admins pa
      where pa.user_id = (select auth.uid())
    )
  );

drop policy if exists platform_admins_update_company_plans on public.companies;
create policy platform_admins_update_company_plans
  on public.companies
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.platform_admins pa
      where pa.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.platform_admins pa
      where pa.user_id = (select auth.uid())
    )
  );

drop policy if exists platform_admins_read_self on public.platform_admins;
create policy platform_admins_read_self
  on public.platform_admins
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all privileges on table
  public.companies,
  public.platform_admins,
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
from anon, authenticated, service_role;

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
