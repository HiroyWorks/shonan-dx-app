import type { Line } from '../types'

export const MAX_AMOUNT = 2_147_483_647
export const hasTwoDecimals = (value: number) => Number.isFinite(value)
  && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001

export const isValidLine = (line: Pick<Line, 'unitPrice' | 'quantity'>) =>
  Number.isInteger(line.unitPrice) && line.unitPrice >= 0 && line.unitPrice <= MAX_AMOUNT
  && hasTwoDecimals(line.quantity) && line.quantity > 0 && line.quantity < 10_000_000_000

// Round each net line to yen, then round tax once on the taxable subtotal.
// Integer arithmetic avoids binary floating-point differences at .5 boundaries.
export function lineAmount(line: Pick<Line, 'unitPrice' | 'quantity'>): number {
  if (!isValidLine(line)) return 0
  return Number((BigInt(line.unitPrice) * BigInt(Math.round(line.quantity * 100)) + 50n) / 100n)
}

export function totals(lines: Pick<Line, 'unitPrice' | 'quantity' | 'taxKind'>[], taxRate: number) {
  let sub = 0n
  let taxable = 0n
  for (const line of lines) {
    const amount = BigInt(lineAmount(line))
    sub += amount
    if (line.taxKind !== 'exempt') taxable += amount
  }
  const rate = hasTwoDecimals(taxRate) && taxRate >= 0 && taxRate <= 100 ? Math.round(taxRate * 100) : 0
  const tax = (taxable * BigInt(rate) + 5_000n) / 10_000n
  return { sub: Number(sub), taxable: Number(taxable), tax: Number(tax), total: Number(sub + tax) }
}
