import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadTs } from './load-ts.mjs'

const { totals, lineAmount, isValidLine } = loadTs('src/lib/money.ts')
const { parseInvoiceSnapshot } = loadTs('src/lib/invoiceSnapshot.ts')
const PreviewPaper = loadTs('src/components/PreviewPaper.tsx').default
const line = { name: '制作', unit: '式', unitPrice: 101, quantity: 1.4, taxKind: 'taxable' }

test('integer-yen line rounding, fractional quantities and tax rounding', () => {
  assert.deepEqual(totals([line], 10), { sub: 141, taxable: 141, tax: 14, total: 155 })
  assert.equal(lineAmount({ ...line, unitPrice: 100, quantity: 0.29 }), 29)
  assert.equal(lineAmount({ ...line, unitPrice: 101, quantity: 0.5 }), 51)
  assert.equal(isValidLine({ ...line, quantity: 0.5 }), true)
  assert.equal(isValidLine({ ...line, quantity: 1.001 }), false)
  assert.equal(isValidLine({ ...line, unitPrice: 1.5 }), false)
  assert.equal(isValidLine({ ...line, quantity: Infinity }), false)
  assert.equal(totals([{ ...line, unitPrice: 5, quantity: 1 }, { ...line, unitPrice: 5, quantity: 1 }], 10).tax, 1)
  assert.equal(totals([{ ...line, taxKind: 'exempt' }], 10).tax, 0)
})

const snapshot = {
  version: 1, issuerName: '発行時の会社', issuerOrganization: '営業部', registrationNo: 'T1234567890123',
  customerName: '発行時の顧客', customerAddress: '神奈川県', project: '発行時の案件', memo: '原本の備考',
  quoteNo: 'Q-2026-001', taxRate: 10,
  lines: [{ ...line, unitPrice: 10000, quantity: 1, amount: 10000 }],
  totals: { sub: 10000, taxable: 10000, tax: 1000, total: 11000 },
}
const quote = { id: 'q', quoteNo: 'Q-2026-001', customerName: '変更後の顧客', project: '変更後の案件',
  memo: '変更後の備考', lines: [{ ...line, unitPrice: 1, quantity: 1 }], amount: 11000, createdAt: '2026-09-01T00:00:00Z', taxRate: 8 }
const invoice = { id: 'i', invoiceNo: 'INV-2026-001', quoteId: 'q', amount: 11000, createdAt: '2026-09-01T00:00:00Z', snapshot, dueDate: '2026-09-30', bankDetails: '発行時の振込先' }
const props = { taxRate: 8, invoiceRegistrationNo: '変更後の番号', issuerName: '変更後の会社', issuerOrganization: '変更後の部門' }

test('issued invoice renders its snapshot, independent of current quote and settings', () => {
  const html = renderToStaticMarkup(createElement(PreviewPaper, { ...props, target: { kind: 'invoice', quote, invoice } }))
  for (const expected of ['発行時の会社', '発行時の顧客', '発行時の案件', '原本の備考', '11,000', '消費税（10%）', 'T1234567890123', '2026-09-30', '発行時の振込先']) assert.ok(html.includes(expected), expected)
  for (const forbidden of ['変更後', '10,800', '湘南DX合同会社']) assert.ok(!html.includes(forbidden), forbidden)
})

test('historical/malformed invoice cannot be reconstructed from current data', () => {
  assert.equal(parseInvoiceSnapshot(null, 11000), null)
  assert.equal(parseInvoiceSnapshot(snapshot, 10800), null)
  assert.equal(parseInvoiceSnapshot({ ...snapshot, totals: { ...snapshot.totals, tax: 800 } }, 11000), null)
  const html = renderToStaticMarkup(createElement(PreviewPaper, { ...props, target: { kind: 'invoice', quote, invoice: { ...invoice, snapshot: null } } }))
  assert.ok(html.includes('発行時の内容確認が必要'))
  assert.ok(!html.includes('paper-table'))
  assert.ok(html.includes('11,000'))
})

