import { useMemo, useState } from 'react'
import './App.css'

type QuoteStatus = 'Pending' | 'Won' | 'Invoiced'

type Item = {
  id: string
  name: string
  category: string
  unitPrice: number
  unit: string
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
  { id: 'site', name: 'ウェブサイト制作', category: '制作', unitPrice: 180000, unit: '件' },
  { id: 'lp', name: 'ランディングページ', category: '制作', unitPrice: 120000, unit: '件' },
  { id: 'maintenance', name: 'メンテナンス', category: '月次', unitPrice: 25000, unit: 'ヶ月' },
  { id: 'seo', name: 'SEO記事', category: 'コンテンツ', unitPrice: 15000, unit: '記事' },
  { id: 'support', name: 'サポート対応', category: 'サポート', unitPrice: 12000, unit: '時間' },
  { id: 'photo', name: '写真ディレクション', category: '現場', unitPrice: 80000, unit: 'セッション' },
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
    client: '鎌倉建設',
    project: '月次メンテナンス',
    amount: 198000,
    status: 'Invoiced',
    createdAt: '2026-05-23',
    waitingDays: 0,
  },
  {
    id: 'Q-2026-034',
    quoteNo: 'Q-2026-034',
    client: '茅ヶ崎商工会',
    project: '法人サイトリニューアル',
    amount: 748000,
    status: 'Pending',
    createdAt: '2026-05-18',
    waitingDays: 26,
  },
]

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

const STATUS_LABEL: Record<QuoteStatus, string> = {
  Pending: '検討中',
  Won: '受注',
  Invoiced: '請求済',
}

function StatusBadge({ status }: { status: QuoteStatus }) {
  const className: Record<QuoteStatus, string> = {
    Pending: 'status-badge status-pending',
    Won: 'status-badge status-success',
    Invoiced: 'status-badge status-done',
  }

  return <span className={className[status]}>{STATUS_LABEL[status]}</span>
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      <p className="stat-hint">{hint}</p>
    </div>
  )
}

