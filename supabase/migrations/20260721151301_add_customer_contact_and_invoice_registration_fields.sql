set lock_timeout = '5s';

alter table public.companies
  add column if not exists invoice_registration_no text not null default '';

alter table public.customers
  add column if not exists address text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists contact_title text not null default '',
  add column if not exists invoice_registration_no text not null default '';
