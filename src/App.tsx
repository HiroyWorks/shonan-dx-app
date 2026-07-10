
import React, { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import './App.css'
import { isGoogleProviderEnabled, isSupabaseConfigured, signInWithGoogle, signOut, supabase } from './lib/supabase'

void React

type QuoteStatus = 'Pending' | 'Won' | 'Invoiced'
type Role = 'admin' | 'member'
type Plan = 'free' | 'pro'
type SortKey = 'createdAt' | 'updatedAt' | 'amount' | 'quoteNo'
type TaxKind = 'taxable' | 'exempt'
type Page = 'dashboard' | 'quote' | 'invoices' | 'customers' | 'items' | 'settings'
type Org = { id: string; company: string; name: string }
type User = { id: string; name: string; email: string; role: Role; orgId: string }
type Customer = { id: string; orgId: string; name: string; contact: string; email: string; memo: string }
type Item = { id: string; orgId: string; name: string; category: string; unitPrice: number; unit: string; taxKind?: TaxKind }
type Line = { id: string; itemId: string; name: string; unitPrice: number; quantity: number; unit: string; taxKind?: TaxKind; isCustom?: boolean }
type Note = { id: string; body: string; author: string; createdAt: string }
type Quote = { id: string; orgId: string; quoteNo: string; customerId: string; customerName: string; project: string; amount: number; status: QuoteStatus; createdAt: string; updatedAt: string; memo: string; lines: Line[]; notes: Note[]; invoiceNo?: string }
type Invoice = { id: string; orgId: string; invoiceNo: string; quoteId: string; customerName: string; amount: number; createdAt: string }
type ActivityKind = 'quote-created' | 'quote-updated' | 'status-updated' | 'invoice-created' | 'memo-added'
type Activity = { id: string; orgId: string; kind: ActivityKind; title: string; description: string; createdAt: string }
type Settings = { taxRate: number; plan: Plan; prefix: string; year: number; nextNo: number }
type Preview = { kind: 'quote'; quote: Quote } | { kind: 'invoice'; quote: Quote; invoice: Invoice }

const ORGS: Org[] = [
  { id: 'org-main', company: '湘南DX合同会社', name: '制作事業部' },
  { id: 'org-backoffice', company: '湘南DX合同会社', name: 'バックオフィス' },
]
const USERS: User[] = [
  { id: 'admin', name: '管理者ユーザー', email: 'admin@example.com', role: 'admin', orgId: 'org-main' },
  { id: 'member', name: '担当者ユーザー', email: 'member@example.com', role: 'member', orgId: 'org-main' },
]
const CUSTOMERS: Customer[] = [
  { id: 'c-minato', orgId: 'org-main', name: '株式会社みなと企画', contact: '佐藤様', email: 'sato@minato.example', memo: 'Web案件が多い。月初に見積確認が入りやすい。' },
  { id: 'c-bakery', orgId: 'org-main', name: '湘南ベーカリー', contact: '山口様', email: 'info@bakery.example', memo: '写真素材の支給タイミングに注意。' },
  { id: 'c-clinic', orgId: 'org-main', name: '藤沢クリニック', contact: '採用担当様', email: 'hr@clinic.example', memo: '公開前チェックは院長確認あり。' },
  { id: 'c-kamakura', orgId: 'org-main', name: '鎌倉工務店', contact: '代表様', email: 'hello@kamakura.example', memo: '保守更新は四半期ごとに提案。' },
  { id: 'c-other', orgId: 'org-backoffice', name: '社内管理用サンプル', contact: '経理担当', email: 'accounting@example.com', memo: '別組織のサンプル。' },
]
const ITEMS: Item[] = [
  { id: 'i-site', orgId: 'org-main', name: 'Webサイト制作', category: '制作', unitPrice: 180000, unit: '式', taxKind: 'taxable' },
  { id: 'i-lp', orgId: 'org-main', name: 'ランディングページ制作', category: '制作', unitPrice: 120000, unit: '式', taxKind: 'taxable' },
  { id: 'i-maintenance', orgId: 'org-main', name: '月額保守運用', category: '保守', unitPrice: 25000, unit: '月', taxKind: 'taxable' },
  { id: 'i-seo', orgId: 'org-main', name: 'SEO記事作成', category: 'コンテンツ', unitPrice: 15000, unit: '本', taxKind: 'taxable' },
  { id: 'i-support', orgId: 'org-main', name: '操作レクチャー', category: 'サポート', unitPrice: 12000, unit: '時間', taxKind: 'taxable' },
  { id: 'i-photo', orgId: 'org-main', name: '撮影ディレクション', category: '現場', unitPrice: 80000, unit: '回', taxKind: 'taxable' },
  { id: 'i-travel', orgId: 'org-main', name: '立替交通費', category: '立替', unitPrice: 3000, unit: '件', taxKind: 'exempt' },
  { id: 'i-accounting', orgId: 'org-backoffice', name: '経理チェック', category: '管理', unitPrice: 10000, unit: '件', taxKind: 'exempt' },
]
const QUOTES: Quote[] = [
  { id: 'q-041', orgId: 'org-main', quoteNo: 'Q-2026-041', customerId: 'c-bakery', customerName: '湘南ベーカリー', project: '新商品サイトリニューアル', amount: 528000, status: 'Pending', createdAt: '2026-06-02', updatedAt: '2026-06-13', memo: '商品撮影素材の支給後、下層ページ構成を確定します。', lines: [{ id: 'l-1', itemId: 'i-site', name: 'Webサイト制作', unitPrice: 180000, quantity: 2, unit: '式' }, { id: 'l-2', itemId: 'i-lp', name: 'ランディングページ制作', unitPrice: 120000, quantity: 1, unit: '式' }], notes: [{ id: 'n-1', body: '商品写真の差し替え希望あり。6/14に素材共有予定。', author: '管理者ユーザー', createdAt: '2026-06-13T09:30:00.000Z' }] },
  { id: 'q-038', orgId: 'org-main', quoteNo: 'Q-2026-038', customerId: 'c-clinic', customerName: '藤沢クリニック', project: '採用LP制作', amount: 264000, status: 'Won', createdAt: '2026-05-28', updatedAt: '2026-07-08', memo: '公開後1週間の軽微な文言修正を含みます。', lines: [{ id: 'l-3', itemId: 'i-lp', name: 'ランディングページ制作', unitPrice: 120000, quantity: 2, unit: '式' }], notes: [] },
  { id: 'q-036', orgId: 'org-main', quoteNo: 'Q-2026-036', customerId: 'c-kamakura', customerName: '鎌倉工務店', project: '定期保守プラン', amount: 198000, status: 'Invoiced', createdAt: '2026-05-23', updatedAt: '2026-05-25', memo: '月次レポートと軽微な更新作業を含む6か月分の保守費用です。', lines: [{ id: 'l-4', itemId: 'i-maintenance', name: '月額保守運用', unitPrice: 25000, quantity: 6, unit: '月' }, { id: 'l-5', itemId: 'i-seo', name: 'SEO記事作成', unitPrice: 15000, quantity: 2, unit: '本' }], notes: [], invoiceNo: 'INV-2026-001' },
]
const INVOICES: Invoice[] = [{ id: 'inv-001', orgId: 'org-main', invoiceNo: 'INV-2026-001', quoteId: 'q-036', customerName: '鎌倉工務店', amount: 198000, createdAt: '2026-05-25' }]
const FREE_LIMIT = Number(import.meta.env.VITE_APP_FREE_QUOTE_LIMIT ?? 20)
const KEY = 'estimate-management-v3'
const statusText: Record<QuoteStatus, string> = { Pending: '返答待ち', Won: '成約', Invoiced: '請求済' }
const activityText: Record<ActivityKind, string> = {
  'quote-created': '見積作成',
  'quote-updated': '見積更新',
  'status-updated': 'ステータス変更',
  'invoice-created': '請求書化',
  'memo-added': 'メモ追加',
}
const navItems: { page: Page; label: string; description: string }[] = [
  { page: 'dashboard', label: 'Dashboard', description: 'トップ・最新更新' },
  { page: 'quote', label: '見積作成', description: '新規・編集入力' },
  { page: 'invoices', label: '請求書', description: '変換済み書類' },
  { page: 'customers', label: '顧客マスタ', description: '取引先管理' },
  { page: 'items', label: '品目マスタ', description: '単価・単位管理' },
  { page: 'settings', label: '設定', description: '組織・番号・税率' },
]
const normalizeItems = (value: Item[]) => {
  const fallbackExempt = ITEMS.find((item) => item.id === 'i-travel')
  const normalized = value.map((item) => ({ ...item, taxKind: item.taxKind ?? 'taxable' }))
  return fallbackExempt && !normalized.some((item) => item.id === fallbackExempt.id) ? [...normalized, fallbackExempt] : normalized
}
const statusList: QuoteStatus[] = ['Pending', 'Won', 'Invoiced']
const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 })
const dateFmt = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
const dateTimeFmt = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/
const parseDateValue = (value: string) => {
  if (dateOnlyPattern.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day, 0, 0, 0)
  }
  return new Date(value)
}
const today = () => {
  const date = new Date()
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}
const now = () => new Date().toISOString()
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const money = (n: number) => yen.format(n)
const showDate = (s: string) => dateFmt.format(parseDateValue(s))
const showDateTime = (s: string) => dateTimeFmt.format(parseDateValue(s))
const dayStartMs = (s: string) => {
  const date = parseDateValue(s)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}
