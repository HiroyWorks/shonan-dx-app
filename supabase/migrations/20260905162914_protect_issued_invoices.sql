-- No historical amounts or issuer/tax data are inferred or rewritten.
set lock_timeout = '5s';
alter table public.quotes add column tax_rate numeric(5,2) check (tax_rate between 0 and 100);
alter table public.invoices add column snapshot jsonb;
alter table public.invoices drop constraint invoices_organization_quote_fkey,
  add constraint invoices_organization_quote_fkey foreign key (organization_id, quote_id)
  references public.quotes (organization_id, id) on delete restrict;

create or replace function app_private.calculate_quote_totals(p_lines jsonb, p_tax_rate numeric)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare sub numeric; taxable numeric; tax numeric;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'invalid quote lines' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) = 0 or p_tax_rate is null or p_tax_rate < 0 or p_tax_rate > 100
    or p_tax_rate <> round(p_tax_rate, 2) then
    raise exception 'invalid quote tax or lines' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) as x(unit_price numeric, quantity numeric, tax_kind text)
    where x.unit_price is null or x.unit_price < 0 or x.unit_price > 2147483647 or x.unit_price <> trunc(x.unit_price)
      or x.quantity is null or x.quantity <= 0 or x.quantity >= 10000000000 or x.quantity <> round(x.quantity, 2)
      or x.tax_kind is null or x.tax_kind not in ('taxable', 'exempt')) then
    raise exception 'invalid price, quantity or tax kind' using errcode = '22023';
  end if;
  select sum(round(x.unit_price * x.quantity)),
    coalesce(sum(round(x.unit_price * x.quantity)) filter (where x.tax_kind = 'taxable'), 0)
    into sub, taxable
    from jsonb_to_recordset(p_lines) as x(unit_price numeric, quantity numeric, tax_kind text);
  tax := round(taxable * p_tax_rate / 100);
  if sub + tax > 2147483647 then
    raise exception 'quote amount exceeds limit' using errcode = '22003';
  end if;
  return jsonb_build_object('sub', sub, 'taxable', taxable, 'tax', tax, 'total', sub + tax);
end;
$$;
revoke all on function app_private.calculate_quote_totals(jsonb, numeric) from public, anon;
grant execute on function app_private.calculate_quote_totals(jsonb, numeric) to authenticated, service_role;

create or replace function app_private.take_next_quote_number(target_organization_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare settings public.quote_number_settings%rowtype; sequence_value integer; candidate text;
begin
  if not app_private.is_org_member(target_organization_id) then
    raise exception 'organization membership is required' using errcode = '42501';
  end if;
  insert into public.quote_number_settings (organization_id, prefix, year, next_sequence, tax_rate)
    values (target_organization_id, 'Q', extract(year from current_date)::integer, 1, 10)
    on conflict (organization_id) do nothing;
  select * into settings from public.quote_number_settings where organization_id = target_organization_id for update;
  sequence_value := settings.next_sequence;
  loop
    candidate := settings.prefix || '-' || settings.year || '-' || lpad(sequence_value::text, greatest(3, length(sequence_value::text)), '0');
    exit when not exists (select 1 from public.quotes where organization_id = target_organization_id and quote_no = candidate);
    sequence_value := sequence_value + 1;
  end loop;
  update public.quote_number_settings set next_sequence = sequence_value + 1, updated_at = now() where organization_id = target_organization_id;
  return candidate;
end;
$$;

-- Private, persistent counter. Only the checked allocator can modify it.
create table app_private.invoice_number_counters (
  organization_id uuid not null references public.organizations(id),
  year integer not null,
  next_sequence bigint not null check (next_sequence > 0),
  primary key (organization_id, year)
);
alter table app_private.invoice_number_counters enable row level security;
revoke all on app_private.invoice_number_counters from public, anon, authenticated;

create or replace function app_private.take_next_invoice_number(target_organization_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare current_year integer := extract(year from current_date)::integer; next_value bigint;
begin
  if not app_private.is_org_admin(target_organization_id) then
    raise exception 'organization administrator permission is required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invoice-number:' || target_organization_id::text, 0));
  insert into app_private.invoice_number_counters (organization_id, year, next_sequence)
    select target_organization_id, current_year,
      coalesce(max((regexp_match(invoice_no, '^INV-' || current_year || '-([0-9]+)$'))[1]::bigint), 0) + 1
    from public.invoices where organization_id = target_organization_id
    on conflict (organization_id, year) do nothing;
  update app_private.invoice_number_counters set next_sequence = next_sequence + 1
    where organization_id = target_organization_id and year = current_year
    returning next_sequence - 1 into next_value;
  return 'INV-' || current_year || '-' || lpad(next_value::text, greatest(3, length(next_value::text)), '0');
