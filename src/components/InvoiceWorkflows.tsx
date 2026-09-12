import { useEffect, useState } from 'react'
import type { Invoice, Organization, Quote } from '../types'
import { archivePdf, dispatchDelivery, downloadBlob, downloadOriginal } from '../lib/documentArchive'
import { loadWorkflowData, outstanding, rpc, saveBilling, type BillingSettings, type WorkflowData } from '../lib/workflowRepository'

const money = (n: number) => `${n.toLocaleString('ja-JP')}円`
const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' })
const today = () => dayFormat.format(new Date())
const dueAfter = (days: number) => { const d = new Date(`${today()}T00:00:00+09:00`); d.setUTCDate(d.getUTCDate() + days); return dayFormat.format(d) }
const errorText = (e: unknown) => e instanceof Error ? e.message : '処理に失敗しました。'
const statusText: Record<string, string> = { pending: '送信待ち', sending: '送信処理中', accepted: 'メールサービス受付済み（到達未確認）', failed: '未送信／失敗', unknown: '結果不明・要確認' }
const emptyData: WorkflowData = { payments: [], cancellations: [], documents: [], deliveries: [], billing: { bankDetails: '', paymentDays: 30 } }

export function BillingPanel({ organization }: { organization: Organization }) {
  const [value, setValue] = useState<BillingSettings>(emptyData.billing)
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    void loadWorkflowData(organization.id).then((d) => { if (active) setValue(d.billing) }).catch((e) => { if (active) setMessage(errorText(e)) })
    return () => { active = false }
  }, [organization.id])
  return <section className="settings-card"><h3>請求・振込先設定</h3><p>新しく発行する請求書の初期値です。発行済みの請求書は変わりません。</p>
    <label><span>振込先（銀行・支店・種別・口座番号・名義）</span><textarea disabled={organization.role !== 'admin' || busy} maxLength={2000} value={value.bankDetails} onChange={(e) => setValue({ ...value, bankDetails: e.target.value })} /></label>
    <label><span>標準支払期限（発行日からの日数）</span><input type="number" min={0} max={365} step={1} disabled={organization.role !== 'admin' || busy} value={value.paymentDays} onChange={(e) => setValue({ ...value, paymentDays: Number(e.target.value) })} /></label>
    <button className="btn primary" disabled={organization.role !== 'admin' || busy} onClick={() => {
      setBusy(true); void saveBilling(organization.id, value).then(() => setMessage('請求設定を保存しました。')).catch((e) => setMessage(errorText(e))).finally(() => setBusy(false))
    }}>請求設定を保存</button>{message && <p role="status">{message}</p>}
  </section>
}

export function IssueInvoiceModal({ quote, onClose, onIssued }: { quote: Quote; onClose: () => void; onIssued: () => Promise<void> }) {
  const [due, setDue] = useState(dueAfter(30)), [bank, setBank] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    void loadWorkflowData(quote.orgId).then((d) => { if (active) { setDue(dueAfter(d.billing.paymentDays)); setBank(d.billing.bankDetails) } }).catch((e) => { if (active) setMessage(errorText(e)) })
    return () => { active = false }
  }, [quote.orgId])
  return <div className="modal-overlay"><div className="modal-window small-modal"><div className="modal-head"><h2>請求書の発行確認</h2><button disabled={busy} onClick={onClose}>閉じる</button></div><div className="modal-body workflow-form">
    <p>{quote.quoteNo} / {quote.customerName} / {money(quote.amount)}</p><p>発行すると内容・支払条件が固定されます。訂正は別の請求書として記録します。</p>
    <label><span>支払期限</span><input type="date" min={today()} required value={due} onChange={(e) => setDue(e.target.value)} /></label>
    <label><span>振込先</span><textarea maxLength={2000} required value={bank} onChange={(e) => setBank(e.target.value)} /></label>
    <button className="btn primary" disabled={busy || !bank.trim() || !due} onClick={() => {
      if (!window.confirm('この金額・支払期限・振込先で請求書を発行しますか？')) return
      setBusy(true); void rpc('issue_invoice', { p_quote_id: quote.id, p_due_date: due, p_bank_details: bank, p_expected_amount: quote.amount, p_expected_revision: quote.revision ?? 0 }).then(onIssued).then(onClose).catch((e) => setMessage(errorText(e))).finally(() => setBusy(false))
    }}>{busy ? '発行中…' : '請求書を発行する'}</button>{message && <p role="alert">{message}</p>}
  </div></div></div>
}

