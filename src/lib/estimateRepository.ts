import type { User as AuthUser } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { parseInvoiceSnapshot } from './invoiceSnapshot'
import { allRows } from './workflowRepository'
import type {
  Activity,
  ActivityKind,
  AppUser,
  Customer,
  Invoice,
  Item,
  Line,
  Organization,
  OrganizationData,
  Plan,
  Quote,
  QuoteStatus,
  Role,
  Settings,
  TaxKind,
} from '../types'

type MembershipRow = { organization_id: string; role: Role }
type OrganizationRow = { id: string; company_id: string; name: string }
type CompanyRow = { id: string; name: string; invoice_registration_no: string; plan: Plan; free_quote_limit: number }
type CustomerRow = {
  id: string
  organization_id: string
  name: string
  address: string
  phone: string
  contact: string
  contact_title: string
  email: string
  invoice_registration_no: string
  memo: string
}
type ItemRow = {
  id: string
  organization_id: string
  name: string
  category: string
  unit_price: number
  unit: string
  tax_kind: TaxKind
}
type QuoteRow = {
  id: string
  organization_id: string
  customer_id: string
  quote_no: string
  project: string
  memo: string
  amount: number
  status: 'pending' | 'won' | 'invoiced'
  created_at: string
  updated_at: string
  tax_rate: number | string | null
}
type QuoteItemRow = {
  id: string
  quote_id: string
  item_master_id: string | null
  name: string
  unit: string
  unit_price: number
  quantity: number | string
  tax_kind: TaxKind
  sort_order: number
}
type NoteRow = {
  id: string
  quote_id: string
  author_display_name: string
  body: string
  created_at: string
}
type InvoiceRow = {
  id: string
  organization_id: string
  quote_id: string
  invoice_no: string
  amount: number
  created_at: string
  snapshot: unknown
  due_date: string | null
  bank_details: string
}
type ActivityRow = {
  id: string
  organization_id: string
  kind: ActivityKind
  title: string
  description: string
  created_at: string
}
type SettingsRow = {
  prefix: string
  year: number
  next_sequence: number
  tax_rate: number | string
}

export type WorkspaceContext = {
  user: AppUser
  organizations: Organization[]
}

export type CustomerDraft = Omit<Customer, 'id' | 'orgId'>
export type ItemDraft = Omit<Item, 'id' | 'orgId'>

export type BackupPayload = {
  settings: {
    prefix: string
    year: number
    next_sequence: number
    tax_rate: number
    invoice_registration_no: string
  }
  customers: Array<Record<string, unknown>>
  items: Array<Record<string, unknown>>
  quotes: Array<Record<string, unknown>>
  quote_items: Array<Record<string, unknown>>
  notes: Array<Record<string, unknown>>
  invoices: Array<Record<string, unknown>>
  activities: Array<Record<string, unknown>>
}

const statusFromDb: Record<QuoteRow['status'], QuoteStatus> = {
  pending: 'Pending',
  won: 'Won',
  invoiced: 'Invoiced',
}

const statusToDb: Record<QuoteStatus, QuoteRow['status']> = {
  Pending: 'pending',
  Won: 'won',
  Invoiced: 'invoiced',
}

const resultData = <T,>(data: unknown) => data as T

const throwIfError = (error: { message: string } | null) => {
  if (error) throw new Error(error.message)
}

const displayNameFrom = (user: AuthUser) => {
  const metadataName = user.user_metadata.full_name ?? user.user_metadata.name
  return typeof metadataName === 'string' && metadataName.trim()
    ? metadataName.trim()
    : user.email?.split('@')[0] || 'ユーザー'
}