end;
$$;

create or replace function public.save_quote(p_organization_id uuid, p_quote_id uuid, p_customer_id uuid, p_project text, p_memo text, p_lines jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare existing_quote public.quotes%rowtype; number_value text; rate numeric; amount_value integer; customer_name text; is_existing boolean;
begin
  if not app_private.is_org_member(p_organization_id) then
    raise exception 'organization membership is required' using errcode = '42501';
  end if;
  select name into customer_name from public.customers where id = p_customer_id and organization_id = p_organization_id;
  if customer_name is null then raise exception 'customer not found in organization' using errcode = '23503'; end if;
  select * into existing_quote from public.quotes where id = p_quote_id for update;
  is_existing := found;
  if is_existing and existing_quote.organization_id <> p_organization_id then
    raise exception 'quote belongs to another organization' using errcode = '42501';
  end if;
  if is_existing and (existing_quote.status = 'invoiced' or exists (select 1 from public.invoices where quote_id = p_quote_id)) then
    raise exception 'issued quote is immutable' using errcode = '55000';
  end if;
  select tax_rate into rate from public.quote_number_settings where organization_id = p_organization_id;
  -- Existing verified estimates keep their recorded tax rate, even if defaults change.
  rate := coalesce(existing_quote.tax_rate, rate, 10);
  amount_value := (app_private.calculate_quote_totals(p_lines, rate) ->> 'total')::integer;
  if exists (select 1 from jsonb_to_recordset(p_lines) as x(name text) where nullif(btrim(name), '') is null) then
    raise exception 'line name is required' using errcode = '22023';
  end if;
  if is_existing then
    number_value := existing_quote.quote_no;
    update public.quotes set customer_id = p_customer_id, project = coalesce(nullif(btrim(p_project), ''), '無題の案件'),
      memo = coalesce(p_memo, ''), amount = amount_value, tax_rate = rate, updated_at = now() where id = p_quote_id;
    delete from public.quote_items where quote_id = p_quote_id;
  else
    number_value := app_private.take_next_quote_number(p_organization_id);
    insert into public.quotes (id, organization_id, customer_id, quote_no, project, memo, amount, tax_rate, status, created_by)
      values (p_quote_id, p_organization_id, p_customer_id, number_value, coalesce(nullif(btrim(p_project), ''), '無題の案件'),
        coalesce(p_memo, ''), amount_value, rate, 'pending', (select auth.uid()));
  end if;
  insert into public.quote_items (id, quote_id, item_master_id, name, unit, unit_price, quantity, tax_kind, sort_order)
    select x.id, p_quote_id, x.item_master_id, btrim(x.name), coalesce(nullif(x.unit, ''), '式'), x.unit_price, x.quantity, x.tax_kind, x.sort_order
    from jsonb_to_recordset(p_lines) as x(id uuid, item_master_id uuid, name text, unit text, unit_price integer, quantity numeric, tax_kind public.tax_kind, sort_order integer);
  insert into public.activity_logs (organization_id, actor_id, kind, title, description)
    values (p_organization_id, (select auth.uid()), case when is_existing then 'quote-updated'::public.activity_kind else 'quote-created'::public.activity_kind end,
      number_value || case when is_existing then ' を更新' else ' を作成' end,
      customer_name || ' / ' || coalesce(p_project, '') || ' / ' || amount_value || '円');
  return p_quote_id;
end;
$$;

-- The UI supplies its displayed total. A concurrent settings change must not
-- silently save a different amount; raising here rolls back the whole RPC.
create or replace function public.save_quote_checked(p_organization_id uuid, p_quote_id uuid, p_customer_id uuid,
  p_project text, p_memo text, p_lines jsonb, p_expected_amount integer)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare saved_id uuid; saved_amount integer;
begin
  saved_id := public.save_quote(p_organization_id, p_quote_id, p_customer_id, p_project, p_memo, p_lines);
  select amount into saved_amount from public.quotes where id = saved_id;
  if p_expected_amount is null or saved_amount is distinct from p_expected_amount then
    raise exception 'quote total changed; refresh and review before saving' using errcode = '40001';
  end if;
  return saved_id;
end;
$$;
revoke all on function public.save_quote_checked(uuid, uuid, uuid, text, text, jsonb, integer) from public, anon;
grant execute on function public.save_quote_checked(uuid, uuid, uuid, text, text, jsonb, integer) to authenticated, service_role;

create or replace function app_private.guard_issued_quote()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare issued boolean;
begin
  if tg_op = 'INSERT' then
    if new.status = 'invoiced' then raise exception 'use create_invoice to issue an invoice' using errcode = '55000'; end if;
    return new;
  end if;
  issued := exists (select 1 from public.invoices where quote_id = old.id);
  if tg_op = 'DELETE' then
    if issued or old.status = 'invoiced' then raise exception 'issued quote cannot be deleted' using errcode = '55000'; end if;
    return old;
  end if;
  if new.id <> old.id or new.organization_id <> old.organization_id or (old.tax_rate is not null and new.tax_rate is null) then
    raise exception 'quote identity and verified tax cannot be reset' using errcode = '55000';
  end if;
  if (issued or old.status = 'invoiced') and (to_jsonb(new) - 'updated_at' - 'status') is distinct from (to_jsonb(old) - 'updated_at' - 'status') then
    raise exception 'issued quote is immutable' using errcode = '55000';
  end if;
  if (issued and new.status <> 'invoiced') or (not issued and new.status = 'invoiced' and old.status <> 'invoiced')
    or (old.status = 'invoiced' and new.status <> 'invoiced') then
    raise exception 'invoice status cannot be changed manually' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger quotes_guard_issued before insert or update or delete on public.quotes for each row execute function app_private.guard_issued_quote();

create or replace function app_private.guard_issued_quote_item()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare target_id uuid; target_status public.quote_status;
begin
  if tg_op = 'UPDATE' and new.quote_id <> old.quote_id then raise exception 'moving quote lines is forbidden' using errcode = '55000'; end if;
  if tg_op = 'DELETE' then target_id := old.quote_id; else target_id := new.quote_id; end if;
  -- Serialize line edits with invoice creation, including direct Data API writes.
  select status into target_status from public.quotes where id = target_id for update;
  if target_status = 'invoiced' or exists (select 1 from public.invoices where quote_id = target_id) then
    raise exception 'issued quote lines are immutable' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
create trigger quote_items_guard_issued before insert or update or delete on public.quote_items for each row execute function app_private.guard_issued_quote_item();

-- Check the final transaction state, since save_quote replaces all lines.
-- This also prevents a direct Data API update from forging the stored amount.
create or replace function app_private.check_quote_amount()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare target_id uuid; q public.quotes%rowtype; raw_lines jsonb; calculated jsonb;
begin
  if tg_table_name = 'quotes' then target_id := new.id;
  elsif tg_op = 'DELETE' then target_id := old.quote_id;
  else target_id := new.quote_id; end if;
  select * into q from public.quotes where id = target_id;
  if q.id is null or q.tax_rate is null then return null; end if;
  select jsonb_agg(to_jsonb(l)) into raw_lines from public.quote_items l where l.quote_id = target_id;
  calculated := app_private.calculate_quote_totals(raw_lines, q.tax_rate);
  if (calculated ->> 'total')::integer <> q.amount then
    raise exception 'quote amount does not match its lines' using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger quotes_check_amount after insert or update on public.quotes
  deferrable initially deferred for each row execute function app_private.check_quote_amount();
create constraint trigger quote_items_check_amount after insert or update or delete on public.quote_items
  deferrable initially deferred for each row execute function app_private.check_quote_amount();
revoke all on function app_private.check_quote_amount() from public, anon, authenticated;

create or replace function app_private.capture_invoice_snapshot()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare q public.quotes%rowtype; customer public.customers%rowtype; issuer record; raw_lines jsonb; snapshot_lines jsonb; calculated jsonb;
begin
  if not app_private.is_org_admin(new.organization_id) then
    raise exception 'organization administrator permission is required' using errcode = '42501';
  end if;
  select * into q from public.quotes where id = new.quote_id and organization_id = new.organization_id for update;
  if q.id is null then raise exception 'quote not found in organization' using errcode = '23503'; end if;
  if q.tax_rate is null then raise exception 'legacy quote requires tax and amount review before invoicing' using errcode = '55000'; end if;
  select * into customer from public.customers where id = q.customer_id;
  select c.name, c.invoice_registration_no, o.name as organization_name into issuer
    from public.organizations o join public.companies c on c.id = o.company_id where o.id = q.organization_id;
  select jsonb_agg(to_jsonb(l) order by l.sort_order, l.id),
    jsonb_agg(jsonb_build_object('name', l.name, 'unit', l.unit, 'unitPrice', l.unit_price, 'quantity', l.quantity,
      'taxKind', l.tax_kind, 'amount', round(l.unit_price * l.quantity)) order by l.sort_order, l.id)
    into raw_lines, snapshot_lines from public.quote_items l where quote_id = q.id;
  calculated := app_private.calculate_quote_totals(raw_lines, q.tax_rate);
  if (calculated ->> 'total')::integer <> q.amount then raise exception 'quote amount does not match its lines' using errcode = '23514'; end if;
  if nullif(btrim(issuer.name), '') is null or nullif(btrim(customer.name), '') is null then
    raise exception 'issuer and customer names are required' using errcode = '23514';
  end if;
  new.invoice_no := app_private.take_next_invoice_number(new.organization_id);
  new.created_at := now();
  new.amount := q.amount;
  new.snapshot := jsonb_build_object('version', 1, 'issuerName', issuer.name, 'issuerOrganization', issuer.organization_name,
    'registrationNo', issuer.invoice_registration_no, 'customerName', customer.name, 'customerAddress', customer.address,
    'project', q.project, 'memo', q.memo, 'quoteNo', q.quote_no, 'taxRate', q.tax_rate, 'lines', snapshot_lines, 'totals', calculated);
  return new;
end;
$$;
create trigger invoices_capture_snapshot before insert on public.invoices for each row execute function app_private.capture_invoice_snapshot();

create or replace function app_private.protect_invoice()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'issued invoices cannot be updated or deleted; retain the original' using errcode = '55000';
end;
$$;
create trigger invoices_protect_original before update or delete on public.invoices for each row execute function app_private.protect_invoice();

create or replace function app_private.mark_quote_invoiced()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  update public.quotes set status = 'invoiced', updated_at = now() where id = new.quote_id;
  return new;
end;
$$;
create trigger invoices_mark_quote after insert on public.invoices for each row execute function app_private.mark_quote_invoiced();

create or replace function public.create_invoice(p_quote_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare q public.quotes%rowtype; invoice_id uuid; number_value text;
begin
  select * into q from public.quotes where id = p_quote_id for update;
  if q.id is null then raise exception 'quote not found' using errcode = 'P0002'; end if;
  if not app_private.is_org_admin(q.organization_id) then raise exception 'organization administrator permission is required' using errcode = '42501'; end if;
  select id into invoice_id from public.invoices where quote_id = p_quote_id;
  if invoice_id is not null then return invoice_id; end if;
  insert into public.invoices (organization_id, quote_id, invoice_no, amount)
    values (q.organization_id, p_quote_id, '', q.amount) returning id, invoice_no into invoice_id, number_value;
  insert into public.activity_logs (organization_id, actor_id, kind, title, description)
    values (q.organization_id, (select auth.uid()), 'invoice-created', number_value || ' を作成', q.quote_no || ' / ' || q.amount || '円');
  return invoice_id;
end;
$$;

drop policy "members manage quotes" on public.quotes;
create policy "members read quotes" on public.quotes for select to authenticated using (app_private.is_org_member(organization_id));
create policy "members insert quotes" on public.quotes for insert to authenticated with check (app_private.is_org_member(organization_id));
create policy "members update quotes" on public.quotes for update to authenticated using (app_private.is_org_member(organization_id)) with check (app_private.is_org_member(organization_id));
create policy "admins delete quotes" on public.quotes for delete to authenticated using (app_private.is_org_admin(organization_id));
drop policy "members manage invoices" on public.invoices;
create policy "members read invoices" on public.invoices for select to authenticated using (app_private.is_org_member(organization_id));
create policy "admins insert invoices" on public.invoices for insert to authenticated with check (app_private.is_org_admin(organization_id));
revoke update, delete on public.invoices from authenticated;

-- The old importer deletes all data and cannot restore immutable snapshots safely.
-- Retain the endpoint with an explicit error until a validated restore workflow exists.
create or replace function public.import_organization_backup(p_organization_id uuid, p_data jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'backup restore is temporarily disabled to protect issued documents; use a reviewed database restore' using errcode = '55000';
end;
$$;

revoke all on function app_private.guard_issued_quote() from public, anon, authenticated;
revoke all on function app_private.guard_issued_quote_item() from public, anon, authenticated;
revoke all on function app_private.capture_invoice_snapshot() from public, anon, authenticated;
revoke all on function app_private.protect_invoice() from public, anon, authenticated;
revoke all on function app_private.mark_quote_invoiced() from public, anon, authenticated;
