-- Run this after the first Google login creates an auth.users row.
-- Replace the values below before executing in the Supabase SQL Editor.
do $$
declare
  v_admin_email text := 'hiroyukixxx1115@gmail.com';
  v_admin_display_name text := 'HIROY';
  v_company_name text := '湘南DX合同会社';
  v_organization_name text := '制作事業部';
  v_admin_user_id uuid;
  v_company_id uuid;
  v_organization_id uuid;
begin
  select id into v_admin_user_id
  from auth.users
  where email = v_admin_email
  order by created_at
  limit 1;

  if v_admin_user_id is null then
    raise exception 'No auth.users row found for %. Sign in with Google first, then rerun this script.', v_admin_email;
  end if;

  insert into public.profiles (id, display_name, email)
  values (v_admin_user_id, v_admin_display_name, v_admin_email)
  on conflict (id) do update
  set display_name = excluded.display_name,
      email = excluded.email;

  insert into public.platform_admins (user_id)
  values (v_admin_user_id)
  on conflict (user_id) do nothing;

  select id into v_company_id
  from public.companies
  where name = v_company_name
  order by created_at
  limit 1;

  if v_company_id is null then
    insert into public.companies (name, plan, free_quote_limit)
    values (v_company_name, 'free', 20)
    returning id into v_company_id;
  end if;

  select id into v_organization_id
  from public.organizations
  where company_id = v_company_id and name = v_organization_name
  order by created_at
  limit 1;

  if v_organization_id is null then
    insert into public.organizations (company_id, name)
    values (v_company_id, v_organization_name)
    returning id into v_organization_id;
  end if;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (v_organization_id, v_admin_user_id, 'admin')
  on conflict (organization_id, user_id) do update
  set role = 'admin';

  insert into public.quote_number_settings (organization_id, prefix, year, next_sequence, tax_rate)
  values (v_organization_id, 'Q', extract(year from current_date)::integer, 1, 10)
  on conflict (organization_id) do nothing;

  raise notice 'Initial workspace ready. company_id=%, organization_id=%, admin_user_id=%', v_company_id, v_organization_id, v_admin_user_id;
end $$;
