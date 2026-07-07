import React, { useEffect, useMemo, useState } from 'react'
import './App.css'

void React

type QuoteStatus = 'Pending' | 'Won' | 'Invoiced'

type Item = {
  id: string
  name: string
  category: string
  unitPrice: number
  unit: string
}

type LineItem = {
  id: string
  itemId: string
  quantity: number
  unitPrice: number
}

type Quote = {
  id: string
  quoteNo: string
  client: string
  project: string
  amount: number
  status: QuoteStatus
  createdAt: string
  waitingDays: number
}

const ITEMS: Item[] = [
  { id: 'site', name: 'Webサイト制作', category: '制作', unitPrice: 180000, unit: '式' },
  { id: 'lp', name: 'ランディングページ制作', category: '制作', unitPrice: 120000, unit: '式' },
  { id: 'maintenance', name: '保守運用', category: '月額', unitPrice: 25000, unit: '月' },
  { id: 'seo', name: 'SEO記事作成', category: 'コンテンツ', unitPrice: 15000, unit: '本' },
  { id: 'support', name: '操作レクチャー', category: 'サポート', unitPrice: 12000, unit: '時間' },
  { id: 'photo', name: '撮影ディレクション', category: '現場', unitPrice: 80000, unit: '回' },
]

const QUOTES: Quote[] = [
  {
    id: 'Q-2026-041',
    quoteNo: 'Q-2026-041',
    client: '湘南ベーカリー',
    project: '新商品サイトリニューアル',
    amount: 528000,
    status: 'Pending',
    createdAt: '2026-06-02',
    waitingDays: 11,
  },
  {
    id: 'Q-2026-038',
    quoteNo: 'Q-2026-038',
    client: '藤沢クリニック',
    project: '採用LP制作',
    amount: 264000,
    status: 'Won',
    createdAt: '2026-05-28',
    waitingDays: 0,
  },
  {
    id: 'Q-2026-036',
    quoteNo: 'Q-2026-036',
    client: '鎌倉工務店',
    project: '定期保守プラン',
    amount: 198000,
    status: 'Invoiced',
    createdAt: '2026-05-23',
    waitingDays: 0,
  },
  {
    id: 'Q-2026-034',
    quoteNo: 'Q-2026-034',
    client: '茅ヶ崎商事',
    project: 'コーポレートサイト改修',
    amount: 748000,
    status: 'Pending',
    createdAt: '2026-05-18',
    waitingDays: 26,
  },
]

const statusLabels: Record<QuoteStatus, string> = {
  Pending: '返答待ち',
  Won: '成約',
  Invoiced: '請求済',
}

const yen = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})

const dateFormat = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const formatYen = (value: number) => yen.format(value)
const formatDate = (value: string) => dateFormat.format(new Date(value))

let nextId = 1
const newLineItem = (itemId: string = ITEMS[0].id): LineItem => {
  const item = ITEMS.find((i) => i.id === itemId) ?? ITEMS[0]
  return { id: String(nextId++), itemId: item.id, quantity: 1, unitPrice: item.unitPrice }
}

function StatusBadge({ status }: { status: QuoteStatus }) {
  const className: Record<QuoteStatus, string> = {
    Pending: 'status-badge status-pending',
    Won: 'status-badge status-success',
    Invoiced: 'status-badge status-done',
  }

  return <span className={className[status]}>{statusLabels[status]}</span>
}

