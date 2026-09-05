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
const invoice = { id: 'i', invoiceNo: 'INV-2026-001', quoteId: 'q', amount: 11000, createdAt: '2026-09-01T00:00:00Z', snapshot }
const props = { taxRate: 8, invoiceRegistrationNo: '変更後の番号', issuerName: '変更後の会社', issuerOrganization: '変更後の部門' }

test('issued invoice renders its snapshot, independent of current quote and settings', () => {
  const html = renderToStaticMarkup(createElement(PreviewPaper, { ...props, target: { kind: 'invoice', quote, invoice } }))
  for (const expected of ['発行時の会社', '発行時の顧客', '発行時の案件', '原本の備考', '11,000', '消費税（10%）', 'T1234567890123']) assert.ok(html.includes(expected), expected)
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
