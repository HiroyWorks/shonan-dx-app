import type { Invoice, Quote } from '../types'
import { lineAmount, totals } from '../lib/money'
import { parseInvoiceSnapshot } from '../lib/invoiceSnapshot'

export type Preview = { kind: 'quote'; quote: Quote } | { kind: 'invoice'; quote: Quote; invoice: Invoice }
type Props = { target: Preview; taxRate: number; invoiceRegistrationNo: string; issuerName: string; issuerOrganization: string }
const money = (amount: number) => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount)
const date = (value: string) => new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))

export default function PreviewPaper({ target, taxRate, invoiceRegistrationNo, issuerName, issuerOrganization }: Props) {
  const snapshot = target.kind === 'invoice' ? parseInvoiceSnapshot(target.invoice.snapshot, target.invoice.amount) : null
  if (target.kind === 'invoice' && !snapshot) {
    return <div className="paper" role="alert"><h2>発行時の内容確認が必要です</h2><p>請求書番号: {target.invoice.invoiceNo}</p><p>保存済み請求額: {money(target.invoice.amount)}</p><p>この請求書には発行時の明細・税率・宛先が記録されていません。現在の設定から再作成せず、送付済みPDFなどの原本を確認してください。再印刷はできません。</p></div>
  }
  const quote = target.quote
  if (target.kind === 'quote' && quote.id !== 'draft' && quote.taxRate == null) {
    return <div className="paper" role="alert"><h2>見積の税率確認が必要です</h2><p>{quote.quoteNo} / 保存済み金額: {money(quote.amount)}</p><p>作成時の税率が記録されていません。請求書化されていない見積は、編集画面で内容と金額を確認して保存してください。請求書化済みの場合は原本を確認してください。</p></div>
  }
  const effectiveRate = snapshot?.taxRate ?? quote.taxRate ?? taxRate
  const total = snapshot?.totals ?? totals(quote.lines, effectiveRate)
  const lines = snapshot?.lines ?? quote.lines.map((line) => ({ ...line, amount: lineAmount(line) }))
  const isInvoice = target.kind === 'invoice'
  return <div className="paper">
    <div className="paper-header">
      <div><p className="eyebrow">{isInvoice ? 'Invoice' : 'Estimate'}</p><h2>{isInvoice ? '請求書' : '見積書'}</h2><p>No. {isInvoice ? target.invoice.invoiceNo : quote.quoteNo}</p></div>
      <div className="paper-date"><span>発行日</span><strong>{date(isInvoice ? target.invoice.createdAt : quote.createdAt)}</strong></div>
    </div>
    <div className="paper-meta">
      <div className="paper-box"><span>宛先</span><strong>{snapshot?.customerName ?? quote.customerName} 御中</strong>{snapshot?.customerAddress && <p>{snapshot.customerAddress}</p>}<p>{snapshot?.project ?? quote.project}</p></div>
      <div className="paper-box"><span>発行者</span><strong>{snapshot?.issuerName ?? issuerName}</strong><p>{snapshot?.issuerOrganization ?? issuerOrganization}</p><p>適格請求書発行事業者登録番号: {(snapshot?.registrationNo ?? invoiceRegistrationNo) || '未設定'}</p></div>
    </div>
    <table className="paper-table">
      <thead><tr><th>品目</th><th>税区分</th><th>単価</th><th>数量</th><th>金額</th></tr></thead>
      <tbody>{lines.map((line, index) => <tr key={index}><td><strong>{line.name}</strong><span>{line.unit}</span></td><td><span className={line.taxKind === 'exempt' ? 'tax-chip exempt' : 'tax-chip'}>{line.taxKind === 'exempt' ? '非課税' : '課税'}</span></td><td>{money(line.unitPrice)}</td><td>{line.quantity}</td><td>{money(line.amount)}</td></tr>)}</tbody>
    </table>
    <div className="paper-bottom">
      <div className="paper-note"><span>備考</span><p>{snapshot?.memo ?? quote.memo}</p></div>
      <div className="paper-totals"><div><span>小計</span><strong>{money(total.sub)}</strong></div><div><span>課税対象</span><strong>{money(total.taxable)}</strong></div><div><span>消費税（{effectiveRate}%）</span><strong>{money(total.tax)}</strong></div><div className="paper-grand"><span>合計</span><strong>{money(total.total)}</strong></div></div>
    </div>
  </div>
}