export async function loadWorkspaceContext(authUser: AuthUser): Promise<WorkspaceContext> {
  const appUser: AppUser = {
    id: authUser.id,
    name: displayNameFrom(authUser),
    email: authUser.email ?? '',
  }
  const profileResult = await supabase.from('profiles').upsert({
    id: appUser.id,
    display_name: appUser.name,
    email: appUser.email,
  }, { onConflict: 'id' })
  throwIfError(profileResult.error)

  const membershipResult = await supabase
    .from('organization_memberships')
    .select('organization_id, role')
    .eq('user_id', authUser.id)
    .order('created_at')
  throwIfError(membershipResult.error)
  const memberships = resultData<MembershipRow[]>(membershipResult.data ?? [])
  if (memberships.length === 0) return { user: appUser, organizations: [] }

  const organizationIds = memberships.map((membership) => membership.organization_id)
  const organizationResult = await supabase
    .from('organizations')
    .select('id, company_id, name')
    .in('id', organizationIds)
  throwIfError(organizationResult.error)
  const organizationRows = resultData<OrganizationRow[]>(organizationResult.data ?? [])

  const companyIds = [...new Set(organizationRows.map((organization) => organization.company_id))]
  const companyResult = await supabase
    .from('companies')
    .select('id, name, invoice_registration_no, plan, free_quote_limit')
    .in('id', companyIds)
  throwIfError(companyResult.error)
  const companyRows = resultData<CompanyRow[]>(companyResult.data ?? [])
  const roleByOrganization = new Map(memberships.map((membership) => [membership.organization_id, membership.role]))
  const companyById = new Map(companyRows.map((company) => [company.id, company]))

  const organizations = organizationRows.flatMap<Organization>((organization) => {
    const company = companyById.get(organization.company_id)
    const role = roleByOrganization.get(organization.id)
    if (!company || !role) return []
    return [{
      id: organization.id,
      companyId: company.id,
      company: company.name,
      name: organization.name,
      role,
      plan: company.plan,
      freeQuoteLimit: company.free_quote_limit,
      invoiceRegistrationNo: company.invoice_registration_no,
    }]
  })

  return { user: appUser, organizations }
}