test('quote preview uses saved tax and actual issuer; legacy quote requests review', () => {
  const target = { kind: 'quote', quote: { ...quote, taxRate: 10, lines: snapshot.lines } }
  const html = renderToStaticMarkup(createElement(PreviewPaper, { ...props, target }))
  assert.ok(html.includes('11,000'))
  assert.ok(html.includes('変更後の会社'))
  const legacy = renderToStaticMarkup(createElement(PreviewPaper, { ...props, target: { kind: 'quote', quote: { ...quote, taxRate: null } } }))
  assert.ok(legacy.includes('見積の税率確認が必要'))
})

test('invoice template matches the six-column Excel layout with thirteen detail rows', () => {
  const html = renderToStaticMarkup(createElement(PreviewPaper, { ...props, target: { kind: 'invoice', quote, invoice } }))
  for (const label of ['請　求　書', '摘要', '数量', '単位', '単価', '税率', '金額', '請求日', '税率別内訳', '税抜金額', '消費税額', '税込']) assert.ok(html.includes(label), label)
  assert.equal((html.match(/class="invoice-empty-row"/g) || []).length, 12)
  assert.ok(!html.includes('paper-box'))
  assert.ok(!html.includes('サンプル'))
  assert.ok(!html.includes('TEL：'))
  const quoteHtml = renderToStaticMarkup(createElement(PreviewPaper, { ...props, target: { kind: 'quote', quote } }))
  assert.ok(quoteHtml.includes('paper-table'))
  assert.ok(!quoteHtml.includes('invoice-grid'))
})

test('invoice template retains every line beyond the reference thirteen rows and escapes text', () => {
  const lines = Array.from({ length: 30 }, (_, index) => ({ ...snapshot.lines[0], name: `明細${index + 1}<script>`, quantity: 0.5, amount: 5000 }))
  const total = totals(lines, 10)
  const longInvoice = { ...invoice, amount: total.total, snapshot: { ...snapshot, lines, totals: total } }
  const html = renderToStaticMarkup(createElement(PreviewPaper, { ...props, target: { kind: 'invoice', quote, invoice: longInvoice } }))
  assert.ok(html.includes('明細30&lt;script&gt;'))
  assert.ok(html.includes('165,000'))
  assert.ok(!html.includes('invoice-empty-row'))
  assert.ok(!html.includes('<script>'))
})

test('invoice tax breakdown distinguishes exempt from taxable zero and respects saved rate', () => {
  const lines = [snapshot.lines[0], { ...snapshot.lines[0], name: '非課税品目', taxKind: 'exempt', amount: 3000, unitPrice: 3000 }]
  for (const rate of [0, 8, 10, 12.5]) {
    const total = totals(lines, rate)
    const taxInvoice = { ...invoice, amount: total.total, snapshot: { ...snapshot, taxRate: rate, lines, totals: total } }
    const html = renderToStaticMarkup(createElement(PreviewPaper, { ...props, target: { kind: 'invoice', quote, invoice: taxInvoice } }))
    assert.ok(html.includes(`<th scope="row">${rate}%対象</th><td>10,000</td><td>${new Intl.NumberFormat('ja-JP').format(total.tax)}</td>`))
    assert.ok(html.includes('<th scope="row">非課税対象</th><td>3,000</td><td>0</td>'))
    assert.ok(!html.includes('軽減')) // A historical 8% rate does not establish reduced-rate eligibility.
  }
})

test('invoice issue date uses Japan time independently of the viewer time zone', () => {
  const html = renderToStaticMarkup(createElement(PreviewPaper, { ...props, target: { kind: 'invoice', quote, invoice: { ...invoice, createdAt: '2026-08-31T16:00:00Z' } } }))
  assert.ok(html.includes('2026/09/01'))
})
