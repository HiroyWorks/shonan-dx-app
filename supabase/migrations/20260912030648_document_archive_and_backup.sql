-- Private append-only document storage. No public URL, overwrite, or delete grant.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('invoice-originals','invoice-originals',false,10485760,array['application/pdf'])
  on conflict(id) do nothing;
do $$ begin
  if exists(select 1 from storage.buckets where id='invoice-originals' and (public is distinct from false or file_size_limit is distinct from 10485760::bigint or allowed_mime_types is distinct from array['application/pdf'])) then
    raise exception 'invoice-originals bucket has conflicting public/size/MIME settings; review before migration';
  end if;
end $$;
create policy invoice_pdf_read on storage.objects for select to authenticated using (
  bucket_id='invoice-originals' and exists(select 1 from public.invoices i
    where name like i.organization_id::text || '/' || i.id::text || '/%' and app_private.is_org_member(i.organization_id))
);
create policy invoice_pdf_insert on storage.objects for insert to authenticated with check (
  bucket_id='invoice-originals' and exists(select 1 from public.invoices i
    where name ~ ('^' || i.organization_id::text || '/' || i.id::text || '/[0-9a-f-]{36}\.pdf$')
      and app_private.is_org_admin(i.organization_id)
      and not exists(select 1 from public.invoice_documents d where d.invoice_id=i.id))
);

