-- Additive workflow migration. Issued financial data remains immutable.
set lock_timeout = '5s';

create function app_private.business_today() returns date language sql stable security invoker set search_path='' as $$ select (now() at time zone 'Asia/Tokyo')::date $$;
revoke all on function app_private.business_today() from public,anon;
grant execute on function app_private.business_today() to authenticated,service_role;

alter table public.invoices add column due_date date,
  add column bank_details text not null default '' check (length(bank_details) <= 2000);

create table public.billing_settings (
  organization_id uuid primary key references public.organizations(id),
  bank_details text not null default '' check (length(bank_details) <= 2000),
  payment_days integer not null default 30 check (payment_days between 0 and 365),
  updated_at timestamptz not null default now()
);
create table public.quote_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references public.profiles(id),
  title text not null check (length(title) between 1 and 200),
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 262144),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quote_drafts_org_user_idx on public.quote_drafts (organization_id, user_id);
create index quote_drafts_user_idx on public.quote_drafts (user_id);
create table public.quote_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  -- No cascading quote FK: history must survive deletion of an unissued quote.
  quote_id uuid not null,
  revision integer not null check (revision > 0),
  content jsonb not null,
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now(),
  unique (quote_id, revision)
);
create index quote_revisions_org_idx on public.quote_revisions (organization_id);
create index quote_revisions_actor_idx on public.quote_revisions (recorded_by);
-- Only a cutover baseline is recorded; this is not a claim about earlier versions.
insert into public.quote_revisions(organization_id,quote_id,revision,content)
  select q.organization_id,q.id,1,jsonb_build_object('baseline',true,'quote',to_jsonb(q)-'updated_at',
    'customer',(select to_jsonb(c) from public.customers c where c.id=q.customer_id),
    'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.sort_order,l.id) from public.quote_items l where l.quote_id=q.id),'[]'::jsonb))
  from public.quotes q;
create table public.invoice_payments (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  invoice_id uuid not null references public.invoices(id),
  amount integer not null check (amount <> 0),
  paid_on date not null,
  reference text not null default '' check (length(reference) <= 1000),
  reverses_id uuid unique references public.invoice_payments(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((amount > 0 and reverses_id is null) or (amount < 0 and reverses_id is not null))
);
create index invoice_payments_org_idx on public.invoice_payments (organization_id);
create index invoice_payments_invoice_idx on public.invoice_payments (invoice_id);
create index invoice_payments_actor_idx on public.invoice_payments (created_by);
create table public.invoice_cancellations (
  invoice_id uuid primary key references public.invoices(id),
  organization_id uuid not null references public.organizations(id),
  replacement_invoice_id uuid unique references public.invoices(id),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (replacement_invoice_id is distinct from invoice_id)
);
create index invoice_cancellations_org_idx on public.invoice_cancellations (organization_id);
create index invoice_cancellations_actor_idx on public.invoice_cancellations (created_by);
create table public.invoice_documents (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  invoice_id uuid not null unique references public.invoices(id),
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check (byte_size between 5 and 10485760),
  original_name text not null check (length(original_name) between 1 and 255),
  source text not null check (source in ('issued_pdf', 'legacy_original')),
  verification_note text not null check (length(btrim(verification_note)) between 1 and 2000),
  verified_by uuid not null references public.profiles(id),
  verified_at timestamptz not null default now()
);
create index invoice_documents_org_idx on public.invoice_documents (organization_id);
create index invoice_documents_actor_idx on public.invoice_documents (verified_by);
create table public.invoice_deliveries (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  invoice_id uuid not null references public.invoices(id),
  document_id uuid not null references public.invoice_documents(id),
  recipient text not null check (length(recipient) <= 254 and recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  subject text not null check (length(subject) between 1 and 200 and subject !~ '[\r\n]'),
  body text not null check (length(body) between 1 and 10000),
  status text not null default 'pending' check (status in ('pending', 'sending', 'accepted', 'failed', 'unknown')),
  provider_id text,
  error_message text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  attempted_at timestamptz,
  completed_at timestamptz
);
create index invoice_deliveries_org_created_idx on public.invoice_deliveries (organization_id, created_at);
create index invoice_deliveries_invoice_idx on public.invoice_deliveries (invoice_id);
create index invoice_deliveries_document_idx on public.invoice_deliveries (document_id);
create index invoice_deliveries_actor_idx on public.invoice_deliveries (created_by);
create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  email text not null check (email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  expires_at timestamptz not null default now() + interval '7 days',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (organization_id, email)
);
create index organization_invitations_actor_idx on public.organization_invitations (created_by);

-- Explicit Data API grants and tenant policies. Ledger/archive writes are RPC-only.
do $$ declare t text; begin
  foreach t in array array['billing_settings','quote_drafts','quote_revisions','invoice_payments','invoice_cancellations','invoice_documents','invoice_deliveries','organization_invitations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if t not in ('quote_drafts','organization_invitations') then
      execute format('create policy tenant_read on public.%I for select to authenticated using (app_private.is_org_member(organization_id))', t);
    end if;
  end loop;
end $$;
create policy owner_read on public.quote_drafts for select to authenticated
  using (user_id = (select auth.uid()) and app_private.is_org_member(organization_id));
create policy admin_read on public.organization_invitations for select to authenticated using (app_private.is_org_admin(organization_id));
grant insert, update on public.billing_settings to authenticated;
create policy admin_insert on public.billing_settings for insert to authenticated with check (app_private.is_org_admin(organization_id));
create policy admin_update on public.billing_settings for update to authenticated using (app_private.is_org_admin(organization_id)) with check (app_private.is_org_admin(organization_id));

-- Customer/item editing is a member capability. Deletion is admin-only in UI and DB.
drop policy "members manage customers" on public.customers;
drop policy "members manage items" on public.item_masters;
do $$ declare t text; begin foreach t in array array['customers','item_masters'] loop
  execute format('create policy member_read on public.%I for select to authenticated using (app_private.is_org_member(organization_id))', t);
  execute format('create policy member_insert on public.%I for insert to authenticated with check (app_private.is_org_member(organization_id))', t);
  execute format('create policy member_update on public.%I for update to authenticated using (app_private.is_org_member(organization_id)) with check (app_private.is_org_member(organization_id))', t);
  execute format('create policy admin_delete on public.%I for delete to authenticated using (app_private.is_org_admin(organization_id))', t);
end loop; end $$;

create function app_private.save_draft(p_org uuid, p_id uuid, p_title text, p_content jsonb, p_version integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.quote_drafts%rowtype;
begin
  if auth.uid() is null or not app_private.is_org_member(p_org) then raise exception 'organization membership is required' using errcode = '42501'; end if;
  if jsonb_typeof(p_content->'customerId') is distinct from 'string' or jsonb_typeof(p_content->'project') is distinct from 'string'
    or jsonb_typeof(p_content->'memo') is distinct from 'string' or jsonb_typeof(p_content->'lines') is distinct from 'array' then
    raise exception 'invalid draft content' using errcode='22023';
  end if;
  if jsonb_array_length(p_content->'lines')>500 or exists(select 1 from jsonb_array_elements(p_content->'lines') l
    where jsonb_typeof(l->'id') is distinct from 'string' or jsonb_typeof(l->'itemId') is distinct from 'string'
      or jsonb_typeof(l->'name') is distinct from 'string' or jsonb_typeof(l->'unit') is distinct from 'string'
      or jsonb_typeof(l->'unitPrice') is distinct from 'number' or jsonb_typeof(l->'quantity') is distinct from 'number'
      or (l->>'taxKind') is null or (l->>'taxKind') not in ('taxable','exempt')) then raise exception 'invalid draft lines' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_content->'lines') l where (l->>'unitPrice')::numeric<0 or (l->>'unitPrice')::numeric>2147483647
    or (l->>'unitPrice')::numeric<>trunc((l->>'unitPrice')::numeric) or (l->>'quantity')::numeric<=0 or (l->>'quantity')::numeric>=10000000000
    or (l->>'quantity')::numeric<>round((l->>'quantity')::numeric,2)) then raise exception 'invalid draft price or quantity' using errcode='22023'; end if;
  select * into d from public.quote_drafts where id = p_id for update;
  if found then
    if d.organization_id <> p_org or d.user_id <> auth.uid() then raise exception 'draft access denied' using errcode = '42501'; end if;
    if d.version is distinct from p_version then raise exception 'draft changed; reload before saving' using errcode = '40001'; end if;
    update public.quote_drafts set title = btrim(p_title), content = p_content, version = version + 1, updated_at = now() where id = p_id;
  else
    if p_version is distinct from 0 then raise exception 'draft no longer exists' using errcode = '40001'; end if;
    insert into public.quote_drafts(id, organization_id, user_id, title, content) values (p_id, p_org, auth.uid(), btrim(p_title), p_content);
  end if;
  return p_id;
end $$;
create function public.save_quote_draft(p_org uuid, p_id uuid, p_title text, p_content jsonb, p_version integer)
returns uuid language sql security invoker set search_path = '' as $$ select app_private.save_draft(p_org,p_id,p_title,p_content,p_version) $$;
grant delete on public.quote_drafts to authenticated;
create policy owner_delete on public.quote_drafts for delete to authenticated using (user_id = (select auth.uid()) and app_private.is_org_member(organization_id));

-- Deferred snapshots capture the FINAL transaction state, including direct API edits.
create function app_private.record_quote_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid; q public.quotes%rowtype; payload jsonb; previous jsonb; n integer;
begin
  if tg_table_name = 'quotes' then target := new.id;
  elsif tg_op = 'DELETE' then target := old.quote_id; else target := new.quote_id; end if;
  select * into q from public.quotes where id = target for update;
  if not found then return null; end if;
  if auth.uid() is null or not app_private.is_org_member(q.organization_id) then raise exception 'revision requires organization membership' using errcode = '42501'; end if;
  select jsonb_build_object('quote', to_jsonb(q) - 'updated_at',
    'customer', (select to_jsonb(c) from public.customers c where c.id = q.customer_id),
    'lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.sort_order,l.id) from public.quote_items l where l.quote_id = target), '[]'::jsonb)) into payload;
  select revision, content into n, previous from public.quote_revisions where quote_id = target order by revision desc limit 1;
  if previous is distinct from payload then
    insert into public.quote_revisions(organization_id,quote_id,revision,content,recorded_by)
      values(q.organization_id,target,coalesce(n,0)+1,payload,auth.uid());
  end if;
  return null;
end $$;
create constraint trigger quotes_record_revision after insert or update on public.quotes deferrable initially deferred for each row execute function app_private.record_quote_revision();
create constraint trigger lines_record_revision after insert or update or delete on public.quote_items deferrable initially deferred for each row execute function app_private.record_quote_revision();

create function public.save_quote_versioned(p_organization_id uuid,p_quote_id uuid,p_customer_id uuid,p_project text,p_memo text,p_lines jsonb,p_expected_amount integer,p_expected_revision integer)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare current_revision integer;
begin
  perform 1 from public.quotes where id = p_quote_id for update;
  select coalesce(max(revision),0) into current_revision from public.quote_revisions where quote_id = p_quote_id;
  if current_revision is distinct from p_expected_revision then raise exception 'quote revision changed; reload before saving' using errcode = '40001'; end if;
  return public.save_quote_checked(p_organization_id,p_quote_id,p_customer_id,p_project,p_memo,p_lines,p_expected_amount);
end $$;

create function public.issue_invoice(p_quote_id uuid,p_due_date date,p_bank_details text,p_expected_amount integer,p_expected_revision integer)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare q public.quotes%rowtype; result uuid;
begin
  select * into q from public.quotes where id = p_quote_id for update;
  if q.id is null or not app_private.is_org_admin(q.organization_id) then raise exception 'administrator permission is required' using errcode = '42501'; end if;
  select id into result from public.invoices where quote_id = p_quote_id;
  if result is not null then
    if not exists(select 1 from public.invoices where id=result and due_date=p_due_date and bank_details=p_bank_details and amount=p_expected_amount) then raise exception 'invoice already issued with different conditions' using errcode='40001'; end if;
    return result;
  end if;
  if q.amount is distinct from p_expected_amount or (select coalesce(max(revision),0) from public.quote_revisions where quote_id=q.id) is distinct from p_expected_revision then
    raise exception 'quote revision or amount changed before invoicing; reload and review' using errcode='40001';
  end if;
  if p_due_date is null or p_due_date < app_private.business_today() then raise exception 'payment due date must not be in the past' using errcode = '22023'; end if;
  if nullif(btrim(p_bank_details),'') is null then raise exception 'bank details are required' using errcode = '22023'; end if;
  insert into public.invoices(organization_id,quote_id,invoice_no,amount,due_date,bank_details)
    values(q.organization_id,q.id,'',q.amount,p_due_date,p_bank_details) returning id into result;
  insert into public.activity_logs(organization_id,actor_id,kind,title,description)
    values(q.organization_id,auth.uid(),'invoice-created','請求書を発行',q.quote_no);
  return result;
end $$;

create function app_private.record_payment(p_invoice uuid,p_id uuid,p_amount integer,p_paid_on date,p_reference text,p_reverse uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.invoices%rowtype; original public.invoice_payments%rowtype; existing public.invoice_payments%rowtype; paid bigint; value integer;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if auth.uid() is null or i.id is null or not app_private.is_org_admin(i.organization_id) then raise exception 'administrator permission is required' using errcode = '42501'; end if;
  select * into existing from public.invoice_payments where id = p_id;
  if found then
    if existing.invoice_id <> p_invoice or existing.reverses_id is distinct from p_reverse or existing.paid_on is distinct from p_paid_on
      or existing.reference is distinct from p_reference or (p_reverse is null and existing.amount is distinct from p_amount) then
      raise exception 'payment id already used for different input' using errcode = '22023';
    end if;
    return p_id;
  end if;
  if p_paid_on is null or p_paid_on > app_private.business_today() then raise exception 'payment date cannot be in the future' using errcode = '22023'; end if;
  if exists(select 1 from public.invoice_cancellations where invoice_id = p_invoice) then raise exception 'invoice is canceled' using errcode = '55000'; end if;
  select coalesce(sum(amount),0) into paid from public.invoice_payments where invoice_id = p_invoice;
  if p_reverse is not null then
    select * into original from public.invoice_payments where id = p_reverse and invoice_id = p_invoice and amount > 0;
    if original.id is null or exists(select 1 from public.invoice_payments where reverses_id = p_reverse) then raise exception 'payment is not reversible' using errcode = '55000'; end if;
    if nullif(btrim(p_reference),'') is null then raise exception 'reversal reason is required' using errcode = '22023'; end if;
    value := -original.amount;
  else
    if p_amount is null or p_amount <= 0 or paid + p_amount > i.amount then raise exception 'payment exceeds outstanding balance or is invalid' using errcode = '22023'; end if;
    value := p_amount;
  end if;
  insert into public.invoice_payments(id,organization_id,invoice_id,amount,paid_on,reference,reverses_id,created_by)
    values(p_id,i.organization_id,i.id,value,p_paid_on,coalesce(p_reference,''),p_reverse,auth.uid());
  return p_id;
end $$;
create function public.record_invoice_payment(p_invoice uuid,p_id uuid,p_amount integer,p_paid_on date,p_reference text,p_reverse uuid default null)
returns uuid language sql security invoker set search_path = '' as $$ select app_private.record_payment(p_invoice,p_id,p_amount,p_paid_on,p_reference,p_reverse) $$;

create function app_private.cancel_invoice(p_invoice uuid,p_reason text,p_replacement_quote uuid,p_due_date date,p_bank_details text,p_expected_amount integer,p_expected_revision integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.invoices%rowtype; replacement uuid; previous public.invoice_cancellations%rowtype;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if auth.uid() is null or i.id is null or not app_private.is_org_admin(i.organization_id) then raise exception 'administrator permission is required' using errcode = '42501'; end if;
  select * into previous from public.invoice_cancellations where invoice_id = p_invoice;
  if found then
    if previous.reason = btrim(p_reason) and ((p_replacement_quote is null and previous.replacement_invoice_id is null)
      or exists(select 1 from public.invoices where id = previous.replacement_invoice_id and quote_id = p_replacement_quote)) then return previous.replacement_invoice_id; end if;
    raise exception 'invoice already canceled' using errcode = '55000';
  end if;
  if coalesce((select sum(amount) from public.invoice_payments where invoice_id = p_invoice),0) <> 0 then raise exception 'reverse payments before canceling invoice' using errcode = '55000'; end if;
  if exists(select 1 from public.invoice_deliveries where invoice_id = p_invoice and status in ('pending','sending','unknown')) then raise exception 'resolve pending delivery before cancellation' using errcode = '55000'; end if;
  if p_replacement_quote is not null then
    perform 1 from public.quotes where id = p_replacement_quote and organization_id = i.organization_id and customer_id = (select customer_id from public.quotes where id = i.quote_id) for update;
    if not found or exists(select 1 from public.invoices where quote_id = p_replacement_quote) then raise exception 'use a new unissued quote for the same customer and organization' using errcode = '22023'; end if;
    replacement := public.issue_invoice(p_replacement_quote,p_due_date,p_bank_details,p_expected_amount,p_expected_revision);
  end if;
  insert into public.invoice_cancellations(invoice_id,organization_id,replacement_invoice_id,reason,created_by)
    values(i.id,i.organization_id,replacement,btrim(p_reason),auth.uid());
  return replacement;
end $$;
create function public.cancel_or_correct_invoice(p_invoice uuid,p_reason text,p_replacement_quote uuid default null,p_due_date date default null,p_bank_details text default '',p_expected_amount integer default null,p_expected_revision integer default null)
returns uuid language sql security invoker set search_path = '' as $$ select app_private.cancel_invoice(p_invoice,p_reason,p_replacement_quote,p_due_date,p_bank_details,p_expected_amount,p_expected_revision) $$;

-- Invitation identity comes from confirmed Auth email, never editable profiles/user_metadata.
create function app_private.request_membership(p_invitation uuid,p_message text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare invitation public.organization_invitations%rowtype; user_email text; user_name text; result uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select lower(email) into user_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  select * into invitation from public.organization_invitations where id = p_invitation and email = user_email and revoked_at is null and expires_at > now() for update;
  if invitation.id is null then raise exception 'invitation unavailable for this confirmed email' using errcode = '42501'; end if;
  if app_private.is_org_member(invitation.organization_id) then raise exception 'already an organization member' using errcode = '55000'; end if;
  select id into result from public.organization_join_requests where organization_id = invitation.organization_id and user_id = auth.uid() and status = 'pending';
  if result is not null then return result; end if;
  select display_name into user_name from public.profiles where id = auth.uid();
  insert into public.organization_join_requests(organization_id,user_id,requester_display_name,requester_email,message)
    values(invitation.organization_id,auth.uid(),coalesce(user_name,''),user_email,left(coalesce(p_message,''),1000)) returning id into result;
  return result;
end $$;
create function public.request_organization_membership(p_invitation uuid,p_message text default '')
returns uuid language sql security invoker set search_path = '' as $$ select app_private.request_membership(p_invitation,p_message) $$;
create function app_private.my_invitations()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'organization_name',o.name,'company_name',c.name,'expires_at',i.expires_at,'requested',exists(select 1 from public.organization_join_requests r where r.organization_id=i.organization_id and r.user_id=auth.uid() and r.status='pending'))),'[]'::jsonb) into result
    from public.organization_invitations i join public.organizations o on o.id=i.organization_id join public.companies c on c.id=o.company_id
    where i.email=(select lower(email) from auth.users where id=auth.uid() and email_confirmed_at is not null)
      and i.revoked_at is null and i.expires_at > now() and not app_private.is_org_member(i.organization_id);
  return result;
end $$;
create function public.list_my_invitations() returns jsonb language sql security invoker set search_path = '' as $$ select app_private.my_invitations() $$;
create function app_private.invite_member(p_org uuid,p_email text,p_revoke boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if auth.uid() is null or not app_private.is_org_admin(p_org) then raise exception 'administrator permission is required' using errcode = '42501'; end if;
  if p_revoke then
    update public.organization_invitations set revoked_at=now() where organization_id=p_org and email=lower(btrim(p_email)) returning id into result;
  else
    insert into public.organization_invitations(organization_id,email,created_by) values(p_org,lower(btrim(p_email)),auth.uid())
      on conflict(organization_id,email) do update set revoked_at=null,expires_at=now()+interval '7 days',created_by=auth.uid() returning id into result;
  end if;
  return result;
end $$;
create function public.invite_organization_member(p_org uuid,p_email text,p_revoke boolean default false)
returns uuid language sql security invoker set search_path = '' as $$ select app_private.invite_member(p_org,p_email,p_revoke) $$;
create function app_private.review_membership(p_request uuid,p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.organization_join_requests%rowtype;
begin
  select * into r from public.organization_join_requests where id=p_request for update;
  if auth.uid() is null or r.id is null or not app_private.is_org_admin(r.organization_id) then raise exception 'administrator permission is required' using errcode = '42501'; end if;
  if r.status <> 'pending' then raise exception 'request already reviewed' using errcode = '55000'; end if;
  if p_approve and not exists(select 1 from public.organization_invitations i join auth.users u on lower(u.email)=i.email where i.organization_id=r.organization_id and u.id=r.user_id and u.email_confirmed_at is not null and i.revoked_at is null and i.expires_at>now()) then raise exception 'valid invitation required' using errcode = '42501'; end if;
  update public.organization_join_requests set status=case when p_approve then 'approved'::public.join_request_status else 'rejected'::public.join_request_status end,reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=r.id;
  if p_approve then
    insert into public.organization_memberships(organization_id,user_id,role) values(r.organization_id,r.user_id,'member') on conflict(organization_id,user_id) do nothing;
    update public.organization_invitations set revoked_at=now() where organization_id=r.organization_id and email=(select lower(email) from auth.users where id=r.user_id);
  end if;
end $$;
create function public.review_organization_membership(p_request uuid,p_approve boolean)
returns void language sql security invoker set search_path = '' as $$ select app_private.review_membership(p_request,p_approve) $$;
-- Do not allow direct API writes to bypass invitation verification or atomic approval.
revoke insert,update on public.organization_memberships from authenticated;
revoke insert,update on public.organization_join_requests from authenticated;

create function app_private.organization_members(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not app_private.is_org_admin(p_org) then raise exception 'administrator permission is required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'display_name',p.display_name,'email',p.email,'role',m.role) order by m.created_at)
    from public.organization_memberships m join public.profiles p on p.id=m.user_id where m.organization_id=p_org),'[]'::jsonb);
end $$;
create function public.list_organization_members(p_org uuid) returns jsonb language sql stable security invoker set search_path = '' as $$ select app_private.organization_members(p_org) $$;
revoke all on function app_private.organization_members(uuid),public.list_organization_members(uuid) from public,anon;
grant execute on function app_private.organization_members(uuid),public.list_organization_members(uuid) to authenticated,service_role;

-- Whitelist every new callable function; trigger functions are not public RPCs.
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='app_private' and p.proname in ('save_draft','record_quote_revision','record_payment','cancel_invoice','request_membership','my_invitations','invite_member','review_membership'))
      or (n.nspname='public' and p.proname in ('save_quote_draft','save_quote_versioned','issue_invoice','record_invoice_payment','cancel_or_correct_invoice','request_organization_membership','list_my_invitations','invite_organization_member','review_organization_membership'))
  loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    if f::text not like '%record_quote_revision%' then execute format('grant execute on function %s to authenticated,service_role',f); end if;
  end loop;
end $$;