const days = (s: string) => Math.max(0, Math.floor((dayStartMs(today()) - dayStartMs(s)) / 86400000))
const makeInitialActivities = (sourceQuotes: Quote[] = QUOTES, sourceInvoices: Invoice[] = INVOICES): Activity[] => {
  const activities: Activity[] = []
  sourceQuotes.forEach((quote) => {
    activities.push({ id: `activity-created-${quote.id}`, orgId: quote.orgId, kind: 'quote-created', title: `${quote.quoteNo} を作成`, description: `${quote.customerName} / ${quote.project} / ${money(quote.amount)}`, createdAt: quote.createdAt })
    if (quote.updatedAt !== quote.createdAt) {
      activities.push({ id: `activity-updated-${quote.id}`, orgId: quote.orgId, kind: 'quote-updated', title: `${quote.quoteNo} を更新`, description: `${quote.customerName} / ${quote.project}`, createdAt: quote.updatedAt })
    }
    quote.notes.forEach((note) => {
      activities.push({ id: `activity-note-${quote.id}-${note.id}`, orgId: quote.orgId, kind: 'memo-added', title: `${quote.quoteNo} にメモを追加`, description: note.body, createdAt: note.createdAt })
    })
  })
  sourceInvoices.forEach((invoice) => {
    const quote = sourceQuotes.find((candidate) => candidate.id === invoice.quoteId)
    activities.push({ id: `activity-invoice-${invoice.id}`, orgId: invoice.orgId, kind: 'invoice-created', title: `${invoice.invoiceNo} を作成`, description: quote ? `${quote.quoteNo} / ${quote.customerName} / ${money(invoice.amount)}` : `${invoice.customerName} / ${money(invoice.amount)}`, createdAt: invoice.createdAt })
  })
  return activities.sort((a, b) => parseDateValue(b.createdAt).getTime() - parseDateValue(a.createdAt).getTime()).slice(0, 50)
}
const load = <T,>(name: string, fallback: T): T => {
  try { const raw = localStorage.getItem(`${KEY}:${name}`); return raw ? JSON.parse(raw) as T : fallback } catch { return fallback }
}
const save = <T,>(name: string, value: T) => localStorage.setItem(`${KEY}:${name}`, JSON.stringify(value))
const lineFrom = (item: Item): Line => ({ id: id('line'), itemId: item.id, name: item.name, unitPrice: item.unitPrice, quantity: 1, unit: item.unit, taxKind: item.taxKind ?? 'taxable' })
const customLine = (): Line => ({ id: id('line'), itemId: `custom-${id('item')}`, name: '自由入力項目', unitPrice: 0, quantity: 1, unit: '式', taxKind: 'taxable', isCustom: true })
const subtotal = (lines: Line[]) => lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
const taxableSubtotal = (lines: Line[]) => lines.reduce((sum, line) => {
  return line.taxKind === 'exempt' ? sum : sum + line.unitPrice * line.quantity
}, 0)
const totals = (lines: Line[], taxRate: number) => {
  const sub = subtotal(lines)
  const taxable = taxableSubtotal(lines)
  const tax = Math.round(taxable * taxRate / 100)
  return { sub, taxable, tax, total: sub + tax }
}
const taxKindText = (taxKind?: TaxKind) => taxKind === 'exempt' ? '非課税' : '課税'
function StatusBadge({ status }: { status: QuoteStatus }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{statusText[status]}</span>
}

