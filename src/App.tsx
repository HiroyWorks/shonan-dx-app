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

type QuoteLineItem = {
  itemId: string
  quantity: number
  unitPrice?: number
}

type InteractionNote = {
  id: string
  body: string
  createdAt: string
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
  memo: string
  lineItems: QuoteLineItem[]
  updatedAt?: string
  notes?: InteractionNote[]
}

type PreviewLineItem = {
  id: string
  name: string
  category: string
  unit: string
  quantity: number
  unitPrice: number
}

type PreviewQuote = {
  quoteNo: string
  issuedAt: string
  client: string
  project: string
  memo: string
  rows: PreviewLineItem[]
}

const ITEMS: Item[] = [
  { id: 'site', name: 'Webサイト制作', category: '制作', unitPrice: 180000, unit: '式' },
  { id: 'lp', name: 'ランディングページ制作', category: '制作', unitPrice: 120000, unit: '式' },
  { id: 'maintenance', name: '保守運用', category: '月額', unitPrice: 25000, unit: '月' },
  { id: 'seo', name: 'SEO記事作成', category: 'コンテンツ', unitPrice: 15000, unit: '本' },
  { id: 'support', name: '操作レクチャー', category: 'サポート', unitPrice: 12000, unit: '時間' },
  { id: 'photo', name: '撮影ディレクション', category: '現場', unitPrice: 80000, unit: '回' },
]

const INITIAL_QUOTES: Quote[] = [
  {
    id: 'Q-2026-041',
    quoteNo: 'Q-2026-041',
    client: '湘南ベーカリー',
    project: '新商品サイトリニューアル',
    amount: 528000,
    status: 'Pending',
    createdAt: '2026-06-02',
    waitingDays: 11,
    memo: '商品撮影素材のご提供後、下層ページ構成を確定します。',
    updatedAt: '2026-06-13',
    notes: [
      { id: 'note-q041-2', body: '先方より商品写真の差し替え希望あり。素材は6/14共有予定。', createdAt: '2026-06-13T09:30:00.000Z' },
      { id: 'note-q041-1', body: '見積送付済み。トップページの構成案も合わせて確認依頼。', createdAt: '2026-06-02T06:20:00.000Z' },
    ],
    lineItems: [
      { itemId: 'site', quantity: 2 },
      { itemId: 'lp', quantity: 1 },
    ],
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
    memo: '公開後2週間の軽微な文言修正を含みます。',
    updatedAt: '2026-05-30',
    notes: [
      { id: 'note-q038-1', body: '成約連絡あり。初回ヒアリング日程を調整中。', createdAt: '2026-05-30T02:15:00.000Z' },
    ],
    lineItems: [
      { itemId: 'lp', quantity: 2 },
    ],
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
    memo: '月次レポートと軽微な更新作業を含む6か月分の保守費用です。',
    updatedAt: '2026-05-25',
    notes: [
      { id: 'note-q036-1', body: '請求書送付済み。翌月から月次レポートを開始。', createdAt: '2026-05-25T04:40:00.000Z' },
    ],
    lineItems: [
      { itemId: 'maintenance', quantity: 6 },
      { itemId: 'seo', quantity: 2 },
    ],
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
    memo: '既存CMSの調査後、必要に応じて実装範囲を再調整します。',
    updatedAt: '2026-06-08',
    notes: [
      { id: 'note-q034-2', body: '再確認メール送付。CMSログイン情報の共有待ち。', createdAt: '2026-06-08T01:10:00.000Z' },
      { id: 'note-q034-1', body: '既存サイト改修範囲について先方確認中。', createdAt: '2026-05-20T08:00:00.000Z' },
    ],
    lineItems: [
      { itemId: 'site', quantity: 2 },
      { itemId: 'photo', quantity: 1 },
      { itemId: 'support', quantity: 20 },
    ],
  },
]

const QUOTES_STORAGE_KEY = 'estimate-management-quotes'

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

const dateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const formatYen = (value: number) => yen.format(value)
const formatDate = (value: string) => dateFormat.format(new Date(value))
const formatDateTime = (value: string) => dateTimeFormat.format(new Date(value))

