import { record, records, str, num } from './dataShape'
import { parseInvoiceSnapshot } from './invoiceSnapshot'
import { totals } from './money'
import type { TaxKind } from '../types'

export const backupTables = ['companies', 'organizations', 'profiles', 'organization_memberships', 'organization_join_requests', 'customers', 'item_masters', 'quote_number_settings', 'billing_settings', 'quotes', 'quote_items', 'quote_interaction_notes', 'invoices', 'activity_logs', 'quote_drafts', 'quote_revisions', 'invoice_payments', 'invoice_cancellations', 'invoice_documents', 'invoice_deliveries', 'organization_invitations', 'invoice_number_counters', 'storage_files'] as const
export type BackupFile = { path: string; base64: string; sha256: string; byteSize: number }
export type FullBackup = { format: 'estimate-management-full'; version: 2; schema: 'document-workflows-v2'; organizationId: string; exportedAt: string; data: Record<string, Record<string, unknown>[]>; counts: Record<string, number>; files: BackupFile[]; checksum: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(record(value)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('バックアップに保存できない値が含まれています。')
  return encoded
}
export async function digest(bytes: ArrayBuffer) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('') }
export async function checksum(value: unknown) { return digest(new TextEncoder().encode(canonicalJson(value)).buffer) }
export function bytesToBase64(bytes: Uint8Array) {
  let text = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(text)
}
export function base64ToBytes(value: string) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('PDFの保存形式が不正です。')
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}
export function parseBackupEnvelope(value: unknown): Omit<FullBackup, 'checksum' | 'files'> {
  const r = record(value)
  if (r.format !== 'estimate-management-full' || r.version !== 2 || r.schema !== 'document-workflows-v2') throw new Error('全件バックアップv2ではありません。旧JSONは自動復元できません。')
  const organizationId = str(r.organizationId), exportedAt = str(r.exportedAt)
  if (!uuid.test(organizationId) || !Number.isFinite(Date.parse(exportedAt))) throw new Error('バックアップの組織・日時が不正です。')
  const source = record(r.data), counts = record(r.counts), data: FullBackup['data'] = {}, resultCounts: FullBackup['counts'] = {}
  if (Object.keys(source).length !== backupTables.length || Object.keys(counts).length !== backupTables.length) throw new Error('バックアップのテーブル構成が一致しません。')
  for (const table of backupTables) {
    data[table] = records(source[table]); resultCounts[table] = num(counts[table])
    if (data[table].length !== resultCounts[table]) throw new Error(`${table} の件数が一致しません。`)
    for (const row of data[table]) if ('organization_id' in row && row.organization_id !== organizationId) throw new Error('別組織のデータが混在しています。')
  }
  if (data.organizations.length !== 1 || data.organizations[0].id !== organizationId || data.companies.length !== 1 || data.companies[0].id !== data.organizations[0].company_id) throw new Error('会社・組織の参照が不正です。')
  return { format: 'estimate-management-full', version: 2, schema: 'document-workflows-v2', organizationId, exportedAt, data, counts: resultCounts }
}
export async function validateFullBackup(value: unknown): Promise<FullBackup> {
  const r = record(value), envelope = parseBackupEnvelope(value), files: BackupFile[] = []
  const paths = new Set<string>()
  for (const f of records(r.files)) {
    const file = { path: str(f.path), base64: str(f.base64), sha256: str(f.sha256), byteSize: num(f.byteSize) }
    if (!file.path.startsWith(`${envelope.organizationId}/`) || file.path.includes('..') || paths.has(file.path)) throw new Error('PDFの保存先が不正・重複しています。')
    paths.add(file.path)
    const bytes = base64ToBytes(file.base64)
    if (bytes.byteLength !== file.byteSize || await digest(bytes.buffer) !== file.sha256) throw new Error('PDFのハッシュまたはサイズが一致しません。')
    files.push(file)
  }
  if (files.length !== envelope.data.storage_files.length || envelope.data.storage_files.some((f) => !paths.has(str(f.name)))) throw new Error('バックアップに不足しているPDFがあります。')
  for (const d of envelope.data.invoice_documents) {
    const f = files.find((f) => f.path === d.storage_path)
    if (!f || f.sha256 !== d.sha256 || f.byteSize !== d.byte_size) throw new Error('原本PDFと照合記録が一致しません。')
  }
  for (const i of envelope.data.invoices) if (i.snapshot != null && !parseInvoiceSnapshot(i.snapshot, num(i.amount))) throw new Error('請求書の発行原本データが不正です。')
  for (const q of envelope.data.quotes) {
    if (q.tax_rate == null) continue
    const lines = envelope.data.quote_items.filter((l) => l.quote_id === q.id).map((l): { unitPrice: number; quantity: number; taxKind: TaxKind } => {
      if (l.tax_kind !== 'taxable' && l.tax_kind !== 'exempt') throw new Error('明細の税区分が不正です。')
      return { unitPrice: num(l.unit_price), quantity: num(l.quantity), taxKind: l.tax_kind }
    })
    if (!lines.length || totals(lines, num(q.tax_rate)).total !== num(q.amount)) throw new Error('見積明細と金額が一致しません。')
  }
  const payload = { ...envelope, files }, expected = str(r.checksum)
  if (await checksum(payload) !== expected) throw new Error('バックアップ全体のチェックサムが一致しません。')
  return { ...payload, checksum: expected }
}
