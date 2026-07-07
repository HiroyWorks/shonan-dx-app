import React, { useMemo, useState } from 'react'
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

  return <span className={className[status]}>{status}</span>
}

function App() {
  const [clientName, setClientName] = useState('Minato Planning Co.')
  const [projectName, setProjectName] = useState('Corporate site estimate')
  const [memo, setMemo] = useState(
    'Estimate is valid for 30 days. Final adjustments will be made after requirements are fixed.',
  )
  const [lineItems, setLineItems] = useState<LineItem[]>([newLineItem()])

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
                <p className="section-copy">Add multiple line items. Changing item, price, or quantity updates the total and preview immediately.</p>
              </div>

              <div className="form-grid">
                <div className="form-column">
                  {/* 繧ｯ繝ｩ繧､繧｢繝ｳ繝医・繝励Ο繧ｸ繧ｧ繧ｯ繝・*/}
                  <div className="field-grid">
                    <label className="field">
                      <span>Client</span>
                      <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
                    </label>
                    <label className="field">
                      <span>Project</span>
                      <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
                    </label>
                  </div>

                  {/* Form section */}
                  <div>
                    <span className="field" style={{ marginBottom: 8, display: 'block' }}>
                      <span>Line items</span>
                    </span>
                    <div className="form-table-wrap">
                      <table className="form-items-table">
                        <thead>
                          <tr>
                            <th style={{ width: '36%' }}>Item</th>
                            <th style={{ width: '22%' }}>Unit price</th>
                            <th style={{ width: '14%' }}>Qty</th>
                            <th className="align-right" style={{ width: '20%' }}>Amount</th>
                            <th style={{ width: '8%' }}></th>
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
                                    <span className="unit-label">{item.unit}</span>
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
                                <td className="align-right amount" style={{ fontSize: '0.9rem' }}>
                                  {formatYen(rowTotal)}
                                </td>
                                <td>
                                  <button
                                    className="btn-table-delete"
                                    onClick={() => removeRow(row.id)}
                                    title="Delete row"
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
                      + Add line item
                    </button>
                  </div>

                  {/* Form section */}
                  <label className="field field-textarea">
                    <span>Memo</span>
                    <textarea rows={4} value={memo} onChange={(e) => setMemo(e.target.value)} />
                  </label>
                </div>

                <aside className="summary-column">
                  <div className="summary-card">
                    <p className="summary-kicker">Live Summary</p>
                    <div className="summary-row"><span>Lines</span><strong>{lineItems.length}</strong></div>
                    <div className="summary-row"><span>Subtotal</span><strong>{formatYen(subtotal)}</strong></div>
                    <div className="summary-row"><span>Tax (10%)</span><strong>{formatYen(tax)}</strong></div>
                    <div className="summary-divider" />
                    <div className="summary-total"><span>Total</span><strong>{formatYen(total)}</strong></div>
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
                      <thead><tr><th>Item</th><th className="align-right">Unit price</th><th className="align-right">Qty</th><th className="align-right">Amount</th></tr></thead>
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
                    <div className="paper-note"><p className="paper-small">Memo</p><p>{memo}</p></div>
                    <div className="paper-totals">
                      <div><span>Subtotal</span><strong>{formatYen(subtotal)}</strong></div>
                      <div><span>Tax (10%)</span><strong>{formatYen(tax)}</strong></div>
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