export default function InvoiceCenter({ organization, invoices, quotes, onPreview, onRefresh, onCopy }: {
  organization: Organization; invoices: Invoice[]; quotes: Quote[]; onPreview: (invoice: Invoice) => void; onRefresh: () => Promise<void>; onCopy: (quote: Quote) => void
}) {
  const [data, setData] = useState<WorkflowData>(emptyData), [selectedId, setSelectedId] = useState<string | null>(null)
  const [message, setMessage] = useState(''), [loading, setLoading] = useState(true), [filter, setFilter] = useState('all')
  const invoiceSetKey = invoices.map((i) => i.id).sort().join(',')
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const ready = loadedKey === invoiceSetKey
  useEffect(() => {
    let active = true
    void loadWorkflowData(organization.id).then((d) => { if (active) { setData(d); setLoadedKey(invoiceSetKey); setLoading(false); setMessage('') } }).catch((e) => { if (active) { setMessage(errorText(e)); setLoading(false) } })
    return () => { active = false }
  }, [organization.id, invoiceSetKey])
  const reload = async () => { setData(await loadWorkflowData(organization.id)); await onRefresh() }
  const selected = invoices.find((i) => i.id === selectedId)
  const unpaid = invoices.reduce((sum, i) => sum + outstanding(i.amount, i.id, data), 0)
  const visible = invoices.filter((i) => {
    if (!ready) return true
    const balance = outstanding(i.amount, i.id, data), canceled = data.cancellations.some((c) => c.invoiceId === i.id)
    return filter === 'all' || (filter === 'unpaid' && balance > 0) || (filter === 'overdue' && balance > 0 && i.dueDate && i.dueDate < today()) || (filter === 'canceled' && canceled)
  })
  return <section className="panel invoice-panel"><div className="panel-head"><div><p className="eyebrow">Invoices & payments</p><h2>請求・入金管理</h2></div><strong>未回収残高 {ready ? money(unpaid) : loading ? '確認中' : '未取得'}</strong></div>
    <p>取消後も原本と履歴は残ります。入金済み請求書の取消・訂正には、入金取消の記録が必要です。</p>
    {message && <p role="alert">{message}</p>}
    <label><span>表示</span><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">すべて</option><option value="unpaid">未回収</option><option value="overdue">期限超過</option><option value="canceled">取消・訂正済み</option></select></label>
    <div className="table-wrap"><table className="data-table"><thead><tr><th>請求書番号</th><th>取引先</th><th>請求額</th><th>未回収</th><th>支払期限</th><th>状態</th><th>操作</th></tr></thead><tbody>{visible.map((i) => {
      const canceled = data.cancellations.find((c) => c.invoiceId === i.id), document = data.documents.find((d) => d.invoiceId === i.id), balance = outstanding(i.amount, i.id, data)
      return <tr key={i.id}><td>{i.invoiceNo}{!i.snapshot && !document && <span className="danger-text"> 要原本確認</span>}</td><td>{i.customerName}{!i.snapshot && <small>（現在の顧客マスタ名）</small>}</td><td>{money(i.amount)}</td><td>{ready ? money(balance) : '未取得'}</td><td className={!canceled && balance > 0 && i.dueDate && i.dueDate < today() ? 'danger-text' : ''}>{i.dueDate || '未記録'}</td><td>{!ready ? '確認待ち' : canceled ? canceled.replacementInvoiceId ? '訂正済み' : '取消済み' : balance === 0 ? '入金済み' : balance < i.amount ? '一部入金' : '未入金'}{document ? ' / PDF保管済み' : ' / PDF未保管'}</td><td><button disabled={!ready} onClick={() => setSelectedId(i.id)}>詳細・入金・送付</button><button disabled={!ready} onClick={() => { if (document) void downloadOriginal(document).then((blob) => downloadBlob(blob, `${i.invoiceNo}.pdf`)).catch((e) => setMessage(errorText(e))); else onPreview(i) }}>{document ? '保管原本PDF' : '帳票確認'}</button></td></tr>
    })}</tbody></table></div>
    {selected && ready && <InvoiceDetail key={selected.id} invoice={selected} invoices={invoices} quotes={quotes} isAdmin={organization.role === 'admin'} data={data} onClose={() => setSelectedId(null)} onRefresh={reload} onCopy={(q) => { setSelectedId(null); onCopy(q) }} />}
  </section>
}