function PreviewPaper({ target, taxRate }: { target: Preview; taxRate: number }) {
  const quote = target.quote
  const total = totals(quote.lines, taxRate)
  const isInvoice = target.kind === 'invoice'
  return (
    <div className="paper">
      <div className="paper-header">
        <div><p className="eyebrow">{isInvoice ? 'Invoice' : 'Estimate'}</p><h2>{isInvoice ? '請求書' : '見積書'}</h2><p>No. {isInvoice ? target.invoice.invoiceNo : quote.quoteNo}</p></div>
        <div className="paper-date"><span>発行日</span><strong>{showDate(isInvoice ? target.invoice.createdAt : quote.createdAt)}</strong></div>
      </div>
      <div className="paper-meta">
        <div className="paper-box"><span>宛先</span><strong>{quote.customerName} 御中</strong><p>{quote.project}</p></div>
        <div className="paper-box"><span>発行者</span><strong>Estimate management</strong><p>湘南DX合同会社 / 制作事業部</p><p>Supabase + Google認証対応</p></div>
      </div>
      <table className="paper-table">
        <thead><tr><th>品目</th><th>税区分</th><th>単価</th><th>数量</th><th>金額</th></tr></thead>
        <tbody>{quote.lines.map((line) => <tr key={line.id}><td><strong>{line.name}</strong><span>{line.unit}</span></td><td><span className={line.taxKind === 'exempt' ? 'tax-chip exempt' : 'tax-chip'}>{taxKindText(line.taxKind)}</span></td><td>{money(line.unitPrice)}</td><td>{line.quantity}</td><td>{money(line.unitPrice * line.quantity)}</td></tr>)}</tbody>
      </table>
      <div className="paper-bottom">
        <div className="paper-note"><span>備考</span><p>{quote.memo}</p></div>
        <div className="paper-totals"><div><span>小計</span><strong>{money(total.sub)}</strong></div><div><span>課税対象</span><strong>{money(total.taxable)}</strong></div><div><span>消費税（{taxRate}%）</span><strong>{money(total.tax)}</strong></div><div className="paper-grand"><span>合計</span><strong>{money(total.total)}</strong></div></div>
      </div>
    </div>
  )
}

const authErrorText = (error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error)
  if (/provider is not enabled|unsupported provider/i.test(detail)) {
    return 'Googleログインがまだ有効化されていません。管理者がSupabaseのGoogle providerを設定するまでお待ちください。'
  }
  return 'ログインに失敗しました。時間をおいてもう一度お試しください。'
}

type LoginScreenProps = {
  checking: boolean
  pending: boolean
  error: string
  onGoogleLogin: () => void
}

