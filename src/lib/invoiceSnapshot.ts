import type { InvoiceSnapshot } from '../types'
import { hasTwoDecimals, isValidLine, lineAmount, MAX_AMOUNT, totals } from './money'

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Treat missing/invalid historical snapshots as unverified, never reconstruct them
// using today's customer master, quote lines or tax settings.
export function parseInvoiceSnapshot(value: unknown, amount: number): InvoiceSnapshot | null {
  if (!record(value) || value.version !== 1 || !record(value.totals) || !Array.isArray(value.lines) || !value.lines.length) return null
  const { issuerName, issuerOrganization, registrationNo, customerName, customerAddress, project, memo, quoteNo, taxRate } = value
  if (typeof issuerName !== 'string' || !issuerName.trim() || typeof issuerOrganization !== 'string'
    || typeof registrationNo !== 'string' || typeof customerName !== 'string' || !customerName.trim()
    || typeof customerAddress !== 'string' || typeof project !== 'string' || typeof memo !== 'string'
    || typeof quoteNo !== 'string' || typeof taxRate !== 'number' || !hasTwoDecimals(taxRate) || taxRate < 0 || taxRate > 100) return null
  const lines: InvoiceSnapshot['lines'] = []
  for (const line of value.lines) {
    if (!record(line) || typeof line.name !== 'string' || typeof line.unit !== 'string'
      || typeof line.unitPrice !== 'number' || typeof line.quantity !== 'number'
      || (line.taxKind !== 'taxable' && line.taxKind !== 'exempt') || typeof line.amount !== 'number') return null
    const parsed: InvoiceSnapshot['lines'][number] = { name: line.name, unit: line.unit, unitPrice: line.unitPrice, quantity: line.quantity, taxKind: line.taxKind, amount: line.amount }
    if (!isValidLine(parsed) || lineAmount(parsed) !== parsed.amount) return null
    lines.push(parsed)
  }
  const calculated = totals(lines, taxRate)
  if (calculated.total > MAX_AMOUNT || calculated.total !== amount
    || value.totals.sub !== calculated.sub || value.totals.taxable !== calculated.taxable
    || value.totals.tax !== calculated.tax || value.totals.total !== calculated.total) return null
  return { version: 1, issuerName, issuerOrganization, registrationNo, customerName, customerAddress, project, memo, quoteNo, taxRate, lines, totals: calculated }
}
