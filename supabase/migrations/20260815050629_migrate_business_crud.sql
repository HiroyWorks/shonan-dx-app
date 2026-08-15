alter table public.quote_interaction_notes
  add column author_display_name text not null default '';

alter table public.customers
  add constraint customers_organization_id_id_key unique (organization_id, id);

alter table public.quotes
  add constraint quotes_organization_id_id_key unique (organization_id, id),
  drop constraint quotes_customer_id_fkey,
  add constraint quotes_organization_customer_fkey
    foreign key (organization_id, customer_id)
    references public.customers (organization_id, id);

alter table public.invoices
  drop constraint invoices_quote_id_fkey,
  add constraint invoices_organization_quote_fkey
    foreign key (organization_id, quote_id)
    references public.quotes (organization_id, id)
    on delete cascade,
  add constraint invoices_quote_id_key unique (quote_id);

create or replace function app_private.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = target_organization_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function app_private.is_org_admin(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = target_organization_id
      and m.user_id = (select auth.uid())
      and m.role = 'admin'
  );
$$;

create or replace function app_private.take_next_quote_number(target_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.quote_number_settings%rowtype;
  sequence_value integer;
begin
  if not app_private.is_org_member(target_organization_id) then
    raise exception 'organization membership is required' using errcode = '42501';
  end if;

  insert into public.quote_number_settings (organization_id, prefix, year, next_sequence, tax_rate)
  values (target_organization_id, 'Q', extract(year from current_date)::integer, 1, 10)
  on conflict (organization_id) do nothing;

  select *
  into settings
  from public.quote_number_settings
  where organization_id = target_organization_id
  for update;

  sequence_value := settings.next_sequence;

  update public.quote_number_settings
  set next_sequence = next_sequence + 1,
      updated_at = now()
  where organization_id = target_organization_id;

  return settings.prefix || '-' || settings.year || '-' || lpad(sequence_value::text, 3, '0');
end;
$$;

create or replace function app_private.take_next_invoice_number(target_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_year integer := extract(year from current_date)::integer;
  next_value integer;
begin
  if not app_private.is_org_member(target_organization_id) then
    raise exception 'organization membership is required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('invoice-number:' || target_organization_id::text, 0)
  );

  select coalesce(max((regexp_match(invoice_no, '^INV-' || current_year || '-([0-9]+)$'))[1]::integer), 0) + 1
  into next_value
  from public.invoices
  where organization_id = target_organization_id;

  return 'INV-' || current_year || '-' || lpad(next_value::text, 3, '0');
end;
$$;

create or replace function app_private.set_company_invoice_registration(
  target_organization_id uuid,
  registration_no text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.is_org_admin(target_organization_id) then
    raise exception 'organization administrator permission is required' using errcode = '42501';
  end if;

  update public.companies c
  set invoice_registration_no = coalesce(registration_no, '')
  from public.organizations o
  where o.id = target_organization_id
    and c.id = o.company_id;
end;
$$;

create or replace function app_private.set_company_plan(
  target_company_id uuid,
  target_plan public.plan_type
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = (select auth.uid())
  ) then
    raise exception 'platform administrator permission is required' using errcode = '42501';
  end if;

  update public.companies
  set plan = target_plan
  where id = target_company_id;

  if not found then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function app_private.validate_quote_item_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.item_master_id is not null and not exists (
    select 1
    from public.quotes q
    join public.item_masters i on i.id = new.item_master_id
    where q.id = new.quote_id
      and q.organization_id = i.organization_id
  ) then
    raise exception 'quote item must use an item master from the same organization' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger quote_items_validate_organization
before insert or update of quote_id, item_master_id
on public.quote_items
for each row execute function app_private.validate_quote_item_organization();

create or replace function app_private.enforce_free_quote_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_plan public.plan_type;
  quote_limit integer;
  quote_count integer;
begin
  perform 1
  from public.organizations o
  where o.id = new.organization_id
  for update;

  select c.plan, c.free_quote_limit
  into company_plan, quote_limit
  from public.organizations o
  join public.companies c on c.id = o.company_id
  where o.id = new.organization_id;

  if company_plan = 'free' then
    select count(*) into quote_count
    from public.quotes q
    where q.organization_id = new.organization_id;

    if quote_count >= quote_limit then
      raise exception 'free plan quote limit reached' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger quotes_enforce_free_limit
before insert on public.quotes
for each row execute function app_private.enforce_free_quote_limit();

create or replace function public.save_quote(
  p_organization_id uuid,
  p_quote_id uuid,
  p_customer_id uuid,
  p_project text,
  p_memo text,
  p_lines jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing_quote public.quotes%rowtype;
  generated_quote_no text;
  calculated_amount integer;
  tax_rate_value numeric(5,2);
  customer_name_value text;
begin
  if not app_private.is_org_member(p_organization_id) then
    raise exception 'organization membership is required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'at least one quote line is required' using errcode = '22023';
  end if;

  select c.name
  into customer_name_value
  from public.customers c
  where c.id = p_customer_id
    and c.organization_id = p_organization_id;
  if customer_name_value is null then
    raise exception 'customer not found in organization' using errcode = '23503';
  end if;

  select coalesce(s.tax_rate, 10)
  into tax_rate_value
  from public.quote_number_settings s
  where s.organization_id = p_organization_id;
  tax_rate_value := coalesce(tax_rate_value, 10);

  select round(
    coalesce(sum(x.unit_price * x.quantity), 0)
    + coalesce(sum(x.unit_price * x.quantity) filter (where x.tax_kind = 'taxable'), 0) * tax_rate_value / 100
  )::integer
  into calculated_amount
  from jsonb_to_recordset(p_lines) as x(
    unit_price integer,
    quantity numeric,
    tax_kind public.tax_kind
  );

  select *
  into existing_quote
  from public.quotes
  where id = p_quote_id
  for update;

  if found then
    if existing_quote.organization_id <> p_organization_id then
      raise exception 'quote belongs to another organization' using errcode = '42501';
    end if;

    update public.quotes
    set customer_id = p_customer_id,
        project = coalesce(nullif(btrim(p_project), ''), '無題の案件'),
        memo = coalesce(p_memo, ''),
        amount = calculated_amount,
        updated_at = now()
    where id = p_quote_id;

    delete from public.quote_items where quote_id = p_quote_id;

    insert into public.activity_logs (organization_id, actor_id, kind, title, description)
    values (
      p_organization_id,
      (select auth.uid()),
      'quote-updated',
      existing_quote.quote_no || ' を更新',
      customer_name_value || ' / ' || coalesce(nullif(btrim(p_project), ''), '無題の案件') || ' / ' || calculated_amount || '円'
    );
  else
    generated_quote_no := app_private.take_next_quote_number(p_organization_id);

    insert into public.quotes (
      id, organization_id, customer_id, quote_no, project, memo, amount, status, created_by
    ) values (
      p_quote_id,
      p_organization_id,
      p_customer_id,
      generated_quote_no,
      coalesce(nullif(btrim(p_project), ''), '無題の案件'),
      coalesce(p_memo, ''),
      calculated_amount,
      'pending',
      (select auth.uid())
    );

    insert into public.activity_logs (organization_id, actor_id, kind, title, description)
    values (
      p_organization_id,
      (select auth.uid()),
      'quote-created',
      generated_quote_no || ' を作成',
      customer_name_value || ' / ' || coalesce(nullif(btrim(p_project), ''), '無題の案件') || ' / ' || calculated_amount || '円'
    );
  end if;

  insert into public.quote_items (
    id, quote_id, item_master_id, name, unit, unit_price, quantity, tax_kind, sort_order
  )
  select
    x.id,
    p_quote_id,
    x.item_master_id,
    x.name,
    coalesce(nullif(x.unit, ''), '式'),
    x.unit_price,
    x.quantity,
    x.tax_kind,
    x.sort_order
  from jsonb_to_recordset(p_lines) as x(
    id uuid,
    item_master_id uuid,
    name text,
    unit text,
    unit_price integer,
    quantity numeric,
    tax_kind public.tax_kind,
    sort_order integer
  );

  return p_quote_id;
end;
$$;

create or replace function public.update_quote_status(
  p_quote_id uuid,
  p_status public.quote_status
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_quote record;
begin
  select q.id, q.organization_id, q.quote_no, q.project, q.status, c.name as customer_name
  into target_quote
  from public.quotes q
  join public.customers c on c.id = q.customer_id
  where q.id = p_quote_id
  for update of q;

  if target_quote.id is null then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if target_quote.status = p_status then
    return;
  end if;

  update public.quotes
  set status = p_status,
      updated_at = now()
  where id = p_quote_id;

  insert into public.activity_logs (organization_id, actor_id, kind, title, description)
  values (
    target_quote.organization_id,
    (select auth.uid()),
    'status-updated',
    target_quote.quote_no || ' のステータスを変更',
    target_quote.customer_name || ' / ' || target_quote.project || ' / ' || p_status::text
  );
end;
$$;

create or replace function public.add_quote_note(p_quote_id uuid, p_body text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_quote record;
  display_name_value text;
  note_id uuid := gen_random_uuid();
begin
  if nullif(btrim(p_body), '') is null then
    raise exception 'note body is required' using errcode = '22023';
  end if;

  select q.organization_id, q.quote_no
  into target_quote
  from public.quotes q
  where q.id = p_quote_id
  for update;
  if target_quote.organization_id is null then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;

  select p.display_name
  into display_name_value
  from public.profiles p
  where p.id = (select auth.uid());

  insert into public.quote_interaction_notes (
    id, quote_id, author_id, author_display_name, body
  ) values (
    note_id, p_quote_id, (select auth.uid()), coalesce(display_name_value, ''), btrim(p_body)
  );

  update public.quotes set updated_at = now() where id = p_quote_id;

  insert into public.activity_logs (organization_id, actor_id, kind, title, description)
  values (
    target_quote.organization_id,
    (select auth.uid()),
    'memo-added',
    target_quote.quote_no || ' にメモを追加',
    btrim(p_body)
  );

  return note_id;
end;
$$;

create or replace function public.create_invoice(p_quote_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_quote record;
  existing_invoice_id uuid;
  invoice_id uuid := gen_random_uuid();
  generated_invoice_no text;
begin
  select q.id, q.organization_id, q.quote_no, q.amount, q.project, c.name as customer_name
  into target_quote
  from public.quotes q
  join public.customers c on c.id = q.customer_id
  where q.id = p_quote_id
  for update of q;
  if target_quote.id is null then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;

  select i.id into existing_invoice_id
  from public.invoices i
  where i.quote_id = p_quote_id;
  if existing_invoice_id is not null then
    return existing_invoice_id;
  end if;

  generated_invoice_no := app_private.take_next_invoice_number(target_quote.organization_id);

  insert into public.invoices (id, organization_id, quote_id, invoice_no, amount)
  values (invoice_id, target_quote.organization_id, p_quote_id, generated_invoice_no, target_quote.amount);

  update public.quotes
  set status = 'invoiced',
      updated_at = now()
  where id = p_quote_id;

  insert into public.activity_logs (organization_id, actor_id, kind, title, description)
  values (
    target_quote.organization_id,
    (select auth.uid()),
    'invoice-created',
    generated_invoice_no || ' を作成',
    target_quote.quote_no || ' / ' || target_quote.customer_name || ' / ' || target_quote.amount || '円'
  );

  return invoice_id;
end;
$$;

create or replace function public.save_workspace_settings(
  p_organization_id uuid,
  p_prefix text,
  p_year integer,
  p_next_sequence integer,
  p_tax_rate numeric,
  p_invoice_registration_no text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not app_private.is_org_admin(p_organization_id) then
    raise exception 'organization administrator permission is required' using errcode = '42501';
  end if;
  if nullif(btrim(p_prefix), '') is null or p_next_sequence < 1 or p_tax_rate < 0 then
    raise exception 'invalid workspace settings' using errcode = '22023';
  end if;

  insert into public.quote_number_settings (
    organization_id, prefix, year, next_sequence, tax_rate, updated_at
  ) values (
    p_organization_id, btrim(p_prefix), p_year, p_next_sequence, p_tax_rate, now()
  )
  on conflict (organization_id) do update
  set prefix = excluded.prefix,
      year = excluded.year,
      next_sequence = excluded.next_sequence,
      tax_rate = excluded.tax_rate,
      updated_at = now();

  perform app_private.set_company_invoice_registration(
    p_organization_id,
    coalesce(p_invoice_registration_no, '')
  );
end;
$$;

create or replace function public.update_company_plan(
  p_company_id uuid,
  p_plan public.plan_type
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app_private.set_company_plan(p_company_id, p_plan);
$$;

create or replace function public.import_organization_backup(
  p_organization_id uuid,
  p_data jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not app_private.is_org_admin(p_organization_id) then
    raise exception 'organization administrator permission is required' using errcode = '42501';
  end if;

  delete from public.activity_logs where organization_id = p_organization_id;
  delete from public.invoices where organization_id = p_organization_id;
  delete from public.quotes where organization_id = p_organization_id;
  delete from public.item_masters where organization_id = p_organization_id;
  delete from public.customers where organization_id = p_organization_id;

  insert into public.quote_number_settings (
    organization_id, prefix, year, next_sequence, tax_rate, updated_at
  )
  select
    p_organization_id,
    coalesce(nullif(x.prefix, ''), 'Q'),
    x.year,
    greatest(x.next_sequence, 1),
    greatest(x.tax_rate, 0),
    now()
  from jsonb_to_record(p_data -> 'settings') as x(
    prefix text,
    year integer,
    next_sequence integer,
    tax_rate numeric,
    invoice_registration_no text
  )
  on conflict (organization_id) do update
  set prefix = excluded.prefix,
      year = excluded.year,
      next_sequence = excluded.next_sequence,
      tax_rate = excluded.tax_rate,
      updated_at = now();

  perform app_private.set_company_invoice_registration(
    p_organization_id,
    coalesce(p_data -> 'settings' ->> 'invoice_registration_no', '')
  );

  insert into public.customers (
    id, organization_id, name, address, phone, contact, contact_title, email,
    invoice_registration_no, memo, created_at, updated_at
  )
  select
    x.id, p_organization_id, x.name, coalesce(x.address, ''), coalesce(x.phone, ''),
    coalesce(x.contact, ''), coalesce(x.contact_title, ''), coalesce(x.email, ''),
    coalesce(x.invoice_registration_no, ''), coalesce(x.memo, ''),
    coalesce(x.created_at, now()), coalesce(x.updated_at, now())
  from jsonb_to_recordset(coalesce(p_data -> 'customers', '[]'::jsonb)) as x(
    id uuid, name text, address text, phone text, contact text, contact_title text,
    email text, invoice_registration_no text, memo text, created_at timestamptz, updated_at timestamptz
  );

  insert into public.item_masters (
    id, organization_id, name, category, unit_price, unit, tax_kind, created_at, updated_at
  )
  select
    x.id, p_organization_id, x.name, coalesce(x.category, ''), x.unit_price,
    coalesce(nullif(x.unit, ''), '式'), x.tax_kind,
    coalesce(x.created_at, now()), coalesce(x.updated_at, now())
  from jsonb_to_recordset(coalesce(p_data -> 'items', '[]'::jsonb)) as x(
    id uuid, name text, category text, unit_price integer, unit text,
    tax_kind public.tax_kind, created_at timestamptz, updated_at timestamptz
  );

  insert into public.quotes (
    id, organization_id, customer_id, quote_no, project, memo, amount, status,
    created_by, created_at, updated_at
  )
  select
    x.id, p_organization_id, x.customer_id, x.quote_no, x.project,
    coalesce(x.memo, ''), x.amount, x.status, null,
    coalesce(x.created_at, now()), coalesce(x.updated_at, now())
  from jsonb_to_recordset(coalesce(p_data -> 'quotes', '[]'::jsonb)) as x(
    id uuid, customer_id uuid, quote_no text, project text, memo text,
    amount integer, status public.quote_status, created_at timestamptz, updated_at timestamptz
  );

  insert into public.quote_items (
    id, quote_id, item_master_id, name, unit, unit_price, quantity, tax_kind, sort_order
  )
  select
    x.id, x.quote_id, x.item_master_id, x.name, coalesce(nullif(x.unit, ''), '式'),
    x.unit_price, x.quantity, x.tax_kind, x.sort_order
  from jsonb_to_recordset(coalesce(p_data -> 'quote_items', '[]'::jsonb)) as x(
    id uuid, quote_id uuid, item_master_id uuid, name text, unit text,
    unit_price integer, quantity numeric, tax_kind public.tax_kind, sort_order integer
  );

  insert into public.quote_interaction_notes (
    id, quote_id, author_id, author_display_name, body, created_at
  )
  select
    x.id, x.quote_id, null, coalesce(x.author_display_name, ''), x.body,
    coalesce(x.created_at, now())
  from jsonb_to_recordset(coalesce(p_data -> 'notes', '[]'::jsonb)) as x(
    id uuid, quote_id uuid, author_display_name text, body text, created_at timestamptz
  );

  insert into public.invoices (
    id, organization_id, quote_id, invoice_no, amount, created_at
  )
  select
    x.id, p_organization_id, x.quote_id, x.invoice_no, x.amount,
    coalesce(x.created_at, now())
  from jsonb_to_recordset(coalesce(p_data -> 'invoices', '[]'::jsonb)) as x(
    id uuid, quote_id uuid, invoice_no text, amount integer, created_at timestamptz
  );

  insert into public.activity_logs (
    id, organization_id, actor_id, kind, title, description, created_at
  )
  select
    x.id, p_organization_id, null, x.kind, x.title, coalesce(x.description, ''),
    coalesce(x.created_at, now())
  from jsonb_to_recordset(coalesce(p_data -> 'activities', '[]'::jsonb)) as x(
    id uuid, kind public.activity_kind, title text, description text, created_at timestamptz
  );
end;
$$;

drop policy "members manage quote settings" on public.quote_number_settings;
create policy "members read quote settings"
on public.quote_number_settings
for select to authenticated
using (app_private.is_org_member(organization_id));
create policy "admins manage quote settings"
on public.quote_number_settings
for all to authenticated
using (app_private.is_org_admin(organization_id))
with check (app_private.is_org_admin(organization_id));

drop policy platform_admins_update_company_plans on public.companies;
revoke update on table public.companies from authenticated;

revoke all on function app_private.take_next_quote_number(uuid) from public;
revoke all on function app_private.take_next_invoice_number(uuid) from public;
revoke all on function app_private.set_company_invoice_registration(uuid, text) from public;
revoke all on function app_private.set_company_plan(uuid, public.plan_type) from public;
revoke all on function app_private.validate_quote_item_organization() from public;
revoke all on function app_private.enforce_free_quote_limit() from public;
grant execute on function app_private.take_next_quote_number(uuid) to authenticated, service_role;
grant execute on function app_private.take_next_invoice_number(uuid) to authenticated, service_role;
grant execute on function app_private.set_company_invoice_registration(uuid, text) to authenticated, service_role;
grant execute on function app_private.set_company_plan(uuid, public.plan_type) to authenticated, service_role;

revoke all on function public.save_quote(uuid, uuid, uuid, text, text, jsonb) from public, anon;
revoke all on function public.update_quote_status(uuid, public.quote_status) from public, anon;
revoke all on function public.add_quote_note(uuid, text) from public, anon;
revoke all on function public.create_invoice(uuid) from public, anon;
revoke all on function public.save_workspace_settings(uuid, text, integer, integer, numeric, text) from public, anon;
revoke all on function public.update_company_plan(uuid, public.plan_type) from public, anon;
revoke all on function public.import_organization_backup(uuid, jsonb) from public, anon;
grant execute on function public.save_quote(uuid, uuid, uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.update_quote_status(uuid, public.quote_status) to authenticated, service_role;
grant execute on function public.add_quote_note(uuid, text) to authenticated, service_role;
grant execute on function public.create_invoice(uuid) to authenticated, service_role;
grant execute on function public.save_workspace_settings(uuid, text, integer, integer, numeric, text) to authenticated, service_role;
grant execute on function public.update_company_plan(uuid, public.plan_type) to authenticated, service_role;
grant execute on function public.import_organization_backup(uuid, jsonb) to authenticated, service_role;