create function app_private.register_invoice_document(p_id uuid,p_invoice uuid,p_sha256 text,p_size integer,p_name text,p_note text,p_confirmed_number text,p_confirmed_amount integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.invoices%rowtype; path text; existing public.invoice_documents%rowtype;
begin
  select * into i from public.invoices where id=p_invoice for update;
  if auth.uid() is null or i.id is null or not app_private.is_org_admin(i.organization_id) then raise exception 'administrator permission is required' using errcode='42501'; end if;
  if p_confirmed_number is distinct from i.invoice_no or p_confirmed_amount is distinct from i.amount then raise exception 'original invoice number or amount does not match' using errcode='22023'; end if;
  select * into existing from public.invoice_documents where invoice_id=i.id;
  if found then
    if existing.id=p_id and existing.sha256=p_sha256 then return existing.id; end if;
    raise exception 'an immutable original is already archived' using errcode='55000';
  end if;
  path := i.organization_id::text || '/' || i.id::text || '/' || p_id::text || '.pdf';
  if not exists(select 1 from storage.objects where bucket_id='invoice-originals' and name=path and (metadata->>'size')::bigint=p_size) then raise exception 'uploaded PDF not found or size mismatch' using errcode='22023'; end if;
  insert into public.invoice_documents(id,organization_id,invoice_id,storage_path,sha256,byte_size,original_name,source,verification_note,verified_by)
    values(p_id,i.organization_id,i.id,path,p_sha256,p_size,p_name,case when i.snapshot is null then 'legacy_original' else 'issued_pdf' end,p_note,auth.uid());
  return p_id;
end $$;
create function public.register_invoice_document(p_id uuid,p_invoice uuid,p_sha256 text,p_size integer,p_name text,p_note text,p_confirmed_number text,p_confirmed_amount integer)
returns uuid language sql security invoker set search_path = '' as $$ select app_private.register_invoice_document(p_id,p_invoice,p_sha256,p_size,p_name,p_note,p_confirmed_number,p_confirmed_amount) $$;

create function app_private.queue_invoice_delivery(p_id uuid,p_invoice uuid,p_recipient text,p_subject text,p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.invoices%rowtype; document uuid; existing public.invoice_deliveries%rowtype;
begin
  select * into i from public.invoices where id=p_invoice for update;
  if auth.uid() is null or i.id is null or not app_private.is_org_admin(i.organization_id) then raise exception 'administrator permission is required' using errcode='42501'; end if;
  select * into existing from public.invoice_deliveries where id=p_id;
  if found then
    if existing.invoice_id is distinct from p_invoice or existing.recipient is distinct from btrim(p_recipient) or existing.subject is distinct from btrim(p_subject) or existing.body is distinct from p_body then raise exception 'delivery id reused with different input' using errcode='22023'; end if;
    return p_id;
  end if;
  if exists(select 1 from public.invoice_cancellations where invoice_id=i.id) then raise exception 'canceled invoices cannot be sent' using errcode='55000'; end if;
  select id into document from public.invoice_documents where invoice_id=i.id;
  if document is null then raise exception 'archive and verify the original PDF before sending' using errcode='55000'; end if;
  if exists(select 1 from public.invoice_deliveries where invoice_id=i.id and status in ('pending','sending','unknown')) then raise exception 'resolve existing delivery first' using errcode='55000'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email-rate:' || i.organization_id::text,0));
  if (select count(*) from public.invoice_deliveries where organization_id=i.organization_id and created_at>now()-interval '1 hour') >= 60 then raise exception 'hourly delivery limit reached' using errcode='54000'; end if;
  insert into public.invoice_deliveries(id,organization_id,invoice_id,document_id,recipient,subject,body,created_by)
    values(p_id,i.organization_id,i.id,document,btrim(p_recipient),btrim(p_subject),p_body,auth.uid());
  return p_id;
end $$;
create function public.queue_invoice_delivery(p_id uuid,p_invoice uuid,p_recipient text,p_subject text,p_body text)
returns uuid language sql security invoker set search_path = '' as $$ select app_private.queue_invoice_delivery(p_id,p_invoice,p_recipient,p_subject,p_body) $$;

-- Only the authenticated server worker may claim/finalize a send.
create function public.claim_invoice_delivery(p_id uuid)
returns setof public.invoice_deliveries language sql security invoker set search_path = '' as $$
  update public.invoice_deliveries set status='sending',attempted_at=now()
    where id=p_id and status='pending' returning *;
$$;
revoke all on function public.claim_invoice_delivery(uuid) from public,anon,authenticated;
grant execute on function public.claim_invoice_delivery(uuid) to service_role;

create function app_private.resolve_invoice_delivery(p_id uuid,p_accepted boolean,p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.invoice_deliveries%rowtype;
begin
  select * into d from public.invoice_deliveries where id=p_id for update;
  if auth.uid() is null or d.id is null or not app_private.is_org_admin(d.organization_id) then raise exception 'administrator permission is required' using errcode='42501'; end if;
  if nullif(btrim(p_note),'') is null or length(p_note)>2000 then raise exception 'provider verification note is required' using errcode='22023'; end if;
  if d.status not in ('pending','unknown','sending') or (d.status='sending' and d.attempted_at>now()-interval '5 minutes') then raise exception 'delivery cannot be manually resolved yet' using errcode='55000'; end if;
  update public.invoice_deliveries set status=case when p_accepted then 'accepted' else 'failed' end,
    completed_at=now(),error_message='Manual provider verification: ' || p_note where id=p_id;
end $$;
create function public.resolve_invoice_delivery(p_id uuid,p_accepted boolean,p_note text)
returns void language sql security invoker set search_path = '' as $$ select app_private.resolve_invoice_delivery(p_id,p_accepted,p_note) $$;

-- Export one MVCC snapshot as a scalar JSON result: no PostgREST row limit.
-- Auth credentials/tokens are NOT exported. Profiles are included for FK restoration.
create function app_private.export_organization_backup(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare data jsonb := '{}'::jsonb; rows jsonb; t text; related_users uuid[];
begin
  if auth.uid() is null or not app_private.is_org_admin(p_org) then raise exception 'administrator permission is required' using errcode='42501'; end if;
  foreach t in array array['organization_memberships','organization_join_requests','customers','item_masters','quote_number_settings','quotes','invoices','activity_logs','billing_settings','quote_drafts','quote_revisions','invoice_payments','invoice_cancellations','invoice_documents','invoice_deliveries','organization_invitations'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t where organization_id=$1',t) into rows using p_org;
    data := data || jsonb_build_object(t,rows);
  end loop;
  foreach t in array array['quote_items','quote_interaction_notes'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by t.id),''[]''::jsonb) from public.%I t join public.quotes q on q.id=t.quote_id where q.organization_id=$1',t) into rows using p_org;
    data := data || jsonb_build_object(t,rows);
  end loop;
  select array_agg(distinct value::uuid) into related_users from (
    select r->>'user_id' value from jsonb_array_elements(data->'organization_memberships') r
    union select r->>'user_id' from jsonb_array_elements(data->'organization_join_requests') r
    union select r->>'reviewed_by' from jsonb_array_elements(data->'organization_join_requests') r
    union select r->>'created_by' from jsonb_array_elements(data->'quotes') r
    union select r->>'actor_id' from jsonb_array_elements(data->'activity_logs') r
    union select r->>'author_id' from jsonb_array_elements(data->'quote_interaction_notes') r
    union select r->>'user_id' from jsonb_array_elements(data->'quote_drafts') r
    union select r->>'recorded_by' from jsonb_array_elements(data->'quote_revisions') r
    union select r->>'created_by' from jsonb_array_elements(data->'invoice_payments') r
    union select r->>'created_by' from jsonb_array_elements(data->'invoice_cancellations') r
    union select r->>'verified_by' from jsonb_array_elements(data->'invoice_documents') r
    union select r->>'created_by' from jsonb_array_elements(data->'invoice_deliveries') r
    union select r->>'created_by' from jsonb_array_elements(data->'organization_invitations') r
  ) x where value is not null;
  data := data || jsonb_build_object(
    'profiles',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p where id=any(related_users)),'[]'::jsonb),
    'organizations',(select jsonb_agg(to_jsonb(o)) from public.organizations o where id=p_org),
    'companies',(select jsonb_agg(to_jsonb(c)) from public.companies c join public.organizations o on o.company_id=c.id where o.id=p_org),
    'invoice_number_counters',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('next_sequence',c.next_sequence::text) order by year) from app_private.invoice_number_counters c where organization_id=p_org),'[]'::jsonb),
    'storage_files',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'metadata',s.metadata) order by s.name) from storage.objects s where bucket_id='invoice-originals' and s.name like p_org::text || '/%'),'[]'::jsonb));
  return jsonb_build_object('format','estimate-management-full','version',2,'schema','document-workflows-v2',
    'organizationId',p_org,'exportedAt',now(),'data',data,
    'counts',(select jsonb_object_agg(key,jsonb_array_length(value)) from jsonb_each(data)));
end $$;
create function public.export_organization_backup(p_org uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app_private.export_organization_backup(p_org) $$;

do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('app_private','public') and p.proname in ('register_invoice_document','queue_invoice_delivery','resolve_invoice_delivery','export_organization_backup')
  loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to authenticated,service_role',f);
  end loop;
end $$;
