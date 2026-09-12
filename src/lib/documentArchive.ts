import { supabase } from './supabase'
import { rpc, type InvoiceDocument } from './workflowRepository'
import type { Invoice } from '../types'

export async function sha256(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('')
}
export async function validatePdf(file: Blob) {
  if (file.size < 5 || file.size > 10485760) throw new Error('PDFは10MB以下のファイルを指定してください。')
  const bytes = await file.arrayBuffer()
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('PDFのファイル形式を確認できませんでした。')
  return { bytes, hash: await sha256(bytes) }
}
export async function archivePdf(invoice: Invoice, file: File, documentId: string, note: string, number: string, amount: number) {
  const { hash } = await validatePdf(file)
  if (number !== invoice.invoiceNo || amount !== invoice.amount) throw new Error('PDF原本の請求書番号・合計金額が登録内容と一致しません。')
  const path = `${invoice.orgId}/${invoice.id}/${documentId}.pdf`
  const { error } = await supabase.storage.from('invoice-originals').upload(path, file, { contentType: 'application/pdf', upsert: false })
  if (error) {
    // A retry after a network failure may find the exact immutable object already uploaded.
    const previous = await supabase.storage.from('invoice-originals').download(path)
    if (previous.error || await sha256(await previous.data.arrayBuffer()) !== hash) throw new Error(error.message)
  }
  await rpc('register_invoice_document', { p_id: documentId, p_invoice: invoice.id, p_sha256: hash, p_size: file.size, p_name: file.name, p_note: note, p_confirmed_number: number, p_confirmed_amount: amount })
}
export async function downloadOriginal(document: InvoiceDocument): Promise<Blob> {
  const { data, error } = await supabase.storage.from('invoice-originals').download(document.storagePath)
  if (error) throw new Error(error.message)
  const bytes = await data.arrayBuffer()
  if (data.size !== document.byteSize || await sha256(bytes) !== document.sha256) throw new Error('保管済みPDFの整合性検証に失敗しました。管理者へ連絡してください。')
  return new Blob([bytes], { type: 'application/pdf' })
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}
export async function dispatchDelivery(deliveryId: string) {
  const { data, error } = await supabase.functions.invoke('send-invoice', { body: { deliveryId } })
  if (error) throw new Error('送信処理が完了していません。送信履歴を再確認してください。サービス未設定・通信障害の可能性があります。')
  if (!data || data.status !== 'accepted') throw new Error('送信結果を確定できません。履歴を確認してください。')
}
