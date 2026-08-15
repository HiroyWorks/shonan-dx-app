create index quotes_organization_customer_idx
  on public.quotes (organization_id, customer_id);

create index invoices_organization_quote_idx
  on public.invoices (organization_id, quote_id);

drop policy "members read quote settings" on public.quote_number_settings;
drop policy "admins manage quote settings" on public.quote_number_settings;

create policy "members read quote settings"
on public.quote_number_settings
for select to authenticated
using (app_private.is_org_member(organization_id));

create policy "admins insert quote settings"
on public.quote_number_settings
for insert to authenticated
with check (app_private.is_org_admin(organization_id));

create policy "admins update quote settings"
on public.quote_number_settings
for update to authenticated
using (app_private.is_org_admin(organization_id))
with check (app_private.is_org_admin(organization_id));

create policy "admins delete quote settings"
on public.quote_number_settings
for delete to authenticated
using (app_private.is_org_admin(organization_id));
