import { useEffect, useState } from 'react'
import { deleteDraft, loadDrafts, loadRevisions, saveDraft, type QuoteDraft, type QuoteDraftContent, type Revision } from '../lib/workflowRepository'

type DraftProps = { organizationId: string; content: QuoteDraftContent; onLoad: (content: QuoteDraftContent) => void }
export function DraftPanel({ organizationId, content, onLoad }: DraftProps) {
  const [drafts, setDrafts] = useState<QuoteDraft[]>([])
  const [selected, setSelected] = useState<QuoteDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    void loadDrafts(organizationId).then((data) => { if (active) setDrafts(data) }).catch((e: Error) => { if (active) setMessage(e.message) })
    return () => { active = false }
  }, [organizationId])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage('')
    try { await action(); setDrafts(await loadDrafts(organizationId)) } catch (e) { setMessage(e instanceof Error ? e.message : '下書きを保存できませんでした。') } finally { setBusy(false) }
  }
  return <section className="workflow-box">
    <h3>自分の下書き</h3><p>番号を発行せずDBに保存します。他の担当者の画面には表示されませんが、管理者の全件バックアップには含まれます。明細の単価・数量は有効な値を入力してください。</p>
    <div className="workflow-actions"><button className="btn ghost" disabled={busy} onClick={() => void run(async () => {
      await saveDraft(organizationId, { id: selected?.id ?? crypto.randomUUID(), version: selected?.version ?? 0, title: content.project.trim().slice(0, 200) || '無題の下書き', content })
      setSelected(null); setMessage('下書きを保存しました。')
    })}>{selected ? '読み込んだ下書きを更新' : '現在の入力を下書き保存'}</button>{selected && <button disabled={busy} onClick={() => setSelected(null)}>別の下書きとして保存する</button>}</div>
    {message && <p role="status">{message}</p>}
    <ul className="workflow-list">{drafts.map((d) => <li key={d.id}><span>{d.title} / {new Date(d.updatedAt).toLocaleString('ja-JP')} / 第{d.version}版</span><div className="workflow-actions"><button disabled={busy} onClick={() => {
      if (window.confirm('現在の入力を下書きで置き換えますか？ 未保存の入力は失われます。')) { onLoad(d.content); setSelected(d) }
    }}>読み込む</button><button disabled={busy} onClick={() => {
      if (window.confirm(`下書き「${d.title}」を削除しますか？`)) void run(async () => { await deleteDraft(organizationId, d.id); if (selected?.id === d.id) setSelected(null) })
    }}>削除</button></div></li>)}</ul>
  </section>
}

export function RevisionModal({ organizationId, quoteId, onClose, onCopy }: { organizationId: string; quoteId: string; onClose: () => void; onCopy: (content: QuoteDraftContent) => void }) {
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [message, setMessage] = useState('履歴を読み込み中です。')
  useEffect(() => {
    let active = true
    void loadRevisions(organizationId, quoteId).then((data) => { if (active) { setRevisions(data); setMessage(data.length ? '' : 'この機能の導入後に保存した版から記録されます。導入前の履歴は推測して作成しません。') } }).catch((e: Error) => { if (active) setMessage(e.message) })
    return () => { active = false }
  }, [organizationId, quoteId])
  return <div className="modal-overlay"><div className="modal-window"><div className="modal-head"><h2>見積の改訂履歴</h2><button className="btn ghost" onClick={onClose}>閉じる</button></div><div className="modal-body">
    {message && <p role="status">{message}</p>}{revisions.map((r) => <details className="workflow-box" key={r.id}><summary>第{r.revision}版{r.baseline ? '（導入時点の基準版）' : ''} / {new Date(r.recordedAt).toLocaleString('ja-JP')} / {r.amount.toLocaleString()}円</summary>
      <p>{r.quoteNo} / {r.content.project} / 税率 {r.taxRate ?? '未確認'}%</p><ul>{r.content.lines.map((l) => <li key={l.id}>{l.name}：{l.unitPrice.toLocaleString()}円 × {l.quantity} {l.unit}</li>)}</ul><p className="pre-wrap">{r.content.memo}</p>
      <button onClick={() => { if (window.confirm('この版を新しい見積の入力へ複製します。現在の入力は置き換わります。よろしいですか？')) onCopy({ ...r.content, lines: r.content.lines.map((l) => ({ ...l, id: crypto.randomUUID() })) }) }}>新規見積へ複製（原本は変更しません）</button>
    </details>)}
  </div></div></div>
}