const findItem = (itemId: string) => ITEMS.find((item) => item.id === itemId) ?? ITEMS[0]
const calcSubtotal = (rows: PreviewLineItem[]) => rows.reduce((sum, row) => sum + row.unitPrice * row.quantity, 0)

const toLocalDateString = (date = new Date()) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const toLocalDateTimeString = () => new Date().toISOString()

const getNextQuoteNo = (quotes: Quote[]) => {
  const year = new Date().getFullYear()
  const prefix = `Q-${year}-`
  const maxSequence = quotes.reduce((max, quote) => {
    if (!quote.quoteNo.startsWith(prefix)) return max
    const sequence = Number(quote.quoteNo.slice(prefix.length))
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max
  }, 0)

  return `${prefix}${String(maxSequence + 1).padStart(3, '0')}`
}

const normalizeQuotes = (quotes: Quote[]) => quotes.map((quote) => ({
  ...quote,
  updatedAt: quote.updatedAt ?? quote.createdAt,
  notes: quote.notes ?? [],
}))

const loadInitialQuotes = () => {
  if (typeof window === 'undefined') return normalizeQuotes(INITIAL_QUOTES)

  try {
    const stored = window.localStorage.getItem(QUOTES_STORAGE_KEY)
    if (!stored) return normalizeQuotes(INITIAL_QUOTES)
    const parsed = JSON.parse(stored) as Quote[]
    return Array.isArray(parsed) ? normalizeQuotes(parsed) : normalizeQuotes(INITIAL_QUOTES)
  } catch {
    return normalizeQuotes(INITIAL_QUOTES)
  }
}

let nextId = 1
const newLineItem = (itemId: string = ITEMS[0].id): LineItem => {
  const item = findItem(itemId)
  return { id: String(nextId++), itemId: item.id, quantity: 1, unitPrice: item.unitPrice }
}

const quoteToPreview = (quote: Quote): PreviewQuote => ({
  quoteNo: quote.quoteNo,
  issuedAt: formatDate(quote.createdAt),
  client: quote.client,
  project: quote.project,
  memo: quote.memo,
  rows: quote.lineItems.map((row, index) => {
    const item = findItem(row.itemId)
    return {
      id: `${quote.id}-${index}`,
      name: item.name,
      category: item.category,
      unit: item.unit,
      quantity: row.quantity,
      unitPrice: row.unitPrice ?? item.unitPrice,
    }
  }),
})

function StatusBadge({ status }: { status: QuoteStatus }) {
  const className: Record<QuoteStatus, string> = {
    Pending: 'status-badge status-pending',
    Won: 'status-badge status-success',
    Invoiced: 'status-badge status-done',
  }

  return <span className={className[status]}>{statusLabels[status]}</span>
}