function LoginScreen({ checking, pending, error, onGoogleLogin }: LoginScreenProps) {
  return (
    <main className='login-page'>
      <section className='login-visual' aria-hidden='true'>
        <div className='login-visual-content'>
          <p className='eyebrow'>Estimate management</p>
          <h1>見積業務を、<br />ひとつのワークスペースに。</h1>
          <p>顧客・品目・見積・請求書を、組織ごとに安全に管理します。</p>
          <div className='login-feature-list'>
            <span>見積作成と進捗管理</span>
            <span>請求書へのスムーズな変換</span>
            <span>組織単位のアクセス制御</span>
          </div>
        </div>
      </section>
      <section className='login-panel'>
        <div className='login-card'>
          <div className='login-mark'>E</div>
          <div>
            <p className='eyebrow'>Welcome back</p>
            <h2>ログイン</h2>
            <p className='login-description'>招待されたGoogleアカウントでログインしてください。</p>
          </div>
          {error && <div className='login-error' role='alert'>{error}</div>}
          {checking ? (
            <div className='login-status'><span className='login-spinner' />認証状態を確認しています</div>
          ) : (
            <button className='google-login-button' type='button' disabled={pending} onClick={onGoogleLogin}>
              <span className='google-mark'>G</span>
              {pending ? 'Googleへ接続しています…' : 'Googleでログイン'}
            </button>
          )}
          <p className='login-help'>ログインできない場合は、組織の管理者へお問い合わせください。</p>
        </div>
      </section>
    </main>
  )
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured)
  const [authPending, setAuthPending] = useState(false)
  const [authError, setAuthError] = useState('')
  const [orgId, setOrgId] = useState('org-main')
  const [userId, setUserId] = useState('admin')
  const [customers, setCustomers] = useState(() => load('customers', CUSTOMERS))
  const [items, setItems] = useState(() => normalizeItems(load('items', ITEMS)))
  const [quotes, setQuotes] = useState(() => load('quotes', QUOTES))
  const [invoices, setInvoices] = useState(() => load('invoices', INVOICES))
  const [activities, setActivities] = useState(() => {
    const stored = load<Activity[]>('activities', [])
    return stored.length ? stored : makeInitialActivities(load('quotes', QUOTES), load('invoices', INVOICES))
  })
  const [settings, setSettings] = useState<Settings>(() => load('settings', { taxRate: 10, plan: 'free', prefix: 'Q', year: 2026, nextNo: 42 }))
  const [customerDraft, setCustomerDraft] = useState({ name: '', contact: '', email: '', memo: '' })
  const [editingCustomer, setEditingCustomer] = useState<string | null>(null)
  const [itemDraft, setItemDraft] = useState<{ name: string; category: string; unitPrice: number; unit: string; taxKind: TaxKind }>({ name: '', category: '', unitPrice: 0, unit: '式', taxKind: 'taxable' })
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState('c-minato')
  const [project, setProject] = useState('コーポレートサイト見積')
  const [memo, setMemo] = useState('見積有効期限は30日です。要件確定後に最終調整いたします。')
  const [lines, setLines] = useState<Line[]>(() => [lineFrom(ITEMS[0])])
  const [editingQuote, setEditingQuote] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'All' | QuoteStatus>('All')
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [noteQuoteId, setNoteQuoteId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [message, setMessage] = useState('')
  const [activePage, setActivePage] = useState<Page>('dashboard')

  const org = ORGS.find((candidate) => candidate.id === orgId) ?? ORGS[0]
  const user = USERS.find((candidate) => candidate.id === userId) ?? USERS[0]
  const orgCustomers = customers.filter((customer) => customer.orgId === orgId)
  const orgItems = items.filter((item) => item.orgId === orgId)
  const orgQuotes = quotes.filter((quote) => quote.orgId === orgId)
  const orgInvoices = invoices.filter((invoice) => invoice.orgId === orgId)
  const currentTotals = useMemo(() => totals(lines, settings.taxRate), [lines, settings.taxRate])
  const noteQuote = quotes.find((quote) => quote.id === noteQuoteId) ?? null
  const isAdmin = user.role === 'admin'
  const canAddQuote = settings.plan === 'pro' || orgQuotes.length < FREE_LIMIT
  const nextQuoteNo = `${settings.prefix}-${settings.year}-${String(settings.nextNo).padStart(3, '0')}`

  useEffect(() => save('customers', customers), [customers])
  useEffect(() => save('items', items), [items])
  useEffect(() => save('quotes', quotes), [quotes])
  useEffect(() => save('invoices', invoices), [invoices])
  useEffect(() => save('activities', activities), [activities])
  useEffect(() => save('settings', settings), [settings])
  useEffect(() => {
    if (!isSupabaseConfigured) return

    let active = true
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) setAuthError(authErrorText(error))
      setSession(data.session)
      setAuthReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      setSession(next)
      setAuthReady(true)
      if (next) setAuthError('')
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const handleGoogleLogin = async () => {
    setAuthPending(true)
    setAuthError('')
    try {
      const providerEnabled = await isGoogleProviderEnabled()
      if (!providerEnabled) {
        setAuthError('Googleログインがまだ有効化されていません。管理者がSupabaseのGoogle providerを設定するまでお待ちください。')
        setAuthPending(false)
        return
      }
      await signInWithGoogle()
    } catch (error) {
      setAuthError(authErrorText(error))
      setAuthPending(false)
    }
  }

  const stats = useMemo(() => ({
    total: orgQuotes.reduce((sum, quote) => sum + quote.amount, 0),
    won: orgQuotes.filter((quote) => quote.status === 'Won').reduce((sum, quote) => sum + quote.amount, 0),
    follow: orgQuotes.filter((quote) => quote.status === 'Pending' && days(quote.createdAt) >= 10).length,
    invoices: orgInvoices.length,
  }), [orgInvoices.length, orgQuotes])
  const filteredQuotes = useMemo(() => {
    const text = query.trim().toLowerCase()
    return [...orgQuotes].filter((quote) => {
      const byStatus = statusFilter === 'All' || quote.status === statusFilter
      const byText = !text || [quote.quoteNo, quote.customerName, quote.project].some((value) => value.toLowerCase().includes(text))
      return byStatus && byText
    }).sort((a, b) => sortKey === 'amount' ? b.amount - a.amount : String(b[sortKey]).localeCompare(String(a[sortKey])))
  }, [orgQuotes, query, sortKey, statusFilter])

  const recentActivities = useMemo(() => {
    return [...activities]
      .filter((activity) => activity.orgId === orgId)
      .sort((a, b) => parseDateValue(b.createdAt).getTime() - parseDateValue(a.createdAt).getTime())
      .slice(0, 10)
  }, [activities, orgId])

  const recordActivity = (activity: Omit<Activity, 'id' | 'orgId' | 'createdAt'> & { orgId?: string; createdAt?: string }) => {
    const entry: Activity = {
      id: id('activity'),
      orgId: activity.orgId ?? orgId,
      kind: activity.kind,
      title: activity.title,
      description: activity.description,
      createdAt: activity.createdAt ?? now(),
    }
    setActivities((prev) => [entry, ...prev].slice(0, 200))
  }

  const updateQuoteStatus = (quote: Quote, status: QuoteStatus) => {
    if (quote.status === status) return
    const eventAt = now()
    setQuotes((prev) => prev.map((candidate) => candidate.id === quote.id ? { ...candidate, status, updatedAt: eventAt } : candidate))
    recordActivity({ kind: 'status-updated', title: `${quote.quoteNo} を${statusText[status]}に変更`, description: `${quote.customerName} / ${quote.project}`, createdAt: eventAt })
  }
  const changeOrganization = (nextOrgId: string) => {
    const firstCustomer = customers.find((customer) => customer.orgId === nextOrgId)
    const firstItem = items.find((item) => item.orgId === nextOrgId)
    setOrgId(nextOrgId)
    if (firstCustomer) setSelectedCustomer(firstCustomer.id)
    if (firstItem) setLines([lineFrom(firstItem)])
    setEditingQuote(null)
  }
  const resetForm = () => {
    if (orgCustomers[0]) setSelectedCustomer(orgCustomers[0].id)
    if (orgItems[0]) setLines([lineFrom(orgItems[0])])
    setProject('コーポレートサイト見積')
    setMemo('見積有効期限は30日です。要件確定後に最終調整いたします。')
    setEditingQuote(null)
  }
  const changeLine = (lineId: string, field: keyof Line, value: string) => setLines((prev) => prev.map((line) => {
    if (line.id !== lineId) return line
    if (field === 'itemId') {
      const item = orgItems.find((candidate) => candidate.id === value)
      return item ? { ...line, itemId: item.id, name: item.name, unitPrice: item.unitPrice, unit: item.unit, taxKind: item.taxKind ?? 'taxable', isCustom: false } : line
    }
    if (field === 'unitPrice' || field === 'quantity') return { ...line, [field]: Math.max(field === 'quantity' ? 1 : 0, Number(value) || 0) }
    return { ...line, [field]: value }
  }))
  const submitQuote = () => {
    const customer = customers.find((candidate) => candidate.id === selectedCustomer)
    if (!customer) return setMessage('顧客を選択してください。')
    if (!canAddQuote && !editingQuote) return setMessage(`フリープランは見積${FREE_LIMIT}件までです。Proに切り替えると制限を解除できます。`)
    const eventAt = now()
    const old = editingQuote ? quotes.find((quote) => quote.id === editingQuote) : undefined
    const quote: Quote = {
      id: old?.id ?? id('quote'),
      orgId,
      quoteNo: old?.quoteNo ?? nextQuoteNo,
      customerId: customer.id,
      customerName: customer.name,
      project: project.trim() || '無題の案件',
      amount: currentTotals.total,
      status: old?.status ?? 'Pending',
      createdAt: old?.createdAt ?? eventAt,
      updatedAt: eventAt,
      memo,
      lines,
      notes: old?.notes ?? [],
      invoiceNo: old?.invoiceNo,
    }
    if (old) {
      setQuotes((prev) => prev.map((candidate) => candidate.id === old.id ? quote : candidate))
      setMessage(`${quote.quoteNo} を更新しました。`)
      recordActivity({ kind: 'quote-updated', title: `${quote.quoteNo} を更新`, description: `${quote.customerName} / ${quote.project} / ${money(quote.amount)}`, createdAt: eventAt })
    } else {
      setQuotes((prev) => [quote, ...prev])
      setSettings((prev) => ({ ...prev, nextNo: prev.nextNo + 1 }))
      setMessage(`${quote.quoteNo} を提出済み一覧へ追加しました。`)
      recordActivity({ kind: 'quote-created', title: `${quote.quoteNo} を作成`, description: `${quote.customerName} / ${quote.project} / ${money(quote.amount)}`, createdAt: eventAt })
    }
    resetForm()
  }
  const editQuote = (quote: Quote) => {
    setSelectedCustomer(quote.customerId)
    setProject(quote.project)
    setMemo(quote.memo)
    setLines(quote.lines)
    setEditingQuote(quote.id)
    setActivePage('quote')
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  }
  const duplicateQuote = (quote: Quote) => {
    setSelectedCustomer(quote.customerId)
    setProject(`${quote.project} のコピー`)
    setMemo(quote.memo)
    setLines(quote.lines.map((line) => ({ ...line, id: id('line') })))
    setEditingQuote(null)
    setActivePage('quote')
    setMessage(`${quote.quoteNo} を複製して入力フォームへ展開しました。`)
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  }
  const deleteQuote = (quote: Quote) => {
    if (!window.confirm(`${quote.quoteNo} を削除しますか？`)) return
    setQuotes((prev) => prev.filter((candidate) => candidate.id !== quote.id))
    setInvoices((prev) => prev.filter((invoice) => invoice.quoteId !== quote.id))
    setMessage(`${quote.quoteNo} を削除しました。`)
  }
  const convertToInvoice = (quote: Quote) => {
    const existing = invoices.find((invoice) => invoice.quoteId === quote.id)
    if (existing) return setPreview({ kind: 'invoice', invoice: existing, quote })
    const eventAt = now()
    const invoiceNo = `INV-${new Date().getFullYear()}-${String(invoices.length + 1).padStart(3, '0')}`
    const invoice: Invoice = { id: id('invoice'), orgId: quote.orgId, invoiceNo, quoteId: quote.id, customerName: quote.customerName, amount: quote.amount, createdAt: eventAt }
    const converted = { ...quote, status: 'Invoiced' as QuoteStatus, invoiceNo, updatedAt: eventAt }
    setInvoices((prev) => [invoice, ...prev])
    setQuotes((prev) => prev.map((candidate) => candidate.id === quote.id ? converted : candidate))
    setPreview({ kind: 'invoice', invoice, quote: converted })
    setMessage(`${quote.quoteNo} から ${invoiceNo} を作成しました。`)
    recordActivity({ kind: 'invoice-created', title: `${invoiceNo} を作成`, description: `${quote.quoteNo} / ${quote.customerName} / ${money(quote.amount)}`, createdAt: eventAt })
  }
  const saveCustomer = () => {
    if (!customerDraft.name.trim()) return
    if (editingCustomer) {
      setCustomers((prev) => prev.map((customer) => customer.id === editingCustomer ? { ...customer, ...customerDraft, name: customerDraft.name.trim() } : customer))
      setEditingCustomer(null)
    } else {
      const customer: Customer = { id: id('customer'), orgId, ...customerDraft, name: customerDraft.name.trim() }
      setCustomers((prev) => [customer, ...prev])
      setSelectedCustomer(customer.id)
    }
    setCustomerDraft({ name: '', contact: '', email: '', memo: '' })
  }
  const deleteCustomer = (customer: Customer) => {
    if (orgQuotes.some((quote) => quote.customerId === customer.id)) return setMessage('見積に使われている顧客は削除できません。')
    setCustomers((prev) => prev.filter((candidate) => candidate.id !== customer.id))
  }
  const saveItem = () => {
    if (!itemDraft.name.trim()) return
    if (editingItem) {
      setItems((prev) => prev.map((item) => item.id === editingItem ? { ...item, ...itemDraft, name: itemDraft.name.trim() } : item))
      setEditingItem(null)
    } else {
      setItems((prev) => [{ id: id('item'), orgId, ...itemDraft, name: itemDraft.name.trim() }, ...prev])
    }
    setItemDraft({ name: '', category: '', unitPrice: 0, unit: '式', taxKind: 'taxable' })
  }
  const deleteItem = (item: Item) => {
    if (lines.some((line) => line.itemId === item.id) || orgQuotes.some((quote) => quote.lines.some((line) => line.itemId === item.id))) return setMessage('使用中の品目は削除できません。')
    setItems((prev) => prev.filter((candidate) => candidate.id !== item.id))
  }
  const addNote = () => {
    if (!noteQuote || !noteDraft.trim()) return
    const eventAt = now()
    const note: Note = { id: id('note'), body: noteDraft.trim(), author: user.name, createdAt: eventAt }
    setQuotes((prev) => prev.map((quote) => quote.id === noteQuote.id ? { ...quote, notes: [note, ...quote.notes], updatedAt: eventAt } : quote))
    setNoteDraft('')
    recordActivity({ kind: 'memo-added', title: `${noteQuote.quoteNo} にメモを追加`, description: note.body, createdAt: eventAt })
  }
  const draftPreview = () => {
    const customer = customers.find((candidate) => candidate.id === selectedCustomer)
    if (!customer) return
    setPreview({ kind: 'quote', quote: { id: 'draft', orgId, quoteNo: editingQuote ? quotes.find((quote) => quote.id === editingQuote)?.quoteNo ?? nextQuoteNo : nextQuoteNo, customerId: customer.id, customerName: customer.name, project, amount: currentTotals.total, status: 'Pending', createdAt: now(), updatedAt: now(), memo, lines, notes: [] } })
  }
  const selectedCustomerData = orgCustomers.find((customer) => customer.id === selectedCustomer)

  if (isSupabaseConfigured && (!authReady || !session)) {
    return <LoginScreen checking={!authReady} pending={authPending} error={authError} onGoogleLogin={() => void handleGoogleLogin()} />
  }

  return (
    <div className="app-shell">
      <header className="topbar" data-ui-version="notion-clean-20260708">
        <div><p className="eyebrow">Estimate management</p><h1>見積管理・作成アプリ</h1></div>
        <div className="auth-card"><span className={isSupabaseConfigured ? 'sync-dot active' : 'sync-dot'} /><div><strong>{org.company} / {org.name}</strong><span>{user.name} / {user.role === 'admin' ? '管理者' : '担当者'} ・ {isSupabaseConfigured ? session?.user.email ?? 'Google未ログイン' : 'ローカルモード'}</span></div>{isSupabaseConfigured ? session ? <button className="btn ghost" onClick={() => void signOut()}>ログアウト</button> : <button className="btn primary" onClick={() => void signInWithGoogle()}>Googleでログイン</button> : null}</div>
      </header>
      <div className="app-layout">
        <aside className="sidebar-nav" aria-label="メインメニュー">
          {navItems.map((item) => (
            <button key={item.page} className={activePage === item.page ? 'nav-item active' : 'nav-item'} onClick={() => setActivePage(item.page)}>
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </aside>
        <div className="page-content">
      {message && <div className="message">{message}</div>}
      <main className="main-stack">

        {activePage === 'dashboard' && <>
<section className="kpi-grid"><div className="kpi-card"><span>見積総額</span><strong>{money(stats.total)}</strong><small>表示中組織の全見積</small></div><div className="kpi-card"><span>成約金額</span><strong>{money(stats.won)}</strong><small>ステータス成約のみ</small></div><div className="kpi-card"><span>請求書</span><strong>{stats.invoices}件</strong><small>見積から変換済み</small></div><div className="kpi-card alert"><span>要フォロー</span><strong>{stats.follow}件</strong><small>10日以上の返答待ち</small></div></section>
        <section className="panel activity-panel">
          <div className="panel-head"><div><p className="eyebrow">Dashboard</p><h2>最新の更新</h2></div><p className="section-note">見積作成、更新、請求書化、メモ追加など直近10件を表示します。</p></div>
          <div className="activity-list">{recentActivities.map((activity) => <article key={activity.id} className="activity-item"><span className={`activity-kind activity-${activity.kind}`}>{activityText[activity.kind]}</span><div><strong>{activity.title}</strong><p>{activity.description}</p></div><time>{showDateTime(activity.createdAt)}</time></article>)}</div>
        </section>
        <section className="panel dashboard-panel">
          <div className="panel-head"><div><p className="eyebrow">Quotes</p><h2>提出済みの見積一覧</h2></div><div className="filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="見積番号・顧客・案件で検索" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'All' | QuoteStatus)}><option value="All">すべてのステータス</option>{statusList.map((status) => <option key={status} value={status}>{statusText[status]}</option>)}</select><select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}><option value="createdAt">提出日順</option><option value="updatedAt">更新日順</option><option value="amount">金額順</option><option value="quoteNo">見積番号順</option></select></div></div>
          <div className="table-wrap"><table className="data-table"><thead><tr><th>見積番号</th><th>取引先</th><th>案件名</th><th>金額</th><th>ステータス</th><th>経過</th><th>提出日</th><th>更新日</th><th>操作</th></tr></thead><tbody>{filteredQuotes.map((quote) => { const waiting = days(quote.createdAt); const attention = quote.status === 'Pending' && waiting >= 10; return <tr key={quote.id} className={attention ? 'row-alert' : undefined}><td><span className={attention ? 'dot danger' : 'dot'} />{quote.quoteNo}</td><td>{quote.customerName}</td><td>{quote.project}</td><td className="amount">{money(quote.amount)}</td><td><StatusBadge status={quote.status} /><select className="compact-select" value={quote.status} onChange={(event) => updateQuoteStatus(quote, event.target.value as QuoteStatus)}>{statusList.map((status) => <option key={status} value={status}>{statusText[status]}</option>)}</select></td><td className={attention ? 'danger-text' : undefined}>{quote.status === 'Pending' ? `${waiting}日経過` : '対応完了'}</td><td>{showDateTime(quote.createdAt)}</td><td>{showDateTime(quote.updatedAt)}</td><td><div className="table-actions"><button onClick={() => setPreview({ kind: 'quote', quote })}>プレビュー</button><button onClick={() => editQuote(quote)}>編集</button><button onClick={() => duplicateQuote(quote)}>複製</button><button onClick={() => convertToInvoice(quote)}>請求書化</button><button onClick={() => setNoteQuoteId(quote.id)}>メモ {quote.notes.length}</button><button className="danger-button" onClick={() => deleteQuote(quote)}>削除</button></div></td></tr> })}</tbody></table></div>
        </section>
        </>}
        {activePage === 'quote' && <>
        <section className="panel quote-panel">
          <div className="panel-head"><div><p className="eyebrow">Speed quote</p><h2>{editingQuote ? '見積編集' : '見積入力'}</h2></div></div>
          <div className="quote-layout"><div className="quote-form"><div className="field-grid"><label><span>顧客名</span><select value={selectedCustomer} onChange={(event) => setSelectedCustomer(event.target.value)}>{orgCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label><span>案件名</span><input value={project} onChange={(event) => setProject(event.target.value)} /></label></div><div className="customer-hint">{selectedCustomerData ? `${selectedCustomerData.contact} / ${selectedCustomerData.email} / ${selectedCustomerData.memo}` : '顧客マスタを追加してください。'}</div><div className="form-table-wrap"><table className="line-table"><thead><tr><th>品目</th><th>税区分</th><th>単価</th><th>数量</th><th>金額</th><th></th></tr></thead><tbody>{lines.map((line) => <tr key={line.id}><td>{line.isCustom ? <input value={line.name} onChange={(event) => changeLine(line.id, 'name', event.target.value)} placeholder="自由入力項目" /> : <select value={line.itemId} onChange={(event) => changeLine(line.id, 'itemId', event.target.value)}>{orgItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}</td><td><select value={line.taxKind ?? 'taxable'} onChange={(event) => changeLine(line.id, 'taxKind', event.target.value)}><option value="taxable">課税</option><option value="exempt">非課税</option></select></td><td><input type="number" value={line.unitPrice} onChange={(event) => changeLine(line.id, 'unitPrice', event.target.value)} /></td><td><input type="number" value={line.quantity} onChange={(event) => changeLine(line.id, 'quantity', event.target.value)} /></td><td className="amount">{money(line.unitPrice * line.quantity)}</td><td><button disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((candidate) => candidate.id !== line.id))}>x</button></td></tr>)}</tbody></table></div><div className="quote-footer"><div className="line-add-actions"><button className="btn ghost" onClick={() => orgItems[0] && setLines((prev) => [...prev, lineFrom(orgItems[0])])}>+ マスタ明細を追加</button><button className="btn ghost" onClick={() => setLines((prev) => [...prev, customLine()])}>+ 自由明細を追加</button></div><div className="summary-inline"><span>小計 {money(currentTotals.sub)}</span><span>課税対象 {money(currentTotals.taxable)}</span><span>消費税 {money(currentTotals.tax)}</span><strong>合計 {money(currentTotals.total)}</strong></div></div><label className="memo-field"><span>メモ</span><textarea value={memo} onChange={(event) => setMemo(event.target.value)} /></label><div className="quote-actions"><button className="btn ghost" onClick={resetForm}>入力をリセット</button><button className="btn ghost" onClick={draftPreview}>見積書を確認</button><button className="btn primary" onClick={submitQuote}>{editingQuote ? '更新する' : '提出する'}</button></div></div></div>
        </section>
        </>}
        {activePage === 'invoices' && <>
        <section className="panel invoice-panel">
          <div className="panel-head"><div><p className="eyebrow">Invoices</p><h2>請求書一覧</h2></div><p className="section-note">見積から変換した請求書を確認できます。</p></div>
          <div className="table-wrap"><table className="data-table invoice-table"><thead><tr><th>請求書番号</th><th>取引先</th><th>金額</th><th>作成日</th><th>操作</th></tr></thead><tbody>{orgInvoices.map((invoice) => { const quote = quotes.find((candidate) => candidate.id === invoice.quoteId); return <tr key={invoice.id}><td>{invoice.invoiceNo}</td><td>{invoice.customerName}</td><td className="amount">{money(invoice.amount)}</td><td>{showDateTime(invoice.createdAt)}</td><td><div className="table-actions invoice-actions"><button disabled={!quote} onClick={() => quote && setPreview({ kind: 'invoice', invoice, quote })}>プレビュー</button></div></td></tr> })}</tbody></table></div>
        </section>
        </>}
        {activePage === 'customers' && <>
<section className="panel"><div className="panel-head"><div><p className="eyebrow">Customer master</p><h2>顧客マスタ</h2></div></div><div className="master-form"><input placeholder="顧客名" value={customerDraft.name} onChange={(event) => setCustomerDraft({ ...customerDraft, name: event.target.value })} /><input placeholder="担当者" value={customerDraft.contact} onChange={(event) => setCustomerDraft({ ...customerDraft, contact: event.target.value })} /><input placeholder="メール" value={customerDraft.email} onChange={(event) => setCustomerDraft({ ...customerDraft, email: event.target.value })} /><textarea placeholder="メモ" value={customerDraft.memo} onChange={(event) => setCustomerDraft({ ...customerDraft, memo: event.target.value })} /><button className="btn primary" onClick={saveCustomer}>{editingCustomer ? '顧客を更新' : '顧客を追加'}</button></div><div className="master-list">{orgCustomers.map((customer) => <article key={customer.id}><strong>{customer.name}</strong><span>{customer.contact} / {customer.email}</span><p>{customer.memo}</p>{isAdmin && <div><button onClick={() => { setCustomerDraft({ name: customer.name, contact: customer.contact, email: customer.email, memo: customer.memo }); setEditingCustomer(customer.id) }}>編集</button><button onClick={() => deleteCustomer(customer)}>削除</button></div>}</article>)}</div></section>
        </>}
        {activePage === 'items' && <>
<section className="panel"><div className="panel-head"><div><p className="eyebrow">Item master</p><h2>品目マスタ</h2></div></div><div className="master-form"><input placeholder="品目名" value={itemDraft.name} onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} /><input placeholder="カテゴリ" value={itemDraft.category} onChange={(event) => setItemDraft({ ...itemDraft, category: event.target.value })} /><input type="number" placeholder="単価" value={itemDraft.unitPrice} onChange={(event) => setItemDraft({ ...itemDraft, unitPrice: Math.max(0, Number(event.target.value) || 0) })} /><input placeholder="単位" value={itemDraft.unit} onChange={(event) => setItemDraft({ ...itemDraft, unit: event.target.value })} /><select value={itemDraft.taxKind} onChange={(event) => setItemDraft({ ...itemDraft, taxKind: event.target.value as TaxKind })}><option value="taxable">課税</option><option value="exempt">非課税</option></select><button className="btn primary" onClick={saveItem}>{editingItem ? '品目を更新' : '品目を追加'}</button></div><div className="master-list">{orgItems.map((item) => <article key={item.id}><strong>{item.name}</strong><span>{item.category} / {money(item.unitPrice)} / {item.unit} / {taxKindText(item.taxKind)}</span>{isAdmin && <div><button onClick={() => { setItemDraft({ name: item.name, category: item.category, unitPrice: item.unitPrice, unit: item.unit, taxKind: item.taxKind ?? 'taxable' }); setEditingItem(item.id) }}>編集</button><button onClick={() => deleteItem(item)}>削除</button></div>}</article>)}</div></section>

        </>}
        {activePage === 'settings' && <>
        <section className="panel settings-panel">
          <div className="panel-head"><div><p className="eyebrow">Settings</p><h2>設定</h2></div><p className="section-note">会社、組織、ユーザー、見積番号、税率、プランを管理します。</p></div>
          <div className="settings-page"><section className="workspace-panel"><label><span>会社 / 組織</span><select value={orgId} onChange={(event) => changeOrganization(event.target.value)}>{ORGS.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.company} / {candidate.name}</option>)}</select></label><label><span>ユーザー / ロール</span><select value={userId} onChange={(event) => setUserId(event.target.value)}>{USERS.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} / {candidate.role === 'admin' ? '管理者' : '担当者'}</option>)}</select></label><div className="workspace-meta"><strong>{org.company}</strong><span>{org.name} のデータだけを表示中</span></div></section><div className="settings-card"><div className="settings-card-head"><p className="eyebrow">Quote rules</p><h3>見積・税率設定</h3></div><div className="settings-strip"><label><span>見積番号</span><input value={settings.prefix} onChange={(event) => setSettings((prev) => ({ ...prev, prefix: event.target.value || 'Q' }))} /></label><label><span>次番号</span><input type="number" value={settings.nextNo} onChange={(event) => setSettings((prev) => ({ ...prev, nextNo: Math.max(1, Number(event.target.value) || 1) }))} /></label><label><span>税率</span><input type="number" value={settings.taxRate} onChange={(event) => setSettings((prev) => ({ ...prev, taxRate: Math.max(0, Number(event.target.value) || 0) }))} /></label><label><span>プラン</span><select value={settings.plan} onChange={(event) => setSettings((prev) => ({ ...prev, plan: event.target.value as Plan }))}><option value="free">Free（{FREE_LIMIT}件まで）</option><option value="pro">Pro（制限解除）</option></select></label></div></div></div>
        </section>
        </>}
      </main>
        </div>
      </div>

      {noteQuote && <div className="modal-overlay" onMouseDown={() => setNoteQuoteId(null)}><div className="modal-window small-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Client memo</p><h2>顧客やり取りメモ</h2><span>{noteQuote.quoteNo} / {noteQuote.customerName}</span></div><button className="btn ghost" onClick={() => setNoteQuoteId(null)}>閉じる</button></div><div className="modal-body"><textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="やり取り内容を入力" /><button className="btn primary" onClick={addNote}>メモを追加</button><div className="note-list">{noteQuote.notes.map((note) => <article key={note.id}><time>{showDateTime(note.createdAt)} / {note.author}</time><p>{note.body}</p></article>)}</div></div></div></div>}
      {preview && <div className="modal-overlay" onMouseDown={() => setPreview(null)}><div className="modal-window" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Preview</p><h2>{preview.kind === 'invoice' ? '請求書プレビュー' : '見積書プレビュー'}</h2></div><div className="modal-actions"><button className="btn primary" onClick={() => window.print()}>PDF化 / 印刷</button><button className="btn ghost" onClick={() => setPreview(null)}>閉じる</button></div></div><div className="paper-wrap"><PreviewPaper target={preview} taxRate={settings.taxRate} /></div></div></div>}
    </div>
  )
}

export default App
