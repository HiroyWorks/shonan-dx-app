import type { Invoice, InvoiceSnapshot } from '../types'

type Props = { invoice: Invoice; snapshot: InvoiceSnapshot }
const number = (value: number) => new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(value)
const issueDate = (value: string) => new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(value))

// Presentation only: every business value comes from the issued invoice, never current masters.
export default function InvoicePaper({ invoice, snapshot }: Props) {
  const { lines, totals, taxRate } = snapshot
  const taxRates = [...new Set([10, 8, taxRate])]
  const blankRows = Math.max(0, 13 - lines.length)

  return <article className="paper invoice-paper" aria-label="請求書">
    <h2 className="invoice-title">{'請　求　書'}</h2>
    <div className="invoice-heading">
      <div className="invoice-recipient">
        <p className="invoice-customer">{snapshot.customerName} 御中</p>
        {snapshot.customerAddress && <p className="invoice-address">{snapshot.customerAddress}</p>}
      </div>
      <dl className="invoice-identifiers">
        <dt>No.</dt><dd>{invoice.invoiceNo}</dd>
        <dt>請求日</dt><dd><time dateTime={invoice.createdAt}>{issueDate(invoice.createdAt)}</time></dd>
      </dl>
    </div>

    <div className="invoice-information">
      <div className="invoice-terms">
        <p className="invoice-greeting">下記のとおり、御請求申し上げます。</p>
        <dl className="invoice-conditions">
          <dt>件名</dt><dd>{snapshot.project}</dd>
          <dt>支払期限</dt><dd>{invoice.dueDate ? <time dateTime={invoice.dueDate}>{invoice.dueDate.replaceAll('-', '/')}</time> : '未記録'}</dd>
          <dt>振込先</dt><dd className="invoice-bank">{invoice.bankDetails || '未記録'}</dd>
        </dl>
        <div className="invoice-amount"><span>合計</span><strong>{number(totals.total)} 円（税込）</strong></div>
      </div>
      <div className="invoice-issuer">
        <p>{snapshot.issuerName}</p>
        {snapshot.issuerOrganization && <p>{snapshot.issuerOrganization}</p>}
        <p className="invoice-registration">登録番号：{snapshot.registrationNo || '未設定'}</p>
      </div>
    </div>

    <table className="invoice-grid" aria-label="請求明細">
      <colgroup><col className="invoice-description-col" /><col className="invoice-quantity-col" /><col className="invoice-unit-col" /><col className="invoice-price-col" /><col className="invoice-tax-col" /><col className="invoice-total-col" /></colgroup>
      <thead><tr><th scope="col">摘要</th><th scope="col">数量</th><th scope="col">単位</th><th scope="col">単価</th><th scope="col">税率</th><th scope="col">金額</th></tr></thead>
      <tbody>
        {lines.map((line, index) => <tr key={index}>
          <td>{line.name}</td><td>{number(line.quantity)}</td><td>{line.unit}</td>
          <td>{number(line.unitPrice)}</td><td>{line.taxKind === 'exempt' ? '非課税' : `${taxRate}%`}</td><td>{number(line.amount)}</td>
        </tr>)}
        {Array.from({ length: blankRows }, (_, index) => <tr className="invoice-empty-row" key={`empty-${index}`} aria-hidden="true"><td>&nbsp;</td><td /><td /><td /><td /><td /></tr>)}
      </tbody>
    </table>

    <div className="invoice-summary">
      <table className="invoice-tax-breakdown" aria-label="税率別内訳">
        <thead><tr><th scope="col">税率別内訳</th><th scope="col">税抜金額</th><th scope="col">消費税額</th></tr></thead>
        <tbody>
          {taxRates.map((rate) => <tr key={rate}><th scope="row">{rate}%対象</th><td>{number(rate === taxRate ? totals.taxable : 0)}</td><td>{number(rate === taxRate ? totals.tax : 0)}</td></tr>)}
          <tr><th scope="row">非課税対象</th><td>{number(totals.sub - totals.taxable)}</td><td>0</td></tr>
        </tbody>
      </table>
      <dl className="invoice-totals">
        <dt>小計</dt><dd>{number(totals.sub)}</dd>
        <dt aria-label={`消費税（${taxRate}%）`}>消費税</dt><dd>{number(totals.tax)}</dd>
        <dt>合計</dt><dd>{number(totals.total)}</dd>
      </dl>
    </div>
    <section className="invoice-notes" aria-label="備考"><h3>備考</h3><p>{snapshot.memo || '\u00a0'}</p></section>
  </article>
}
