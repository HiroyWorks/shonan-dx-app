import { supabase } from './supabase'
import { record, records, str, num, nullableStr } from './dataShape'
import { isValidLine } from './money'
import type { Line, Quote } from '../types'

export type BillingSettings = { bankDetails: string; paymentDays: number }
export type QuoteDraftContent = { customerId: string; project: string; memo: string; lines: Line[] }
export type QuoteDraft = { id: string; title: string; content: QuoteDraftContent; version: number; updatedAt: string }
export type Revision = { id: string; quoteId: string; revision: number; recordedAt: string; content: QuoteDraftContent; amount: number; taxRate: number | null; quoteNo: string; baseline: boolean }
export type Payment = { id: string; invoiceId: string; amount: number; paidOn: string; reference: string; reversesId: string | null; createdAt: string }
export type Cancellation = { invoiceId: string; replacementInvoiceId: string | null; reason: string; createdAt: string }
export type InvoiceDocument = { id: string; invoiceId: string; storagePath: string; sha256: string; byteSize: number; originalName: string; source: string; verificationNote: string; verifiedAt: string }
export type Delivery = { id: string; invoiceId: string; recipient: string; subject: string; body: string; status: string; providerId: string | null; errorMessage: string | null; createdAt: string }
export type WorkflowData = { payments: Payment[]; cancellations: Cancellation[]; documents: InvoiceDocument[]; deliveries: Delivery[]; billing: BillingSettings }

export function parseDraftContent(value: unknown): QuoteDraftContent {
  const r = record(value)
  const lines = records(r.lines).map((l): Line => {
    if (l.taxKind !== 'taxable' && l.taxKind !== 'exempt') throw new Error('下書きの税区分が不正です。')
    const line: Line = { id: str(l.id), itemId: str(l.itemId), name: str(l.name), unitPrice: num(l.unitPrice), quantity: num(l.quantity), unit: str(l.unit), taxKind: l.taxKind, isCustom: l.isCustom === true }
    if (!isValidLine(line)) throw new Error('下書きの金額・数量が不正です。')
    return line
  })
  return { customerId: str(r.customerId), project: str(r.project), memo: str(r.memo), lines }
}

export async function rpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

// Paging prevents a successful-looking, silently truncated list at the API row cap.
export async function allRows(table: string, organizationId: string, order = 'id', columns = '*') {
  const rows: Record<string, unknown>[] = []
  const pageSize = 500
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select(columns).eq('organization_id', organizationId).order(order).range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = records(data)
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

export async function loadWorkflowData(orgId: string): Promise<WorkflowData> {
  const [payments, cancellations, documents, deliveries, settings] = await Promise.all([
    allRows('invoice_payments', orgId), allRows('invoice_cancellations', orgId, 'invoice_id'), allRows('invoice_documents', orgId),
    allRows('invoice_deliveries', orgId), allRows('billing_settings', orgId, 'organization_id'),
  ])
  return {
    payments: payments.map((r) => ({ id: str(r.id), invoiceId: str(r.invoice_id), amount: num(r.amount), paidOn: str(r.paid_on), reference: str(r.reference), reversesId: nullableStr(r.reverses_id), createdAt: str(r.created_at) })),
    cancellations: cancellations.map((r) => ({ invoiceId: str(r.invoice_id), replacementInvoiceId: nullableStr(r.replacement_invoice_id), reason: str(r.reason), createdAt: str(r.created_at) })),
    documents: documents.map((r) => ({ id: str(r.id), invoiceId: str(r.invoice_id), storagePath: str(r.storage_path), sha256: str(r.sha256), byteSize: num(r.byte_size), originalName: str(r.original_name), source: str(r.source), verificationNote: str(r.verification_note), verifiedAt: str(r.verified_at) })),
    deliveries: deliveries.map((r) => ({ id: str(r.id), invoiceId: str(r.invoice_id), recipient: str(r.recipient), subject: str(r.subject), body: str(r.body), status: str(r.status), providerId: nullableStr(r.provider_id), errorMessage: nullableStr(r.error_message), createdAt: str(r.created_at) })),
    billing: { bankDetails: settings[0] ? str(settings[0].bank_details) : '', paymentDays: settings[0] ? num(settings[0].payment_days) : 30 },
  }
}

export async function loadDrafts(orgId: string): Promise<QuoteDraft[]> {
  return (await allRows('quote_drafts', orgId)).map((r) => ({ id: str(r.id), title: str(r.title), content: parseDraftContent(r.content), version: num(r.version), updatedAt: str(r.updated_at) }))
}
export async function saveDraft(orgId: string, draft: { id: string; version: number; title: string; content: QuoteDraftContent }) {
  parseDraftContent(draft.content)
  return rpc('save_quote_draft', { p_org: orgId, p_id: draft.id, p_version: draft.version, p_title: draft.title, p_content: draft.content })
}
export async function deleteDraft(orgId: string, id: string) {
  const { data, error } = await supabase.from('quote_drafts').delete().eq('organization_id', orgId).eq('id', id).select('id')
  if (error || !data?.length) throw new Error(error?.message || '下書きを削除できませんでした。')
}
export async function loadRevisions(orgId: string, quoteId: string): Promise<Revision[]> {
  const rows = (await allRows('quote_revisions', orgId)).filter((r) => r.quote_id === quoteId)
  return rows.map((r) => {
    const content = record(r.content), q = record(content.quote)
    const mappedLines = records(content.lines).map((l) => ({ id: l.id, itemId: l.item_master_id ?? '', isCustom: l.item_master_id == null, name: l.name, unit: l.unit, unitPrice: l.unit_price, quantity: l.quantity, taxKind: l.tax_kind }))
    return { id: str(r.id), quoteId: str(r.quote_id), revision: num(r.revision), recordedAt: str(r.recorded_at), amount: num(q.amount), taxRate: q.tax_rate == null ? null : num(q.tax_rate), quoteNo: str(q.quote_no), baseline: content.baseline === true, content: parseDraftContent({ customerId: q.customer_id, project: q.project, memo: q.memo, lines: mappedLines }) }
  }).sort((a, b) => b.revision - a.revision)
}
export async function saveBilling(orgId: string, settings: BillingSettings) {
  const { error } = await supabase.from('billing_settings').upsert({ organization_id: orgId, bank_details: settings.bankDetails, payment_days: settings.paymentDays, updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
}
export function outstanding(amount: number, invoiceId: string, data: Pick<WorkflowData, 'payments' | 'cancellations'>) {
  if (data.cancellations.some((c) => c.invoiceId === invoiceId)) return 0
  return amount - data.payments.filter((p) => p.invoiceId === invoiceId).reduce((sum, p) => sum + p.amount, 0)
}
export function draftFromQuote(quote: Quote): QuoteDraftContent {
  return { customerId: quote.customerId, project: quote.project, memo: quote.memo, lines: quote.lines.map((l) => ({ ...l, id: crypto.randomUUID() })) }
}