function App() {
  const [selectedItemId, setSelectedItemId] = useState(ITEMS[0].id)
  const [clientName, setClientName] = useState('湊企画株式会社')
  const [projectName, setProjectName] = useState('法人サイト見積')
  const [quantity, setQuantity] = useState(3)
  const [manualUnitPrice, setManualUnitPrice] = useState(ITEMS[0].unitPrice)
  const [memo, setMemo] = useState(
    '見積の有効期限は発行日より30日間です。要件確定後に最終調整を行います。',
  )

  const selectedItem = useMemo(
    () => ITEMS.find((item) => item.id === selectedItemId) ?? ITEMS[0],
    [selectedItemId],
  )

  const subtotal = manualUnitPrice * quantity
  const tax = Math.round(subtotal * 0.1)
  const total = subtotal + tax

  const handleItemChange = (nextItemId: string) => {
    const nextItem = ITEMS.find((item) => item.id === nextItemId) ?? ITEMS[0]
    setSelectedItemId(nextItemId)
    setManualUnitPrice(nextItem.unitPrice)
  }

  return (
    <div className="app-shell">
      <div className="page">
        <header className="hero-card">
          <div className="hero-main">
            <div className="eyebrow">
              <span className="eyebrow-dot" />
              見積管理アプリ
            </div>
            <h1>素早く、明確で、洗練された見積を。</h1>
            <p className="hero-copy">
              品目マスタから選んで単価・数量を調整するだけで、リアルタイムに合計が更新されます。左が入力フォーム、右がプレビュー、上部に全体のパイプラインを表示します。
            </p>

            <div className="stat-grid">
              <StatCard label="本日の新規" value="8" hint="モックデータを使用" />
              <StatCard label="検討中" value="2" hint="長期保留はアラート表示" />
              <StatCard label="受注率" value="42%" hint="一覧で進捗が一目でわかる" />
            </div>
          </div>

          <aside className="hero-side">
            <p className="mini-label">クイックヒント</p>
            <h2>日常業務に最適化</h2>
            <ul className="tip-list">
              <li>品目マスタから単価を自動入力</li>
              <li>小計・消費税・合計をリアルタイム更新</li>
              <li>提出済み見積にはステータスバッジを表示</li>
            </ul>
            <div className="mini-metrics">
              <div>
                <span>消費税率</span>
                <strong>10%</strong>
              </div>
              <div>
                <span>通貨</span>
                <strong>JPY</strong>
              </div>
            </div>
          </aside>
        </header>

        <main className="content-grid">
          <section className="left-column">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="section-kicker">ダッシュボード</p>
                  <h2>提出済み見積一覧</h2>
                </div>
                <p className="section-copy">
                  ステータスバッジで状況をすばやく確認できます。保留が長期化した案件には警告を表示します。
                </p>
              </div>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>見積番号</th>
                      <th>顧客</th>
                      <th>案件名</th>
                      <th className="align-right">金額</th>
                      <th>ステータス</th>
                      <th>待機日数</th>
                      <th>日付</th>
                    </tr>
                  </thead>
                  <tbody>
                    {QUOTES.map((quote) => {
                      const needsAttention =
                        quote.status === 'Pending' && quote.waitingDays >= 10

                      return (
                        <tr
                          key={quote.id}
                          className={needsAttention ? 'row-alert' : undefined}
                        >
                          <td>
                            <div className="row-number">
                              <span
                                className={needsAttention ? 'dot dot-alert' : 'dot'}
                              />
                              {quote.quoteNo}
                            </div>
                          </td>
                          <td>{quote.client}</td>
                          <td>{quote.project}</td>
                          <td className="align-right amount">{formatYen(quote.amount)}</td>
                          <td>
                            <StatusBadge status={quote.status} />
                          </td>
                          <td className={needsAttention ? 'danger-text' : undefined}>
                            {quote.status === 'Pending'
                              ? `${quote.waitingDays}日`
                              : '完了'}
                          </td>
                          <td>{formatDate(quote.createdAt)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="section-kicker">スピード見積</p>
                  <h2>見積の素早い入力</h2>
                </div>
                <p className="section-copy">
                  顧客名・案件名・品目・単価・数量を入力してください。品目を変えると単価が自動入力され、プレビューが即時更新されます。
                </p>
              </div>

              <div className="form-grid">
                <div className="form-column">
                  <div className="field-grid">
                    <label className="field">
                      <span>顧客名</span>
                      <input
                        value={clientName}
                        onChange={(event) => setClientName(event.target.value)}
                        placeholder="会社名"
                      />
                    </label>

                    <label className="field">
                      <span>案件名</span>
                      <input
                        value={projectName}
                        onChange={(event) => setProjectName(event.target.value)}
                        placeholder="見積タイトル"
                      />
                    </label>
                  </div>

                  <div className="field-grid item-grid">
                    <label className="field field-wide">
                      <span>品目</span>
                      <select
                        value={selectedItemId}
                        onChange={(event) => handleItemChange(event.target.value)}
                      >
                        {ITEMS.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}（{item.category}）
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>数量</span>
                      <input
                        type="number"
                        min={1}
                        value={quantity}
                        onChange={(event) =>
                          setQuantity(Math.max(1, Number(event.target.value) || 1))
                        }
                      />
                    </label>
                  </div>

                  <div className="field-grid">
                    <label className="field">
                      <span>単価</span>
                      <div className="input-addon">
                        <input
                          type="number"
                          min={0}
                          value={manualUnitPrice}
                          onChange={(event) =>
                            setManualUnitPrice(Math.max(0, Number(event.target.value) || 0))
                          }
                        />
                        <span>円 / {selectedItem.unit}</span>
                      </div>
                    </label>

                    <div className="selected-card">
                      <p className="mini-label">選択中の品目</p>
                      <strong>{selectedItem.name}</strong>
                      <span>
                        {selectedItem.category} / {selectedItem.unit}
                      </span>
                    </div>
                  </div>

                  <label className="field field-textarea">
                    <span>メモ</span>
                    <textarea
                      rows={4}
                      value={memo}
                      onChange={(event) => setMemo(event.target.value)}
                    />
                  </label>
                </div>

                <aside className="summary-column">
                  <div className="summary-card">
                    <p className="summary-kicker">リアルタイムサマリー</p>
                    <div className="summary-row">
                      <span>小計</span>
                      <strong>{formatYen(subtotal)}</strong>
                    </div>
                    <div className="summary-row">
                      <span>消費税（10%）</span>
                      <strong>{formatYen(tax)}</strong>
                    </div>
                    <div className="summary-divider" />
                    <div className="summary-total">
                      <span>合計</span>
                      <strong>{formatYen(total)}</strong>
                    </div>

                    <div className="micro-grid">
                      <div>
                        <span>単価</span>
                        <strong>{formatYen(manualUnitPrice)}</strong>
                      </div>
                      <div>
                        <span>数量</span>
                        <strong>{quantity}</strong>
                      </div>
                    </div>

                    <p className="summary-note">
                      単価・数量を変えると即時プレビューが更新されます。
                    </p>
                  </div>
                </aside>
              </div>
            </section>
          </section>

          <aside className="right-column">
            <section className="panel preview-panel">
              <div className="panel-head">
                <div>
                  <p className="section-kicker">プレビュー</p>
                  <h2>A4見積書プレビュー</h2>
                </div>
                <p className="section-copy">
                  印刷対応の請求書・見積書を参考にした、読みやすいドキュメントレイアウト。
                </p>
              </div>

              <div className="paper-shell">
                <div className="paper">
                  <div className="paper-header">
                    <div>
                      <p className="paper-kicker">見積書</p>
                      <h3>御見積書</h3>
                      <p className="paper-sub">番号: Q-2026-045</p>
                    </div>
                    <div className="paper-date">
                      <span>発行日</span>
                      <strong>2026/06/13</strong>
                    </div>
                  </div>

                  <div className="paper-meta">
                    <div className="paper-box">
                      <p className="paper-small">宛先</p>
                      <strong>{clientName}</strong>
                      <span>{projectName}</span>
                    </div>
                    <div className="paper-box">
                      <p className="paper-small">差出人</p>
                      <strong>フリーランサー</strong>
                      <span>担当: 山田 太郎</span>
                      <span>神奈川県 湘南エリア</span>
                      <span>Tel. 000-0000-0000</span>
                    </div>
                  </div>

                  <div className="paper-table-wrap">
                    <table className="paper-table">
                      <thead>
                        <tr>
                          <th>品目</th>
                          <th className="align-right">単価</th>
                          <th className="align-right">数量</th>
                          <th className="align-right">金額</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>
                            <strong>{selectedItem.name}</strong>
                            <span>
                              {selectedItem.category} / {selectedItem.unit}
                            </span>
                          </td>
                          <td className="align-right">{formatYen(manualUnitPrice)}</td>
                          <td className="align-right">{quantity}</td>
                          <td className="align-right amount">{formatYen(subtotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="paper-bottom">
                    <div className="paper-note">
                      <p className="paper-small">メモ</p>
                      <p>{memo}</p>
                    </div>
                    <div className="paper-totals">
                      <div>
                        <span>小計</span>
                        <strong>{formatYen(subtotal)}</strong>
                      </div>
                      <div>
                        <span>消費税（10%）</span>
                        <strong>{formatYen(tax)}</strong>
                      </div>
                      <div className="total-line" />
                      <div className="grand-total">
                        <span>合計金額</span>
                        <strong>{formatYen(total)}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="paper-footer">
                    <span>見積有効期限: 発行日より30日間</span>
                    <span>作成者: 山田 太郎</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="section-kicker">マスタデータ</p>
                  <h2>品目マスタ</h2>
                </div>
                <p className="section-copy">品目をクリックすると単価がフォームに自動入力されます。</p>
              </div>

              <div className="master-list">
                {ITEMS.map((item) => {
                  const active = item.id === selectedItemId
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleItemChange(item.id)}
                      className={active ? 'master-item active' : 'master-item'}
                    >
                      <div>
                        <div className="master-title">
                          <strong>{item.name}</strong>
                          <span>{item.category}</span>
                        </div>
                        <p>クリックで単価を読み込む</p>
                      </div>
                      <div className="master-price">
                        <strong>{formatYen(item.unitPrice)}</strong>
                        <span>/{item.unit}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          </aside>
        </main>
      </div>
    </div>
  )
}

export default App
