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
  { id: 'site', name: 'Website build', category: 'Production', unitPrice: 180000, unit: 'project' },
  { id: 'lp', name: 'Landing page', category: 'Production', unitPrice: 120000, unit: 'project' },
  { id: 'maintenance', name: 'Maintenance', category: 'Monthly', unitPrice: 25000, unit: 'month' },
  { id: 'seo', name: 'SEO article', category: 'Content', unitPrice: 15000, unit: 'article' },
  { id: 'support', name: 'Support call', category: 'Support', unitPrice: 12000, unit: 'hour' },
  { id: 'photo', name: 'Photo direction', category: 'On-site', unitPrice: 80000, unit: 'session' },
]

const QUOTES: Quote[] = [
  {
    id: 'Q-2026-041',
    quoteNo: 'Q-2026-041',
    client: 'Shonan Bakery',
    project: 'New product site renewal',
    amount: 528000,
    status: 'Pending',
    createdAt: '2026-06-02',
    waitingDays: 11,
  },
  {
    id: 'Q-2026-038',
    quoteNo: 'Q-2026-038',
    client: 'Fujisawa Clinic',
    project: 'Recruitment LP',
    amount: 264000,
    status: 'Won',
    createdAt: '2026-05-28',
    waitingDays: 0,
  },
  {
    id: 'Q-2026-036',
    quoteNo: 'Q-2026-036',
    client: 'Kamakura Construction',
    project: 'Monthly maintenance',
    amount: 198000,
    status: 'Invoiced',
    createdAt: '2026-05-23',
    waitingDays: 0,
  },
  {
    id: 'Q-2026-034',
    quoteNo: 'Q-2026-034',
    client: 'Chigasaki Commerce',
    project: 'Corporate revamp',
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

function StatusBadge({ status }: { status: QuoteStatus }) {
  const className: Record<QuoteStatus, string> = {
    Pending: 'status-badge status-pending',
    Won: 'status-badge status-success',
    Invoiced: 'status-badge status-done',
  }

  return <span className={className[status]}>{status}</span>
}

function App() {
  const [selectedItemId, setSelectedItemId] = useState(ITEMS[0].id)
  const [clientName, setClientName] = useState('Minato Planning Co.')
  const [projectName, setProjectName] = useState('Corporate site estimate')
  const [quantity, setQuantity] = useState(3)
  const [manualUnitPrice, setManualUnitPrice] = useState(ITEMS[0].unitPrice)
  const [memo, setMemo] = useState(
    'Estimate is valid for 30 days. Final adjustments will be made after requirements are fixed.',
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
        <header className="app-header">
          <div className="header-brand">
            <span className="brand-dot" />
            <h1>Shonan Estimate</h1>
            <span className="brand-tag">Estimate management</span>
          </div>
        </header>

        <section className="kpi-section">
          <div className="kpi-grid">
            <div className="kpi-card">
              <span className="kpi-label">Pipeline total</span>
              <strong className="kpi-value">{formatYen(1738000)}</strong>
              <span className="kpi-hint">Submitted estimate total</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Won amount</span>
              <strong className="kpi-value value-success">{formatYen(264000)}</strong>
              <span className="kpi-hint">Confirmed projects</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Invoiced</span>
              <strong className="kpi-value value-info">{formatYen(198000)}</strong>
              <span className="kpi-hint">Already invoiced</span>
            </div>
            <div className="kpi-card kpi-card-alert">
              <span className="kpi-label">Needs follow-up</span>
              <strong className="kpi-value value-danger">2</strong>
              <span className="kpi-hint">Pending over 10 days</span>
            </div>
          </div>
        </section>

        <main className="content-grid">
          <section className="left-column">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="section-kicker">Dashboard</p>
                  <h2>Submitted quotes</h2>
                </div>
                <p className="section-copy">Status badges make the list easy to scan.</p>
              </div>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Quote No.</th>
                      <th>Client</th>
                      <th>Project</th>
                      <th className="align-right">Amount</th>
                      <th>Status</th>
                      <th>Waiting</th>
                      <th>Date</th>
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
                            {quote.status === 'Pending' ? `${quote.waitingDays} days` : 'Done'}
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
                  <p className="section-kicker">Speed Quote</p>
                  <h2>Fast estimate entry</h2>
                </div>
                <p className="section-copy">Changing item, price, or quantity updates the total and preview immediately.</p>
              </div>

              <div className="form-grid">
                <div className="form-column">
                  <div className="field-grid">
                    <label className="field">
                      <span>Client</span>
                      <input value={clientName} onChange={(event) => setClientName(event.target.value)} />
                    </label>
                    <label className="field">
                      <span>Project</span>
                      <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
                    </label>
                  </div>

                  <div className="field-grid item-grid">
                    <label className="field field-wide">
                      <span>Item</span>
                      <select value={selectedItemId} onChange={(event) => handleItemChange(event.target.value)}>
                        {ITEMS.map((item) => (
                          <option key={item.id} value={item.id}>{item.name} ({item.category})</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Qty</span>
                      <input type="number" min={1} value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} />
                    </label>
                  </div>

                  <div className="field-grid">
                    <label className="field">
                      <span>Unit price</span>
                      <div className="input-addon">
                        <input type="number" min={0} value={manualUnitPrice} onChange={(event) => setManualUnitPrice(Math.max(0, Number(event.target.value) || 0))} />
                        <span>JPY / {selectedItem.unit}</span>
                      </div>
                    </label>
                    <div className="selected-card">
                      <p className="mini-label">Selected item</p>
                      <strong>{selectedItem.name}</strong>
                      <span>{selectedItem.category} / {selectedItem.unit}</span>
                    </div>
                  </div>

                  <label className="field field-textarea">
                    <span>Memo</span>
                    <textarea rows={4} value={memo} onChange={(event) => setMemo(event.target.value)} />
                  </label>
                </div>

                <aside className="summary-column">
                  <div className="summary-card">
                    <p className="summary-kicker">Live Summary</p>
                    <div className="summary-row"><span>Subtotal</span><strong>{formatYen(subtotal)}</strong></div>
                    <div className="summary-row"><span>Tax</span><strong>{formatYen(tax)}</strong></div>
                    <div className="summary-divider" />
                    <div className="summary-total"><span>Total</span><strong>{formatYen(total)}</strong></div>
                    <div className="micro-grid">
                      <div><span>Unit price</span><strong>{formatYen(manualUnitPrice)}</strong></div>
                      <div><span>Qty</span><strong>{quantity}</strong></div>
                    </div>
                  </div>
                </aside>
              </div>
            </section>
          </section>

          <aside className="right-column">
            <section className="panel preview-panel">
              <div className="panel-head">
                <div>
                  <p className="section-kicker">Preview</p>
                  <h2>A4 quote preview</h2>
                </div>
              </div>

              <div className="paper-shell">
                <div className="paper">
                  <div className="paper-header">
                    <div>
                      <p className="paper-kicker">Estimate</p>
                      <h3>Quote</h3>
                      <p className="paper-sub">No. Q-2026-045</p>
                    </div>
                    <div className="paper-date"><span>Issued</span><strong>2026/06/25</strong></div>
                  </div>

                  <div className="paper-meta">
                    <div className="paper-box"><p className="paper-small">To</p><strong>{clientName}</strong><span>{projectName}</span></div>
                    <div className="paper-box"><p className="paper-small">From</p><strong>Freelancer</strong><span>Shonan area, Kanagawa</span><span>Tel. 000-0000-0000</span></div>
                  </div>

                  <div className="paper-table-wrap">
                    <table className="paper-table">
                      <thead><tr><th>Item</th><th className="align-right">Unit</th><th className="align-right">Qty</th><th className="align-right">Amount</th></tr></thead>
                      <tbody><tr><td><strong>{selectedItem.name}</strong><span>{selectedItem.category} / {selectedItem.unit}</span></td><td className="align-right">{formatYen(manualUnitPrice)}</td><td className="align-right">{quantity}</td><td className="align-right amount">{formatYen(subtotal)}</td></tr></tbody>
                    </table>
                  </div>

                  <div className="paper-bottom">
                    <div className="paper-note"><p className="paper-small">Memo</p><p>{memo}</p></div>
                    <div className="paper-totals">
                      <div><span>Subtotal</span><strong>{formatYen(subtotal)}</strong></div>
                      <div><span>Tax</span><strong>{formatYen(tax)}</strong></div>
                      <div className="total-line" />
                      <div className="grand-total"><span>Total</span><strong>{formatYen(total)}</strong></div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </aside>
        </main>
      </div>
    </div>
  )
}

export default App