function QuotePreview({ preview }: { preview: PreviewQuote }) {
  const previewSubtotal = calcSubtotal(preview.rows)
  const previewTax = Math.round(previewSubtotal * 0.1)
  const previewTotal = previewSubtotal + previewTax

  return (
    <div className="paper">
      <div className="paper-header">
        <div>
          <p className="paper-kicker">Estimate</p>
          <h3>見積書</h3>
          <p className="paper-sub">No. {preview.quoteNo}</p>
        </div>
        <div className="paper-date"><span>発行日</span><strong>{preview.issuedAt}</strong></div>
      </div>

      <div className="paper-meta">
        <div className="paper-box"><p className="paper-small">宛先</p><strong>{preview.client}</strong><span>{preview.project}</span></div>
        <div className="paper-box"><p className="paper-small">差出人</p><strong>個人事業主</strong><span>神奈川県湘南エリア</span><span>Tel. 000-0000-0000</span></div>
      </div>

      <div className="paper-table-wrap">
        <table className="paper-table">
          <thead><tr><th>品目</th><th className="align-right">単価</th><th className="align-right">数量</th><th className="align-right">金額</th></tr></thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.name}</strong>
                  <span>{row.category} / {row.unit}</span>
                </td>
                <td className="align-right">{formatYen(row.unitPrice)}</td>
                <td className="align-right">{row.quantity}</td>
                <td className="align-right amount">{formatYen(row.unitPrice * row.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="paper-bottom">
        <div className="paper-note"><p className="paper-small">備考</p><p>{preview.memo}</p></div>
        <div className="paper-totals">
          <div><span>小計</span><strong>{formatYen(previewSubtotal)}</strong></div>
          <div><span>消費税（10%）</span><strong>{formatYen(previewTax)}</strong></div>
          <div className="total-line" />
          <div className="grand-total"><span>合計</span><strong>{formatYen(previewTotal)}</strong></div>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [quotes, setQuotes] = useState<Quote[]>(loadInitialQuotes)
  const [clientName, setClientName] = useState('株式会社みなと企画')
  const [projectName, setProjectName] = useState('コーポレートサイト見積')
  const [memo, setMemo] = useState('見積有効期限は30日です。要件確定後に最終調整いたします。')
  const [lineItems, setLineItems] = useState<LineItem[]>([newLineItem()])
  const [previewQuote, setPreviewQuote] = useState<PreviewQuote | null>(null)
  const [noteModalQuoteId, setNoteModalQuoteId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [submitMessage, setSubmitMessage] = useState('')

  useEffect(() => {
    window.localStorage.setItem(QUOTES_STORAGE_KEY, JSON.stringify(quotes))
  }, [quotes])

  useEffect(() => {
    if (!previewQuote && !noteModalQuoteId) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (noteModalQuoteId) setNoteModalQuoteId(null)
      else setPreviewQuote(null)
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [previewQuote, noteModalQuoteId])

  const handleLineItemChange = (id: string, field: keyof LineItem, value: string | number) => {
    setLineItems((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row
        if (field === 'itemId') {
          const item = findItem(String(value))
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

  const draftRows = useMemo(
    () => lineItems.map((row) => {
      const item = findItem(row.itemId)
      return {
        id: row.id,
        name: item.name,
        category: item.category,
        unit: item.unit,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
      }
    }),
    [lineItems],
  )
  const subtotal = useMemo(() => calcSubtotal(draftRows), [draftRows])
  const tax = Math.round(subtotal * 0.1)
  const total = subtotal + tax
  const activeNoteQuote = useMemo(
    () => quotes.find((quote) => quote.id === noteModalQuoteId) ?? null,
    [noteModalQuoteId, quotes],
  )
  const nextQuoteNo = useMemo(() => getNextQuoteNo(quotes), [quotes])
  const quoteStats = useMemo(() => ({
    pipelineTotal: quotes.reduce((sum, quote) => sum + quote.amount, 0),
    wonAmount: quotes.filter((quote) => quote.status === 'Won').reduce((sum, quote) => sum + quote.amount, 0),
    invoicedAmount: quotes.filter((quote) => quote.status === 'Invoiced').reduce((sum, quote) => sum + quote.amount, 0),
    needsFollowUp: quotes.filter((quote) => quote.status === 'Pending' && quote.waitingDays >= 10).length,
  }), [quotes])

  const openDraftPreview = () => {
    const today = toLocalDateString()
    setPreviewQuote({
      quoteNo: nextQuoteNo,
      issuedAt: formatDate(today),
      client: clientName,
      project: projectName,
      memo,
      rows: draftRows,
    })
  }

  const handleSubmitQuote = () => {
    const trimmedClient = clientName.trim()
    const trimmedProject = projectName.trim()
    if (!trimmedClient || !trimmedProject) {
      setSubmitMessage('顧客名と案件名を入力してください。')
      return
    }

    const today = toLocalDateString()
    const submittedQuote: Quote = {
      id: `${nextQuoteNo}-${Date.now()}`,
      quoteNo: nextQuoteNo,
      client: trimmedClient,
      project: trimmedProject,
      amount: total,
      status: 'Pending',
      createdAt: today,
      waitingDays: 0,
      memo,
      lineItems: lineItems.map((row) => ({
        itemId: row.itemId,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
      })),
      updatedAt: today,
      notes: [],
    }

    setQuotes((prev) => [submittedQuote, ...prev])
    setSubmitMessage(`${nextQuoteNo} を提出済み一覧に追加しました。`)
  }

  const handleStatusChange = (quoteId: string, status: QuoteStatus) => {
    const today = toLocalDateString()
    setQuotes((prev) => prev.map((quote) => (
      quote.id === quoteId
        ? { ...quote, status, waitingDays: status === 'Pending' ? quote.waitingDays : 0, updatedAt: today }
        : quote
    )))
  }

  const handleDeleteQuote = (quoteId: string) => {
    const target = quotes.find((quote) => quote.id === quoteId)
    if (!target) return
    if (!window.confirm(`${target.quoteNo} を削除しますか？`)) return

    setQuotes((prev) => prev.filter((quote) => quote.id !== quoteId))
    if (noteModalQuoteId === quoteId) setNoteModalQuoteId(null)
    setSubmitMessage(`${target.quoteNo} を削除しました。`)
  }

  const openNoteModal = (quoteId: string) => {
    setNoteModalQuoteId(quoteId)
    setNoteDraft('')
  }

  const handleAddNote = () => {
    const body = noteDraft.trim()
    if (!activeNoteQuote || !body) return

    const now = toLocalDateTimeString()
    const today = toLocalDateString()
    const note: InteractionNote = {
      id: `${activeNoteQuote.id}-note-${Date.now()}`,
      body,
      createdAt: now,
    }

    setQuotes((prev) => prev.map((quote) => (
      quote.id === activeNoteQuote.id
        ? { ...quote, notes: [note, ...(quote.notes ?? [])], updatedAt: today }
        : quote
    )))
    setNoteDraft('')
  }

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
              <strong className="kpi-value">{formatYen(quoteStats.pipelineTotal)}</strong>
              <span className="kpi-hint">提出済み見積の合計</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">成約金額</span>
              <strong className="kpi-value value-success">{formatYen(quoteStats.wonAmount)}</strong>
              <span className="kpi-hint">成約済み案件の合計</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">請求済み</span>
              <strong className="kpi-value value-info">{formatYen(quoteStats.invoicedAmount)}</strong>
              <span className="kpi-hint">請求処理済みの金額</span>
            </div>
            <div className="kpi-card kpi-card-alert">
              <span className="kpi-label">要フォロー</span>
              <strong className="kpi-value value-danger">{quoteStats.needsFollowUp}</strong>
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
              <table className="data-table quote-history-table">
                <thead>
                  <tr>
                    <th>見積番号</th>
                    <th>取引先</th>
                    <th>案件名</th>
                    <th className="align-right">金額</th>
                    <th>ステータス</th>
                    <th>経過</th>
                    <th>提出日</th>
                    <th>更新日</th>
                    <th className="align-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => {
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
                        <td>
                          <div className="status-control">
                            <StatusBadge status={quote.status} />
                            <select
                              className="status-select"
                              value={quote.status}
                              onChange={(event) => handleStatusChange(quote.id, event.target.value as QuoteStatus)}
                              aria-label={`${quote.quoteNo} のステータス`}
                            >
                              <option value="Pending">返答待ち</option>
                              <option value="Won">成約</option>
                              <option value="Invoiced">請求済</option>
                            </select>
                          </div>
                        </td>
                        <td className={needsAttention ? 'danger-text' : undefined}>
                          {quote.status === 'Pending' ? `${quote.waitingDays}日経過` : '対応完了'}
                        </td>
                        <td>{formatDate(quote.createdAt)}</td>
                        <td>{formatDate(quote.updatedAt ?? quote.createdAt)}</td>
                        <td className="align-right">
                          <div className="table-actions">
                            <button className="btn-table-preview" onClick={() => setPreviewQuote(quoteToPreview(quote))}>
                              プレビュー
                            </button>
                            <button className="btn-table-note" onClick={() => openNoteModal(quote.id)}>
                              メモ{quote.notes?.length ? ` ${quote.notes.length}` : ''}
                            </button>
                            <button className="btn-table-danger" onClick={() => handleDeleteQuote(quote.id)}>
                              削除
                            </button>
                          </div>
                        </td>
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
                <h2>見積入力</h2>
              </div>
              <div className="quote-actions">
                <button className="btn-secondary" onClick={openDraftPreview}>
                  プレビュー
                </button>
                <button className="btn-primary" onClick={handleSubmitQuote}>
                  提出
                </button>
              </div>
            </div>

            {submitMessage && <div className="submit-message">{submitMessage}</div>}

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
                          const item = findItem(row.itemId)
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
                  <div className="line-item-footer">
                    <button className="btn-secondary btn-add-row" onClick={addRow}>
                      + 明細を追加
                    </button>
                    <div className="inline-summary-card">
                      <div className="inline-summary-head">
                        <span>リアルタイム集計</span>
                        <strong>{formatYen(total)}</strong>
                      </div>
                      <div className="inline-summary-breakdown">
                        <span>明細 {lineItems.length}</span>
                        <span>小計 {formatYen(subtotal)}</span>
                        <span>税 {formatYen(tax)}</span>
                      </div>
                      <div className="inline-summary-actions">
                        <button className="btn-secondary" onClick={openDraftPreview}>見積書を確認</button>
                        <button className="btn-primary" onClick={handleSubmitQuote}>提出する</button>
                      </div>
                    </div>
                  </div>
                </div>

                <label className="field field-textarea">
                  <span>メモ</span>
                  <textarea rows={4} value={memo} onChange={(e) => setMemo(e.target.value)} />
                </label>
              </div>

            </div>
          </section>
        </main>
      </div>

      {activeNoteQuote && (
        <div className="modal-overlay" onMouseDown={() => setNoteModalQuoteId(null)}>
          <div className="modal-window note-modal" role="dialog" aria-modal="true" aria-label="顧客やり取りメモ" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-bar">
              <div>
                <p className="section-kicker">Client Memo</p>
                <h2>顧客やり取りメモ</h2>
                <p className="modal-subtitle">{activeNoteQuote.quoteNo} / {activeNoteQuote.client} / {activeNoteQuote.project}</p>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setNoteModalQuoteId(null)}>
                  閉じる
                </button>
              </div>
            </div>

            <div className="note-modal-body">
              <div className="note-meta-grid">
                <div>
                  <span>ステータス</span>
                  <strong>{statusLabels[activeNoteQuote.status]}</strong>
                </div>
                <div>
                  <span>提出日</span>
                  <strong>{formatDate(activeNoteQuote.createdAt)}</strong>
                </div>
                <div>
                  <span>最終更新日</span>
                  <strong>{formatDate(activeNoteQuote.updatedAt ?? activeNoteQuote.createdAt)}</strong>
                </div>
              </div>

              <label className="field note-compose">
                <span>新しいメモ</span>
                <textarea
                  rows={4}
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder="例: 先方から金額確認の連絡あり。来週火曜までに再提案予定。"
                />
              </label>
              <div className="note-compose-actions">
                <button className="btn-primary" onClick={handleAddNote} disabled={!noteDraft.trim()}>
                  メモを追加
                </button>
              </div>

              <div className="note-history-head">
                <h3>過去のメモ</h3>
                <span>{activeNoteQuote.notes?.length ?? 0}件</span>
              </div>

              <div className="note-history-list">
                {(activeNoteQuote.notes?.length ?? 0) === 0 ? (
                  <p className="empty-note">まだ顧客やり取りメモはありません。</p>
                ) : (
                  activeNoteQuote.notes?.map((note) => (
                    <article className="note-history-item" key={note.id}>
                      <time>{formatDateTime(note.createdAt)}</time>
                      <p>{note.body}</p>
                    </article>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {previewQuote && (
        <div className="modal-overlay" onMouseDown={() => setPreviewQuote(null)}>
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
                <button className="btn-secondary" onClick={() => setPreviewQuote(null)}>
                  閉じる
                </button>
              </div>
            </div>
            <div className="paper-shell modal-paper-shell">
              <QuotePreview preview={previewQuote} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