function App() {
  const [clientName, setClientName] = useState('株式会社みなと企画')
  const [projectName, setProjectName] = useState('コーポレートサイト見積')
  const [memo, setMemo] = useState('見積有効期限は30日です。要件確定後に最終調整いたします。')
  const [lineItems, setLineItems] = useState<LineItem[]>([newLineItem()])
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  useEffect(() => {
    if (!isPreviewOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPreviewOpen(false)
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isPreviewOpen])

  const handleLineItemChange = (id: string, field: keyof LineItem, value: string | number) => {
    setLineItems((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row
        if (field === 'itemId') {
          const item = ITEMS.find((i) => i.id === value) ?? ITEMS[0]
          return { ...row, itemId: item.id, unitPrice: item.unitPrice }
        }
        return { ...row, [field]: value }
      }),
    )
  }

  const addRow = () => {
    setLineItems((prev) => [...prev, newLineItem()])
  }

  const removeRow = (id: string) => {
    setLineItems((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== id) : prev))
  }

  const subtotal = useMemo(
    () => lineItems.reduce((sum, row) => sum + row.unitPrice * row.quantity, 0),
    [lineItems],
  )
  const tax = Math.round(subtotal * 0.1)
  const total = subtotal + tax

  const quotePreview = (
    <div className="paper">
      <div className="paper-header">
        <div>
          <p className="paper-kicker">Estimate</p>
          <h3>見積書</h3>
          <p className="paper-sub">No. Q-2026-045</p>
        </div>
        <div className="paper-date"><span>発行日</span><strong>2026/06/25</strong></div>
      </div>

      <div className="paper-meta">
        <div className="paper-box"><p className="paper-small">宛先</p><strong>{clientName}</strong><span>{projectName}</span></div>
        <div className="paper-box"><p className="paper-small">差出人</p><strong>個人事業主</strong><span>神奈川県湘南エリア</span><span>Tel. 000-0000-0000</span></div>
      </div>

      <div className="paper-table-wrap">
        <table className="paper-table">
          <thead><tr><th>品目</th><th className="align-right">単価</th><th className="align-right">数量</th><th className="align-right">金額</th></tr></thead>
          <tbody>
            {lineItems.map((row) => {
              const item = ITEMS.find((i) => i.id === row.itemId) ?? ITEMS[0]
              return (
                <tr key={row.id}>
                  <td>
                    <strong>{item.name}</strong>
                    <span>{item.category} / {item.unit}</span>
                  </td>
                  <td className="align-right">{formatYen(row.unitPrice)}</td>
                  <td className="align-right">{row.quantity}</td>
                  <td className="align-right amount">{formatYen(row.unitPrice * row.quantity)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="paper-bottom">
        <div className="paper-note"><p className="paper-small">備考</p><p>{memo}</p></div>
        <div className="paper-totals">
          <div><span>小計</span><strong>{formatYen(subtotal)}</strong></div>
          <div><span>消費税（10%）</span><strong>{formatYen(tax)}</strong></div>
          <div className="total-line" />
          <div className="grand-total"><span>合計</span><strong>{formatYen(total)}</strong></div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="app-shell">
      <div className="page">
        <header className="app-header">
          <div className="header-brand">
            <span className="brand-dot" />
            <h1>Estimate management</h1>
            <span className="brand-tag">見積管理アプリ</span>
          </div>
        </header>

        <section className="kpi-section">
          <div className="kpi-grid">
            <div className="kpi-card">
              <span className="kpi-label">見積総額</span>
              <strong className="kpi-value">{formatYen(1738000)}</strong>
              <span className="kpi-hint">提出済み見積の合計</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">成約金額</span>
              <strong className="kpi-value value-success">{formatYen(264000)}</strong>
              <span className="kpi-hint">成約済み案件の合計</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">請求済み</span>
              <strong className="kpi-value value-info">{formatYen(198000)}</strong>
              <span className="kpi-hint">請求処理済みの金額</span>
            </div>
            <div className="kpi-card kpi-card-alert">
              <span className="kpi-label">要フォロー</span>
              <strong className="kpi-value value-danger">2</strong>
              <span className="kpi-hint">10日以上返答待ちの案件</span>
            </div>
          </div>
        </section>

        <main className="main-stack">
          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="section-kicker">Dashboard</p>
                <h2>提出済みの見積一覧</h2>
              </div>
              <p className="section-copy">ステータスと経過日数を一覧で確認できます。</p>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>見積番号</th>
                    <th>取引先</th>
                    <th>案件名</th>
                    <th className="align-right">金額</th>
                    <th>ステータス</th>
                    <th>経過</th>
                    <th>提出日</th>
                  </tr>
                </thead>
                <tbody>
                  {QUOTES.map((quote) => {
                    const needsAttention = quote.status === 'Pending' && quote.waitingDays >= 10

                    return (
                      <tr key={quote.id} className={needsAttention ? 'row-alert' : undefined}>
                        <td>
                          <div className="row-number">
                            <span className={needsAttention ? 'dot dot-alert' : 'dot'} />
                            {quote.quoteNo}
                          </div>
                        </td>
                        <td>{quote.client}</td>
                        <td>{quote.project}</td>
                        <td className="align-right amount">{formatYen(quote.amount)}</td>
                        <td><StatusBadge status={quote.status} /></td>
                        <td className={needsAttention ? 'danger-text' : undefined}>
                          {quote.status === 'Pending' ? `${quote.waitingDays}日経過` : '対応完了'}
                        </td>
                        <td>{formatDate(quote.createdAt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel quote-panel">
            <div className="panel-head panel-head-actions">
              <div>
                <p className="section-kicker">Speed Quote</p>
                <h2>スピード見積入力</h2>
                <p className="section-copy">入力後にプレビューボタンで見積書を確認し、必要ならPDF化できます。</p>
              </div>
              <button className="btn-primary" onClick={() => setIsPreviewOpen(true)}>
                プレビュー
              </button>
            </div>

            <div className="form-grid">
              <div className="form-column">
                <div className="field-grid">
                  <label className="field">
                    <span>顧客名</span>
                    <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>案件名</span>
                    <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
                  </label>
                </div>

                <div>
                  <span className="field" style={{ marginBottom: 8, display: 'block' }}>
                    <span>見積明細</span>
                  </span>
                  <div className="form-table-wrap">
                    <table className="form-items-table">
                      <thead>
                        <tr>
                          <th style={{ width: 330 }}>品目</th>
                          <th style={{ width: 260 }}>単価</th>
                          <th style={{ width: 110 }}>数量</th>
                          <th className="align-right" style={{ width: 180 }}>金額</th>
                          <th style={{ width: 64 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {lineItems.map((row) => {
                          const item = ITEMS.find((i) => i.id === row.itemId) ?? ITEMS[0]
                          const rowTotal = row.unitPrice * row.quantity
                          return (
                            <tr key={row.id}>
                              <td>
                                <select
                                  className="form-table-select"
                                  value={row.itemId}
                                  onChange={(e) => handleLineItemChange(row.id, 'itemId', e.target.value)}
                                >
                                  {ITEMS.map((i) => (
                                    <option key={i.id} value={i.id}>{i.name}</option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <div className="table-input-addon">
                                  <input
                                    type="number"
                                    min={0}
                                    className="form-table-input"
                                    value={row.unitPrice}
                                    onChange={(e) =>
                                      handleLineItemChange(row.id, 'unitPrice', Math.max(0, Number(e.target.value) || 0))
                                    }
                                  />
                                  <span className="unit-label">円/{item.unit}</span>
                                </div>
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min={1}
                                  className="form-table-input"
                                  value={row.quantity}
                                  onChange={(e) =>
                                    handleLineItemChange(row.id, 'quantity', Math.max(1, Number(e.target.value) || 1))
                                  }
                                />
                              </td>
                              <td className="align-right amount">
                                {formatYen(rowTotal)}
                              </td>
                              <td>
                                <button
                                  className="btn-table-delete"
                                  onClick={() => removeRow(row.id)}
                                  title="行を削除"
                                  disabled={lineItems.length === 1}
                                >
                                  x
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <button className="btn-secondary btn-add-row" onClick={addRow}>
                    + 明細を追加
                  </button>
                </div>

                <label className="field field-textarea">
                  <span>メモ</span>
                  <textarea rows={4} value={memo} onChange={(e) => setMemo(e.target.value)} />
                </label>
              </div>

              <aside className="summary-column">
                <div className="summary-card">
                  <p className="summary-kicker">リアルタイム集計</p>
                  <div className="summary-row"><span>明細数</span><strong>{lineItems.length}</strong></div>
                  <div className="summary-row"><span>小計</span><strong>{formatYen(subtotal)}</strong></div>
                  <div className="summary-row"><span>消費税（10%）</span><strong>{formatYen(tax)}</strong></div>
                  <div className="summary-divider" />
                  <div className="summary-total"><span>合計</span><strong>{formatYen(total)}</strong></div>
                  <button className="btn-preview-on-card" onClick={() => setIsPreviewOpen(true)}>
                    見積書を確認
                  </button>
                </div>
              </aside>
            </div>
          </section>
        </main>
      </div>

      {isPreviewOpen && (
        <div className="modal-overlay" onMouseDown={() => setIsPreviewOpen(false)}>
          <div className="modal-window" role="dialog" aria-modal="true" aria-label="見積プレビュー" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-bar">
              <div>
                <p className="section-kicker">Preview</p>
                <h2>A4見積プレビュー</h2>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => window.print()}>
                  PDF化 / 印刷
                </button>
                <button className="btn-secondary" onClick={() => setIsPreviewOpen(false)}>
                  閉じる
                </button>
              </div>
            </div>
            <div className="paper-shell modal-paper-shell">
              {quotePreview}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