export async function loadOrganizationData(organization: Organization): Promise<OrganizationData> {
  const organizationId = organization.id
  const [customerResult, itemResult, quoteResult, invoiceResult, activityResult, settingsResult, registrationResult, revisionRows] = await Promise.all([
    allRows('customers', organizationId).then((data) => ({ data, error: null })),
    allRows('item_masters', organizationId).then((data) => ({ data, error: null })),
    allRows('quotes', organizationId).then((data) => ({ data, error: null })),
    allRows('invoices', organizationId).then((data) => ({ data, error: null })),
    supabase.from('activity_logs').select('id, organization_id, kind, title, description, created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(200),
    supabase.from('quote_number_settings').select('prefix, year, next_sequence, tax_rate').eq('organization_id', organizationId).maybeSingle(),
    supabase.from('companies').select('invoice_registration_no').eq('id', organization.companyId).single(),
    allRows('quote_revisions', organizationId, 'id', 'id, quote_id, revision'),
  ])
  ;[customerResult, itemResult, quoteResult, invoiceResult, activityResult, settingsResult, registrationResult].forEach((result) => throwIfError(result.error))

  const customerRows = resultData<CustomerRow[]>(customerResult.data ?? [])
  const itemRows = resultData<ItemRow[]>(itemResult.data ?? [])
  const quoteRows = resultData<QuoteRow[]>(quoteResult.data ?? [])
  const invoiceRows = resultData<InvoiceRow[]>(invoiceResult.data ?? [])
  const activityRows = resultData<ActivityRow[]>(activityResult.data ?? [])
  const settingsRow = resultData<SettingsRow | null>(settingsResult.data)
  const quoteIds = quoteRows.map((quote) => quote.id)

  let quoteItemRows: QuoteItemRow[] = []
  let noteRows: NoteRow[] = []
  for (let offset = 0; offset < quoteIds.length; offset += 100) {
    const ids = quoteIds.slice(offset, offset + 100)
    for (let from = 0; ; from += 500) {
    const [lineResult, noteResult] = await Promise.all([
      supabase.from('quote_items').select('id, quote_id, item_master_id, name, unit, unit_price, quantity, tax_kind, sort_order').in('quote_id', ids).order('id').range(from, from + 499),
      supabase.from('quote_interaction_notes').select('id, quote_id, author_display_name, body, created_at').in('quote_id', ids).order('id').range(from, from + 499),
    ])
    throwIfError(lineResult.error)
    throwIfError(noteResult.error)
    quoteItemRows.push(...resultData<QuoteItemRow[]>(lineResult.data ?? []))
    noteRows.push(...resultData<NoteRow[]>(noteResult.data ?? []))
    if ((lineResult.data?.length ?? 0) < 500 && (noteResult.data?.length ?? 0) < 500) break
    }
  }
  quoteItemRows = quoteItemRows.sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
  noteRows = noteRows.sort((a, b) => b.created_at.localeCompare(a.created_at))
  const revisionByQuote = new Map<string, number>()
  for (const r of revisionRows) {
    if (typeof r.quote_id !== 'string' || typeof r.revision !== 'number') throw new Error('見積版番号の形式が不正です。')
    revisionByQuote.set(r.quote_id, Math.max(revisionByQuote.get(r.quote_id) ?? 0, r.revision))
  }

  const customers: Customer[] = customerRows.map((customer) => ({
    id: customer.id,
    orgId: customer.organization_id,
    name: customer.name,
    address: customer.address,
    phone: customer.phone,
    contact: customer.contact,
    contactTitle: customer.contact_title,
    email: customer.email,
    invoiceRegistrationNo: customer.invoice_registration_no,
    memo: customer.memo,
  }))
  const customerById = new Map(customers.map((customer) => [customer.id, customer]))
  const invoiceByQuote = new Map(invoiceRows.map((invoice) => [invoice.quote_id, invoice]))
  const linesByQuote = new Map<string, Line[]>()
  quoteItemRows.forEach((line) => {
    const lines = linesByQuote.get(line.quote_id) ?? []
    lines.push({
      id: line.id,
      itemId: line.item_master_id ?? '',
      name: line.name,
      unitPrice: line.unit_price,
      quantity: Number(line.quantity),
      unit: line.unit,
      taxKind: line.tax_kind,
      isCustom: line.item_master_id === null,
    })
    linesByQuote.set(line.quote_id, lines)
  })
  const notesByQuote = new Map<string, Quote['notes']>()
  noteRows.forEach((note) => {
    const notes = notesByQuote.get(note.quote_id) ?? []
    notes.push({ id: note.id, body: note.body, author: note.author_display_name || '不明', createdAt: note.created_at })
    notesByQuote.set(note.quote_id, notes)
  })

  const quotes: Quote[] = quoteRows.map((quote) => ({
    id: quote.id,
    orgId: quote.organization_id,
    quoteNo: quote.quote_no,
    customerId: quote.customer_id,
    customerName: customerById.get(quote.customer_id)?.name ?? '削除済み顧客',
    project: quote.project,
    amount: quote.amount,
    status: statusFromDb[quote.status],
    createdAt: quote.created_at,
    updatedAt: quote.updated_at,
    taxRate: quote.tax_rate === null ? null : Number(quote.tax_rate),
    revision: revisionByQuote.get(quote.id) ?? 0,
    memo: quote.memo,
    lines: linesByQuote.get(quote.id) ?? [],
    notes: notesByQuote.get(quote.id) ?? [],
    invoiceNo: invoiceByQuote.get(quote.id)?.invoice_no,
  }))
  const invoices: Invoice[] = invoiceRows.map((invoice) => {
    const quote = quotes.find((candidate) => candidate.id === invoice.quote_id)
    const snapshot = parseInvoiceSnapshot(invoice.snapshot, invoice.amount)
    return {
      id: invoice.id,
      orgId: invoice.organization_id,
      invoiceNo: invoice.invoice_no,
      quoteId: invoice.quote_id,
      customerName: snapshot?.customerName ?? quote?.customerName ?? '確認が必要な顧客',
      amount: invoice.amount,
      createdAt: invoice.created_at,
      snapshot,
      dueDate: invoice.due_date,
      bankDetails: invoice.bank_details,
    }
  })

  return {
    customers,
    items: itemRows.map((item) => ({
      id: item.id,
      orgId: item.organization_id,
      name: item.name,
      category: item.category,
      unitPrice: item.unit_price,
      unit: item.unit,
      taxKind: item.tax_kind,
    })),
    quotes,
    invoices,
    activities: activityRows.map((activity) => ({
      id: activity.id,
      orgId: activity.organization_id,
      kind: activity.kind,
      title: activity.title,
      description: activity.description,
      createdAt: activity.created_at,
    } satisfies Activity)),
    settings: {
      prefix: settingsRow?.prefix ?? 'Q',
      year: settingsRow?.year ?? new Date().getFullYear(),
      nextNo: settingsRow?.next_sequence ?? 1,
      taxRate: Number(settingsRow?.tax_rate ?? 10),
      invoiceRegistrationNo: resultData<{ invoice_registration_no: string }>(registrationResult.data).invoice_registration_no,
    },
  }
}

export async function saveCustomer(organizationId: string, customerId: string | null, draft: CustomerDraft) {
  const values = {
    organization_id: organizationId,
    name: draft.name.trim(),
    address: draft.address,
    phone: draft.phone,
    contact: draft.contact,
    contact_title: draft.contactTitle,
    email: draft.email,
    invoice_registration_no: draft.invoiceRegistrationNo,
    memo: draft.memo,
    updated_at: new Date().toISOString(),
  }
  const result = customerId
    ? await supabase.from('customers').update(values).eq('id', customerId).eq('organization_id', organizationId)
    : await supabase.from('customers').insert(values)
  throwIfError(result.error)
}

export async function deleteCustomer(organizationId: string, customerId: string) {
  const result = await supabase.from('customers').delete().eq('id', customerId).eq('organization_id', organizationId)
  throwIfError(result.error)
}

export async function saveItem(organizationId: string, itemId: string | null, draft: ItemDraft) {
  const values = {
    organization_id: organizationId,
    name: draft.name.trim(),
    category: draft.category,
    unit_price: draft.unitPrice,
    unit: draft.unit,
    tax_kind: draft.taxKind,
    updated_at: new Date().toISOString(),
  }
  const result = itemId
    ? await supabase.from('item_masters').update(values).eq('id', itemId).eq('organization_id', organizationId)
    : await supabase.from('item_masters').insert(values)
  throwIfError(result.error)
}

export async function deleteItem(organizationId: string, itemId: string) {
  const result = await supabase.from('item_masters').delete().eq('id', itemId).eq('organization_id', organizationId)
  throwIfError(result.error)
}

export async function saveQuote(input: {
  organizationId: string
  quoteId: string
  customerId: string
  project: string
  memo: string
  lines: Line[]
  expectedAmount: number
  expectedRevision: number
}) {
  const result = await supabase.rpc('save_quote_versioned', {
    p_organization_id: input.organizationId,
    p_quote_id: input.quoteId,
    p_customer_id: input.customerId,
    p_project: input.project,
    p_memo: input.memo,
    p_expected_amount: input.expectedAmount,
    p_expected_revision: input.expectedRevision,
    p_lines: input.lines.map((line, index) => ({
      id: line.id,
      item_master_id: line.isCustom || !line.itemId ? null : line.itemId,
      name: line.name,
      unit: line.unit,
      unit_price: line.unitPrice,
      quantity: line.quantity,
      tax_kind: line.taxKind,
      sort_order: index,
    })),
  })
  throwIfError(result.error)
}

export async function updateQuoteStatus(quoteId: string, status: QuoteStatus) {
  const result = await supabase.rpc('update_quote_status', { p_quote_id: quoteId, p_status: statusToDb[status] })
  throwIfError(result.error)
}

export async function deleteQuote(organizationId: string, quoteId: string) {
  const result = await supabase.from('quotes').delete().eq('id', quoteId).eq('organization_id', organizationId).select('id')
  throwIfError(result.error)
  if (!result.data?.length) throw new Error('quote deletion was not permitted')
}

export async function createInvoice(quoteId: string) {
  const result = await supabase.rpc('create_invoice', { p_quote_id: quoteId })
  throwIfError(result.error)
}

export async function addQuoteNote(quoteId: string, body: string) {
  const result = await supabase.rpc('add_quote_note', { p_quote_id: quoteId, p_body: body })
  throwIfError(result.error)
}

export async function saveWorkspaceSettings(organizationId: string, settings: Settings) {
  const result = await supabase.rpc('save_workspace_settings', {
    p_organization_id: organizationId,
    p_prefix: settings.prefix,
    p_year: settings.year,
    p_next_sequence: settings.nextNo,
    p_tax_rate: settings.taxRate,
    p_invoice_registration_no: settings.invoiceRegistrationNo,
  })
  throwIfError(result.error)
}

export async function importOrganizationBackup(organizationId: string, data: BackupPayload) {
  const result = await supabase.rpc('import_organization_backup', {
    p_organization_id: organizationId,
    p_data: data,
  })
  throwIfError(result.error)
}