export function InvoiceDetail({ invoice, invoices, quotes, isAdmin, data, onClose, onRefresh, onCopy }: {
  invoice: Invoice; invoices: Invoice[]; quotes: Quote[]; isAdmin: boolean; data: WorkflowData; onClose: () => void; onRefresh: () => Promise<void>; onCopy: (quote: Quote) => void
}) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [paymentId, setPaymentId] = useState(() => crypto.randomUUID()), [amount, setAmount] = useState(''), [paidOn, setPaidOn] = useState(today()), [reference, setReference] = useState('')
  const [reason, setReason] = useState(''), [replacement, setReplacement] = useState(''), [due, setDue] = useState(dueAfter(data.billing.paymentDays)), [bank, setBank] = useState(data.billing.bankDetails)
  const [file, setFile] = useState<File | null>(null), [documentId, setDocumentId] = useState(() => crypto.randomUUID()), [note, setNote] = useState(''), [confirmedNumber, setConfirmedNumber] = useState(''), [confirmedAmount, setConfirmedAmount] = useState(''), [checked, setChecked] = useState(false)
  const [recipient, setRecipient] = useState(''), [subject, setSubject] = useState(`請求書 ${invoice.invoiceNo} のご送付`), [body, setBody] = useState('お世話になっております。\n請求書を添付いたします。ご確認のほどよろしくお願いいたします。'), [deliveryId, setDeliveryId] = useState(() => crypto.randomUUID())
  const canceled = data.cancellations.find((c) => c.invoiceId === invoice.id), document = data.documents.find((d) => d.invoiceId === invoice.id), quote = quotes.find((q) => q.id === invoice.quoteId)
  const payments = data.payments.filter((p) => p.invoiceId === invoice.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const deliveries = data.deliveries.filter((d) => d.invoiceId === invoice.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const paid = payments.reduce((sum, p) => sum + p.amount, 0), balance = outstanding(invoice.amount, invoice.id, data)
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage('')
    try { await action(); await onRefresh() } catch (e) { setMessage(errorText(e)); try { await onRefresh() } catch { /* Keep the original error visible. */ } } finally { setBusy(false) }
  }
  return <div className="modal-overlay"><div className="modal-window"><div className="modal-head"><div><h2>{invoice.invoiceNo}</h2><p>{invoice.customerName} / 請求額 {money(invoice.amount)} / 入金計 {money(paid)} / 未回収 {money(balance)}</p></div><button disabled={busy} onClick={onClose}>閉じる</button></div><div className="modal-body workflow-form">
    {message && <p role="alert" className="workflow-notice">{message}</p>}
    <p>支払期限：{invoice.dueDate || '未記録（既存原本を確認してください）'}</p><p className="pre-wrap">振込先：{invoice.bankDetails || '未記録'}</p>
    {canceled && <p className="danger-text">{canceled.replacementInvoiceId ? `訂正先：${invoices.find((i) => i.id === canceled.replacementInvoiceId)?.invoiceNo ?? canceled.replacementInvoiceId}` : '取消済み'} / 理由：{canceled.reason}</p>}
    <section className="workflow-box"><h3>入金履歴</h3><ul className="workflow-list">{payments.map((p) => <li key={p.id}><span>{p.paidOn} / {money(p.amount)} / {p.reference}{p.reversesId && '（入金取消）'}</span>{isAdmin && !canceled && p.amount > 0 && !payments.some((r) => r.reversesId === p.id) && <button disabled={busy} onClick={() => {
      const why = window.prompt('入金取消の理由（返金や記帳誤りなど）を入力してください。実際の返金処理はこのアプリでは実行されません。')
      if (why?.trim()) void run(async () => { await rpc('record_invoice_payment', { p_invoice: invoice.id, p_id: crypto.randomUUID(), p_amount: null, p_paid_on: today(), p_reference: why, p_reverse: p.id }); setMessage('入金取消を記録しました。') })
    }}>入金取消</button>}</li>)}</ul>
    {isAdmin && !canceled && <div className="workflow-form"><label><span>入金額（円）</span><input type="number" min={1} max={balance} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></label><label><span>入金日</span><input type="date" max={today()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label><label><span>照合メモ・振込名義</span><input maxLength={1000} value={reference} onChange={(e) => setReference(e.target.value)} /></label><button disabled={busy || !Number.isInteger(Number(amount)) || Number(amount) <= 0 || Number(amount) > balance} onClick={() => {
      if (window.confirm(`${paidOn}に${money(Number(amount))}の入金を記録しますか？`)) void run(async () => { await rpc('record_invoice_payment', { p_invoice: invoice.id, p_id: paymentId, p_amount: Number(amount), p_paid_on: paidOn, p_reference: reference }); setPaymentId(crypto.randomUUID()); setAmount(''); setReference(''); setMessage('入金を記録しました。') })
    }}>入金を記録</button></div>}</section>
    <section className="workflow-box"><h3>原本PDF・照合記録</h3>{document ? <><p>{document.originalName} / {new Date(document.verifiedAt).toLocaleString('ja-JP')}</p><p className="pre-wrap">照合記録：{document.verificationNote}</p><p className="hash-text">SHA-256：{document.sha256}</p><button disabled={busy} onClick={() => void run(async () => { downloadBlob(await downloadOriginal(document), `${invoice.invoiceNo}.pdf`) })}>保管PDFを検証してダウンロード</button></> : <>
      <p>新しい請求書は「帳票確認 → PDF化 / 印刷」でPDFを保存してから登録してください。既存請求書は実際に送付した原本を使用し、現在のマスタから推測して作り直さないでください。</p>
      {isAdmin && <div className="workflow-form"><label><span>原本PDF（最大10MB）</span><input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setDocumentId(crypto.randomUUID()); setChecked(false) }} /></label><label><span>PDFに記載された請求書番号</span><input value={confirmedNumber} onChange={(e) => setConfirmedNumber(e.target.value)} /></label><label><span>PDFに記載された合計金額（円）</span><input type="number" value={confirmedAmount} onChange={(e) => setConfirmedAmount(e.target.value)} /></label><label><span>照合記録（入手元・宛先・明細・税率・支払条件の確認内容）</span><textarea maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label><label className="checkbox-label"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />原本の内容を目視照合しました。登録後は上書き・削除できません。</label><button disabled={busy || !file || !checked || !note.trim() || confirmedNumber !== invoice.invoiceNo || confirmedAmount === '' || Number(confirmedAmount) !== invoice.amount} onClick={() => file && void run(async () => { await archivePdf(invoice, file, documentId, note, confirmedNumber, Number(confirmedAmount)); setMessage('原本PDFと照合記録を保管しました。') })}>原本PDFを保管・照合済みとして登録</button></div>}
    </>}</section>
    <section className="workflow-box"><h3>メール送付・履歴</h3><p>添付するのは保管済みの原本PDFです。「受付済み」はメールサービスの受付を示し、取引先への到達・開封を保証しません。</p>
    {isAdmin && document && !canceled && <div className="workflow-form"><label><span>送付先メールアドレス（毎回確認）</span><input type="email" maxLength={254} value={recipient} onChange={(e) => setRecipient(e.target.value)} /></label><label><span>件名</span><input maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} /></label><label><span>本文</span><textarea maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} /></label><button className="btn primary" disabled={busy || !recipient || !subject.trim() || !body.trim() || deliveries.some((d) => ['pending', 'sending', 'unknown'].includes(d.status))} onClick={() => {
      if (!window.confirm(`${recipient} に ${invoice.invoiceNo} の原本PDFを添付して送信します。宛先・添付内容を確認しましたか？`)) return
      void run(async () => { await rpc('queue_invoice_delivery', { p_id: deliveryId, p_invoice: invoice.id, p_recipient: recipient, p_subject: subject, p_body: body }); await dispatchDelivery(deliveryId); setDeliveryId(crypto.randomUUID()); setMessage('メールサービスが送付を受け付けました。') })
    }}>確認した宛先へメール送信</button></div>}
    <ul className="workflow-list">{deliveries.map((d) => <li key={d.id}><div><strong>{statusText[d.status] ?? d.status}</strong><p>{new Date(d.createdAt).toLocaleString('ja-JP')} / {d.recipient} / {d.subject}</p><p>{d.errorMessage}</p>{d.providerId && <p>送信ID: {d.providerId}</p>}</div>{isAdmin && <div className="workflow-actions">{d.status === 'pending' && <button disabled={busy} onClick={() => { if (window.confirm(`${d.recipient} への送信処理を再開しますか？`)) void run(async () => { await dispatchDelivery(d.id); setMessage('送信処理を再開しました。') }) }}>送信処理を再開</button>}{['pending', 'unknown', 'sending'].includes(d.status) && <button disabled={busy} onClick={() => {
      const accepted = window.confirm('メールサービスの管理画面で送信受付を確認済みですか？ OK＝受付済み、キャンセル＝未送信として記録します。結果不明のまま再送しないでください。')
      const why = window.prompt('確認根拠（送信ID、エラー内容など）を入力してください。空欄の場合は変更しません。')
      if (why?.trim()) void run(async () => { await rpc('resolve_invoice_delivery', { p_id: d.id, p_accepted: accepted, p_note: why }); setMessage('送信結果の確認記録を保存しました。') })
    }}>サービス側で確認した結果を記録</button>}</div>}</li>)}</ul></section>
    {isAdmin && !canceled && <section className="workflow-box"><h3>請求書の取消・訂正</h3><p>原本は残したまま取消記録を追加します。訂正は同じ取引先の新しい見積を作成してから選択してください。</p>{quote && <button disabled={busy} onClick={() => onCopy(quote)}>元の見積を複製して訂正案を作成</button>}
      <label><span>取消・訂正理由</span><textarea maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <label><span>訂正後の見積（取消のみなら選択不要）</span><select value={replacement} onChange={(e) => setReplacement(e.target.value)}><option value="">取消のみ</option>{quotes.filter((q) => q.id !== invoice.quoteId && q.customerId === quote?.customerId && !q.invoiceNo && q.taxRate != null).map((q) => <option key={q.id} value={q.id}>{q.quoteNo} / {q.project} / {money(q.amount)}</option>)}</select></label>
      {replacement && <><label><span>訂正請求書の支払期限</span><input type="date" min={today()} value={due} onChange={(e) => setDue(e.target.value)} /></label><label><span>訂正請求書の振込先</span><textarea maxLength={2000} value={bank} onChange={(e) => setBank(e.target.value)} /></label></>}
      <button className="danger-button" disabled={busy || !reason.trim() || paid !== 0 || (Boolean(replacement) && (!due || !bank.trim()))} onClick={() => { if (window.confirm(replacement ? '元の請求書を取消し、訂正請求書を新しい番号で発行しますか？' : '請求書を取消しますか？ 原本・履歴は削除されません。')) void run(async () => { await rpc('cancel_or_correct_invoice', { p_invoice: invoice.id, p_reason: reason, p_replacement_quote: replacement || null, p_due_date: replacement ? due : null, p_bank_details: bank, p_expected_amount: quotes.find((q) => q.id === replacement)?.amount ?? null, p_expected_revision: quotes.find((q) => q.id === replacement)?.revision ?? null }); setMessage('取消・訂正を記録しました。') }) }}>{replacement ? '取消と訂正発行を確定' : '請求書の取消を確定'}</button>
    </section>}
  </div></div></div>
}
