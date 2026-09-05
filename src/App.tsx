
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import './App.css'
import PreviewPaper, { type Preview } from './components/PreviewPaper'
import { hasTwoDecimals, isValidLine, lineAmount, MAX_AMOUNT, totals } from './lib/money'
import {
  isGoogleProviderEnabled,
  isSupabaseConfigured,
  loadCompanyPlanAccess,
  signInWithGoogle,
  signOut,
  supabase,
  updateCompanyPlan,
  type CompanyPlanAccess,
} from './lib/supabase'
import {
  addQuoteNote,
  createInvoice,
  deleteCustomer as deleteCustomerFromDb,
  deleteItem as deleteItemFromDb,
  deleteQuote as deleteQuoteFromDb,
  importOrganizationBackup,
  loadOrganizationData,
  loadWorkspaceContext,
  saveCustomer as saveCustomerToDb,
  saveItem as saveItemToDb,
  saveQuote as saveQuoteToDb,
  saveWorkspaceSettings,
  updateQuoteStatus as updateQuoteStatusInDb,
  type BackupPayload,
} from './lib/estimateRepository'
import type {
  Activity,
  ActivityKind,
  AppUser,
  Customer,
  Invoice,
  Item,
  Line,
  Organization,
  Plan,
  Quote,
  QuoteStatus,
  Settings,
  TaxKind,
} from './types'

void React

type SortKey = 'createdAt' | 'updatedAt' | 'amount' | 'quoteNo'
type Page = 'dashboard' | 'quote' | 'invoices' | 'customers' | 'items' | 'settings'
type LocalBackup = {
  namespace: typeof KEY
  version: 1
  exportedAt: string
  source: 'shonan-dx-app-localStorage' | 'shonan-dx-app-supabase'
  data: {
    customers: Customer[]
    items: Item[]
    quotes: Quote[]
    invoices: Invoice[]
    activities: Activity[]
    settings: Settings
  }
}
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
const statusList: QuoteStatus[] = ['Pending', 'Won', 'Invoiced']
const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 })
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
const id = () => crypto.randomUUID()
const money = (n: number) => yen.format(n)
const showDateTime = (s: string) => dateTimeFmt.format(parseDateValue(s))
const dayStartMs = (s: string) => {
  const date = parseDateValue(s)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}
const days = (s: string) => Math.max(0, Math.floor((dayStartMs(today()) - dayStartMs(s)) / 86400000))
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isSettings = (value: unknown): value is Settings => {
  return isRecord(value)
    && typeof value.taxRate === 'number'
    && typeof value.prefix === 'string'
    && typeof value.year === 'number'
    && typeof value.nextNo === 'number'
    && (value.invoiceRegistrationNo === undefined || typeof value.invoiceRegistrationNo === 'string')
}
const isLocalBackup = (value: unknown): value is LocalBackup => {
  if (!isRecord(value) || value.namespace !== KEY || value.version !== 1 || !isRecord(value.data)) return false
  const data = value.data
  return Array.isArray(data.customers)
    && Array.isArray(data.items)
    && Array.isArray(data.quotes)
    && Array.isArray(data.invoices)
    && Array.isArray(data.activities)
    && isSettings(data.settings)
}
const readLegacyBrowserBackup = (): LocalBackup | null => {
  try {
    const read = <T,>(name: string, fallback: T): T => {
      const raw = localStorage.getItem(`${KEY}:${name}`)
      return raw ? JSON.parse(raw) as T : fallback
    }
    const hasLegacyData = ['customers', 'items', 'quotes', 'invoices', 'activities', 'settings']
      .some((name) => localStorage.getItem(`${KEY}:${name}`) !== null)
    if (!hasLegacyData) return null

    const candidate: LocalBackup = {
      namespace: KEY,
      version: 1,
      exportedAt: now(),
      source: 'shonan-dx-app-localStorage',
      data: {
        customers: read<Customer[]>('customers', []),
        items: read<Item[]>('items', []),
        quotes: read<Quote[]>('quotes', []),
        invoices: read<Invoice[]>('invoices', []),
        activities: read<Activity[]>('activities', []),
        settings: read<Settings>('settings', {
          taxRate: 10,
          prefix: 'Q',
          year: new Date().getFullYear(),
          nextNo: 1,
          invoiceRegistrationNo: '',
        }),
      },
    }
    return isLocalBackup(candidate) ? candidate : null
  } catch {
    return null
  }
}
const statusToDb: Record<QuoteStatus, 'pending' | 'won' | 'invoiced'> = {
  Pending: 'pending',
  Won: 'won',
  Invoiced: 'invoiced',
}
const prepareBackupPayload = (backup: LocalBackup): BackupPayload => {
  if (backup.data.invoices.length > 0) throw new Error('請求書を含むJSONの復元は、発行原本を保護するため停止しています。')
  const counts = new Map<string, number>()
  ;[...backup.data.customers, ...backup.data.items, ...backup.data.quotes, ...backup.data.invoices, ...backup.data.activities]
    .forEach((entry) => counts.set(entry.orgId, (counts.get(entry.orgId) ?? 0) + 1))
  const sourceOrgId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const sourceCustomers = backup.data.customers.filter((customer) => !sourceOrgId || customer.orgId === sourceOrgId)
  const sourceItems = backup.data.items.filter((item) => !sourceOrgId || item.orgId === sourceOrgId)
  const sourceQuotes = backup.data.quotes.filter((quote) => !sourceOrgId || quote.orgId === sourceOrgId)
  const sourceInvoices = backup.data.invoices.filter((invoice) => !sourceOrgId || invoice.orgId === sourceOrgId)
  const sourceActivities = backup.data.activities.filter((activity) => !sourceOrgId || activity.orgId === sourceOrgId)
  const customerIds = new Map(sourceCustomers.map((customer) => [customer.id, id()]))
  const itemIds = new Map(sourceItems.map((item) => [item.id, id()]))
  const quoteIds = new Map(sourceQuotes.map((quote) => [quote.id, id()]))

  return {
    settings: {
      prefix: backup.data.settings.prefix,
      year: backup.data.settings.year,
      next_sequence: backup.data.settings.nextNo,
      tax_rate: backup.data.settings.taxRate,
      invoice_registration_no: backup.data.settings.invoiceRegistrationNo ?? '',
    },
    customers: sourceCustomers.map((customer) => ({
      id: customerIds.get(customer.id),
      name: customer.name,
      address: customer.address ?? '',
      phone: customer.phone ?? '',
      contact: customer.contact ?? '',
      contact_title: customer.contactTitle ?? '',
      email: customer.email ?? '',
      invoice_registration_no: customer.invoiceRegistrationNo ?? '',
      memo: customer.memo ?? '',
    })),
    items: sourceItems.map((item) => ({
      id: itemIds.get(item.id),
      name: item.name,
      category: item.category,
      unit_price: item.unitPrice,
      unit: item.unit,
      tax_kind: item.taxKind ?? 'taxable',
    })),
    quotes: sourceQuotes.flatMap((quote) => {
      const customerId = customerIds.get(quote.customerId)
      const quoteId = quoteIds.get(quote.id)
      if (!customerId || !quoteId) return []
      return [{
        id: quoteId,
        customer_id: customerId,
        quote_no: quote.quoteNo,
        project: quote.project,
        memo: quote.memo,
        amount: quote.amount,
        status: statusToDb[quote.status],
        created_at: quote.createdAt,
        updated_at: quote.updatedAt,
      }]
    }),
    quote_items: sourceQuotes.flatMap((quote) => {
      const quoteId = quoteIds.get(quote.id)
      if (!quoteId) return []
      return quote.lines.map((line, index) => ({
        id: id(),
        quote_id: quoteId,
        item_master_id: line.isCustom ? null : itemIds.get(line.itemId) ?? null,
        name: line.name,
        unit: line.unit,
        unit_price: line.unitPrice,
        quantity: line.quantity,
        tax_kind: line.taxKind ?? 'taxable',
        sort_order: index,
      }))
    }),
    notes: sourceQuotes.flatMap((quote) => {
      const quoteId = quoteIds.get(quote.id)
      if (!quoteId) return []
      return quote.notes.map((note) => ({
        id: id(),
        quote_id: quoteId,
        author_display_name: note.author,
        body: note.body,
        created_at: note.createdAt,
      }))
    }),
    invoices: sourceInvoices.flatMap((invoice) => {
      const quoteId = quoteIds.get(invoice.quoteId)
      if (!quoteId) return []
      return [{
        id: id(),
        quote_id: quoteId,
        invoice_no: invoice.invoiceNo,
        amount: invoice.amount,
        created_at: invoice.createdAt,
      }]
    }),
    activities: sourceActivities.map((activity) => ({
      id: id(),
      kind: activity.kind,
      title: activity.title,
      description: activity.description,
      created_at: activity.createdAt,
    })),
  }
}
const lineFrom = (item: Item): Line => ({ id: id(), itemId: item.id, name: item.name, unitPrice: item.unitPrice, quantity: 1, unit: item.unit, taxKind: item.taxKind ?? 'taxable' })
const customLine = (): Line => ({ id: id(), itemId: '', name: '自由入力項目', unitPrice: 0, quantity: 1, unit: '式', taxKind: 'taxable', isCustom: true })
const taxKindText = (taxKind?: TaxKind) => taxKind === 'exempt' ? '非課税' : '課税'
const customerContactText = (customer: Customer) => [customer.contactTitle, customer.contact].filter(Boolean).join(' ') || '未登録'
const customerSummary = (customer: Customer) => `住所: ${customer.address || '未登録'} / 電話: ${customer.phone || '未登録'} / 担当者: ${customerContactText(customer)} / メール: ${customer.email || '未登録'} / INVOICE NO.（企業コード）: ${customer.invoiceRegistrationNo || '未登録'} / ${customer.memo}`
function StatusBadge({ status }: { status: QuoteStatus }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{statusText[status]}</span>
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
      <section className='login-visual'>
        <div className='login-visual-content'>
          <p className='eyebrow'>Shonan DX Lab / 見積管理・請求書作成アプリ</p>
          <h1>Estimate Management</h1>
          <p>見積から請求まで、仕事の流れを整える。</p>
          <p>業務データはSupabaseに保存され、所属組織のメンバー間で同期されます。</p>
          <div className='login-feature-list'>
            <span>見積作成と進捗管理</span>
            <span>請求書へのスムーズな変換</span>
            <span>組織単位のアクセス制御</span>
          </div>
          <a className='login-site-link' href='https://shonan-dx.com/' target='_blank' rel='noreferrer'>湘南DXラボ 本体サイトへ</a>
        </div>
      </section>
      <section className='login-panel'>
        <div className='login-card'>
          <div className='login-mark'>E</div>
          <div>
            <p className='eyebrow'>Welcome back</p>
            <h2>ログイン</h2>
            <p className='login-description'>招待されたGoogleアカウントでログインしてください。</p>
            <p className='login-safety-note'>組織データはRLSで保護され、管理者の承認後に利用できます。</p>
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

type UnitPriceInputProps = {
  value: number
  onChange: (value: number) => void
}

function UnitPriceInput({ value, onChange }: UnitPriceInputProps) {
  const [draft, setDraft] = useState(String(value))

  const updateDraft = (next: string) => {
    if (!/^\d*$/.test(next)) return
    setDraft(next)
    if (next !== '') onChange(Number(next))
  }

  const commitDraft = () => {
    const next = Math.max(0, Math.trunc(Number(draft) || 0))
    setDraft(String(next))
    onChange(next)
  }

  return (
    <input
      type='number'
      min='0'
      step='1'
      inputMode='numeric'
      aria-label='単価'
      value={draft}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => updateDraft(event.target.value)}
      onBlur={commitDraft}
    />
  )
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured)
  const [authPending, setAuthPending] = useState(false)
  const [authError, setAuthError] = useState('')
  const [planAccess, setPlanAccess] = useState<CompanyPlanAccess>({ companies: [], isPlatformAdmin: false })
  const [planLoading, setPlanLoading] = useState(isSupabaseConfigured)
  const [planPendingCompanyId, setPlanPendingCompanyId] = useState<string | null>(null)
  const [workspaceUser, setWorkspaceUser] = useState<AppUser | null>(null)
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [orgId, setOrgId] = useState('')
  const [dataLoading, setDataLoading] = useState(isSupabaseConfigured)
  const [mutationPending, setMutationPending] = useState(false)
  const [legacyBackupAvailable] = useState(() => Boolean(readLegacyBrowserBackup()))
  const [customers, setCustomers] = useState<Customer[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [settings, setSettings] = useState<Settings>({ taxRate: 10, prefix: 'Q', year: new Date().getFullYear(), nextNo: 1, invoiceRegistrationNo: '' })
  const [savedTaxRate, setSavedTaxRate] = useState(10)
  const [savedRegistrationNo, setSavedRegistrationNo] = useState('')
  const [customerDraft, setCustomerDraft] = useState<Omit<Customer, 'id' | 'orgId'>>({ name: '', address: '', phone: '', contact: '', contactTitle: '', email: '', invoiceRegistrationNo: '', memo: '' })
  const [editingCustomer, setEditingCustomer] = useState<string | null>(null)
  const [itemDraft, setItemDraft] = useState<{ name: string; category: string; unitPrice: number; unit: string; taxKind: TaxKind }>({ name: '', category: '', unitPrice: 0, unit: '式', taxKind: 'taxable' })
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState('')
  const [project, setProject] = useState('コーポレートサイト見積')
  const [memo, setMemo] = useState('見積有効期限は30日です。要件確定後に最終調整いたします。')
  const [lines, setLines] = useState<Line[]>([])
  const [editingQuote, setEditingQuote] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'All' | QuoteStatus>('All')
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [noteQuoteId, setNoteQuoteId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [message, setMessage] = useState('')
  const [activePage, setActivePage] = useState<Page>('dashboard')

  const org = organizations.find((candidate) => candidate.id === orgId) ?? null
  const user = workspaceUser
  const orgCustomers = customers.filter((customer) => customer.orgId === orgId)
  const orgItems = items.filter((item) => item.orgId === orgId)
  const orgQuotes = quotes.filter((quote) => quote.orgId === orgId)
  const orgInvoices = invoices.filter((invoice) => invoice.orgId === orgId)
  const formTaxRate = quotes.find((quote) => quote.id === editingQuote)?.taxRate ?? savedTaxRate
  const currentTotals = useMemo(() => totals(lines, formTaxRate), [lines, formTaxRate])
  const noteQuote = quotes.find((quote) => quote.id === noteQuoteId) ?? null
  const isAdmin = org?.role === 'admin'
  const currentCompanyPlan = planAccess.companies.find((company) => company.id === org?.companyId)
  const activePlan = currentCompanyPlan?.plan ?? org?.plan ?? 'free'
  const activeFreeQuoteLimit = currentCompanyPlan?.freeQuoteLimit ?? org?.freeQuoteLimit ?? FREE_LIMIT
  const canAddQuote = activePlan === 'pro' || orgQuotes.length < activeFreeQuoteLimit
  const nextQuoteNo = `${settings.prefix}-${settings.year}-${String(settings.nextNo).padStart(3, '0')}`

  useEffect(() => {
    if (!isSupabaseConfigured) return

    let active = true
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) setAuthError(authErrorText(error))
      if (data.session) {
        setDataLoading(true)
        setPlanLoading(true)
      }
      setSession(data.session)
      setAuthReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      if (next) {
        setDataLoading(true)
        setPlanLoading(true)
      }
      setSession(next)
      setAuthReady(true)
      if (next) setAuthError('')
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])
  useEffect(() => {
    if (!isSupabaseConfigured || !session) return

    let active = true
    void Promise.all([
      loadWorkspaceContext(session.user),
      loadCompanyPlanAccess(session.user.id),
    ])
      .then(([workspace, access]) => {
        if (!active) return
        setWorkspaceUser(workspace.user)
        setOrganizations(workspace.organizations)
        setOrgId((previous) => workspace.organizations.some((organization) => organization.id === previous)
          ? previous
          : workspace.organizations[0]?.id ?? '')
        setSelectedCustomer('')
        setLines([])
        setEditingQuote(null)
        setPlanAccess(access)
        if (workspace.organizations.length === 0) setDataLoading(false)
      })
      .catch(() => {
        if (!active) return
        setMessage('所属組織と契約プランを取得できませんでした。時間をおいて再読み込みしてください。')
        setDataLoading(false)
      })
      .finally(() => {
        if (active) setPlanLoading(false)
      })

    return () => {
      active = false
    }
  }, [session])

  const applyOrganizationData = useCallback((data: Awaited<ReturnType<typeof loadOrganizationData>>) => {
    setCustomers(data.customers)
    setItems(data.items)
    setQuotes(data.quotes)
    setInvoices(data.invoices)
    setActivities(data.activities)
    setSettings(data.settings)
    setSavedTaxRate(data.settings.taxRate)
    setSavedRegistrationNo(data.settings.invoiceRegistrationNo)
    setSelectedCustomer((previous) => data.customers.some((customer) => customer.id === previous)
      ? previous
      : data.customers[0]?.id ?? '')
    setLines((previous) => previous.length > 0
      ? previous
      : data.items[0] ? [lineFrom(data.items[0])] : [customLine()])
  }, [])

  const refreshOrganization = useCallback(async (organization: Organization) => {
    const data = await loadOrganizationData(organization)
    applyOrganizationData(data)
    return data
  }, [applyOrganizationData])

  useEffect(() => {
    if (!org) return

    let active = true
    void loadOrganizationData(org)
      .then((data) => {
        if (active) applyOrganizationData(data)
      })
      .catch(() => {
        if (active) setMessage('組織データを取得できませんでした。再読み込みしてください。')
      })
      .finally(() => {
        if (active) setDataLoading(false)
      })
    return () => {
      active = false
    }
  }, [applyOrganizationData, org])

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

  const handlePlanChange = async (companyId: string, plan: Plan) => {
    if (!planAccess.isPlatformAdmin || planPendingCompanyId) return

    setPlanPendingCompanyId(companyId)
    try {
      const updated = await updateCompanyPlan(companyId, plan)
      setPlanAccess((previous) => ({
        ...previous,
        companies: previous.companies.map((company) => company.id === updated.id ? updated : company),
      }))
      setMessage(`${updated.name} の契約プランを ${plan === 'pro' ? 'Pro' : 'Free'} に変更しました。`)
    } catch {
      setMessage('契約プランを変更できませんでした。管理者権限を確認してください。')
    } finally {
      setPlanPendingCompanyId(null)
    }
  }

  const exportBackup = () => {
    const backup: LocalBackup = {
      namespace: KEY,
      version: 1,
      exportedAt: now(),
      source: 'shonan-dx-app-supabase',
      data: { customers, items, quotes, invoices, activities, settings },
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `shonan-dx-app-backup-${today()}.json`
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    setMessage('画面取得済みデータをJSONへ書き出しました。履歴は最大200件のため、全件バックアップではありません。')
  }

  const importBackup = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!org || !isAdmin) return setMessage('JSONの復元は組織管理者だけが実行できます。')
    if (!window.confirm(`${org.company} / ${org.name} のDBデータを、選択したJSONバックアップで置き換えます。実行しますか？`)) return

    const reader = new FileReader()
    reader.onerror = () => setMessage('JSONバックアップを読み込めませんでした。ファイルを確認してください。')
    reader.onload = async () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result ?? ''))
        if (!isLocalBackup(parsed)) {
          setMessage('shonan-dx-appのJSONバックアップとして読み込めませんでした。')
          return
        }
        setMutationPending(true)
        await importOrganizationBackup(org.id, prepareBackupPayload(parsed))
        const data = await refreshOrganization(org)
        setSelectedCustomer(data.customers[0]?.id ?? '')
        setLines(data.items[0] ? [lineFrom(data.items[0])] : [customLine()])
        setEditingQuote(null)
        setEditingCustomer(null)
        setEditingItem(null)
        setMessage('JSONバックアップをSupabaseへ復元しました。')
      } catch {
        setMessage('JSONを復元できませんでした。内容、管理者権限、プラン上限を確認してください。')
      } finally {
        setMutationPending(false)
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  const migrateLegacyBrowserData = async () => {
    if (!org || !isAdmin || mutationPending) return
    const backup = readLegacyBrowserBackup()
    if (!backup) return setMessage('このブラウザに移行できる旧データはありません。')
    if (!window.confirm(`${org.company} / ${org.name} のDBデータを、このブラウザの旧データで置き換えます。実行しますか？`)) return

    setMutationPending(true)
    try {
      await importOrganizationBackup(org.id, prepareBackupPayload(backup))
      const data = await refreshOrganization(org)
      setSelectedCustomer(data.customers[0]?.id ?? '')
      setLines(data.items[0] ? [lineFrom(data.items[0])] : [customLine()])
      setEditingQuote(null)
      setEditingCustomer(null)
      setEditingItem(null)
      setMessage('このブラウザの旧データをSupabaseへ移行しました。旧データは復旧用としてブラウザ内に残しています。')
    } catch {
      setMessage('旧データを移行できませんでした。内容、管理者権限、プラン上限を確認してください。')
    } finally {
      setMutationPending(false)
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

  const updateQuoteStatus = async (quote: Quote, status: QuoteStatus) => {
    if (!org || mutationPending || quote.status === status || quote.invoiceNo || quote.status === 'Invoiced' || status === 'Invoiced') return
    setMutationPending(true)
    try {
      await updateQuoteStatusInDb(quote.id, status)
      await refreshOrganization(org)
      setMessage(`${quote.quoteNo} を${statusText[status]}に変更しました。`)
    } catch {
      setMessage('ステータスを変更できませんでした。権限と通信状態を確認してください。')
    } finally {
      setMutationPending(false)
    }
  }
  const changeOrganization = (nextOrgId: string) => {
    setDataLoading(true)
    setOrgId(nextOrgId)
    setCustomers([])
    setItems([])
    setQuotes([])
    setInvoices([])
    setActivities([])
    setSelectedCustomer('')
    setLines([])
    setEditingQuote(null)
  }
  const resetForm = () => {
    if (orgCustomers[0]) setSelectedCustomer(orgCustomers[0].id)
    setLines(orgItems[0] ? [lineFrom(orgItems[0])] : [customLine()])
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
    if (field === 'unitPrice' || field === 'quantity') return { ...line, [field]: Math.max(0, Number(value) || 0) }
    return { ...line, [field]: value }
  }))
  const submitQuote = async () => {
    if (!org || mutationPending) return
    const customer = customers.find((candidate) => candidate.id === selectedCustomer)
    if (!customer) return setMessage('顧客を選択してください。')
    if (lines.length === 0 || lines.some((line) => !line.name.trim() || !isValidLine(line))) return setMessage('単価は0以上の整数、数量は0より大きい小数2桁以内で入力してください。')
    if (!hasTwoDecimals(formTaxRate) || formTaxRate < 0 || formTaxRate > 100 || currentTotals.total > MAX_AMOUNT) return setMessage('税率は0〜100%の小数2桁以内、合計金額は2,147,483,647円以内で入力してください。')
    if (!canAddQuote && !editingQuote) return setMessage(`フリープランは見積${activeFreeQuoteLimit}件までです。Proへの変更は運営管理者へお問い合わせください。`)
    const previous = editingQuote ? quotes.find((quote) => quote.id === editingQuote) : undefined
    if (previous?.invoiceNo || previous?.status === 'Invoiced') return setMessage('請求書化済みの見積は編集できません。複製して新しい見積を作成してください。')
    if (previous && previous.taxRate == null && !window.confirm(`この見積には当時の税率がありません。税率${formTaxRate}%・合計${money(currentTotals.total)}で内容を確認し、更新しますか？`)) return
    setMutationPending(true)
    try {
      const quoteId = previous?.id ?? id()
      await saveQuoteToDb({
        organizationId: org.id,
        quoteId,
        customerId: customer.id,
        project,
        memo,
        lines,
        expectedAmount: currentTotals.total,
      })
      const data = await refreshOrganization(org)
      const saved = data.quotes.find((quote) => quote.id === quoteId)
      setMessage(previous ? `${saved?.quoteNo ?? previous.quoteNo} を更新しました。` : `${saved?.quoteNo ?? nextQuoteNo} を作成しました。`)
      resetForm()
    } catch (error) {
      const detail = error instanceof Error ? error.message : ''
      setMessage(detail.includes('quote total changed')
        ? '保存直前に税率・金額が変わりました。保存は取り消されています。画面を再読み込みして金額を確認してください。'
        : detail.includes('free plan quote limit reached')
        ? `フリープランは見積${activeFreeQuoteLimit}件までです。`
        : '見積を保存できませんでした。入力内容、権限、通信状態を確認してください。')
    } finally {
      setMutationPending(false)
    }
  }
  const editQuote = (quote: Quote) => {
    if (quote.invoiceNo || quote.status === 'Invoiced') return setMessage('請求書化済みの見積は編集できません。')
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
    setLines(quote.lines.map((line) => ({ ...line, id: id() })))
    setEditingQuote(null)
    setActivePage('quote')
    setMessage(`${quote.quoteNo} を複製して入力フォームへ展開しました。`)
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  }
  const deleteQuote = async (quote: Quote) => {
    if (!org || !isAdmin || mutationPending || quote.invoiceNo || quote.status === 'Invoiced') return
    if (!window.confirm(`${quote.quoteNo} を削除しますか？`)) return
    setMutationPending(true)
    try {
      await deleteQuoteFromDb(org.id, quote.id)
      await refreshOrganization(org)
      setMessage(`${quote.quoteNo} を削除しました。`)
    } catch {
      setMessage('見積を削除できませんでした。権限と通信状態を確認してください。')
    } finally {
      setMutationPending(false)
    }
  }
  const convertToInvoice = async (quote: Quote) => {
    if (!org || mutationPending) return
    const existing = invoices.find((invoice) => invoice.quoteId === quote.id)
    if (existing) return setPreview({ kind: 'invoice', invoice: existing, quote })
    if (!isAdmin) return setMessage('請求書化は組織管理者だけが実行できます。')
    if (quote.taxRate == null) return setMessage('作成時の税率が未確認です。見積を編集し、内容・税率・合計を確認して保存してください。')
    if (!window.confirm(`${quote.quoteNo} を請求書化しますか？発行時の内容が固定され、この見積と請求書は編集・削除できなくなります。`)) return
    setMutationPending(true)
    try {
      await createInvoice(quote.id)
      const data = await refreshOrganization(org)
      const invoice = data.invoices.find((candidate) => candidate.quoteId === quote.id)
      const converted = data.quotes.find((candidate) => candidate.id === quote.id)
      if (invoice && converted) setPreview({ kind: 'invoice', invoice, quote: converted })
      setMessage(`${quote.quoteNo} から ${invoice?.invoiceNo ?? '請求書'} を作成しました。`)
    } catch {
      setMessage('請求書を作成できませんでした。権限と通信状態を確認してください。')
    } finally {
      setMutationPending(false)
    }
  }
  const saveCustomer = async () => {
    if (!org || mutationPending || !customerDraft.name.trim()) return
    setMutationPending(true)
    try {
      await saveCustomerToDb(org.id, editingCustomer, customerDraft)
      const wasEditing = Boolean(editingCustomer)
      const data = await refreshOrganization(org)
      setEditingCustomer(null)
      setCustomerDraft({ name: '', address: '', phone: '', contact: '', contactTitle: '', email: '', invoiceRegistrationNo: '', memo: '' })
      if (!wasEditing) {
        const created = data.customers.find((customer) => customer.name === customerDraft.name.trim())
        if (created) setSelectedCustomer(created.id)
      }
      setMessage(wasEditing ? '顧客情報を更新しました。' : '顧客を追加しました。')
    } catch {
      setMessage('顧客を保存できませんでした。権限と通信状態を確認してください。')
    } finally {
      setMutationPending(false)
    }
  }
  const deleteCustomer = async (customer: Customer) => {
    if (!org || mutationPending) return
    if (orgQuotes.some((quote) => quote.customerId === customer.id)) return setMessage('見積に使われている顧客は削除できません。')
    if (!window.confirm(`${customer.name} を削除しますか？`)) return
    setMutationPending(true)
    try {
      await deleteCustomerFromDb(org.id, customer.id)
      await refreshOrganization(org)
      setMessage(`${customer.name} を削除しました。`)
    } catch {
      setMessage('顧客を削除できませんでした。見積で使用中でないか確認してください。')
    } finally {
      setMutationPending(false)
    }
  }
  const saveItem = async () => {
    if (!org || mutationPending || !itemDraft.name.trim()) return
    setMutationPending(true)
    try {
      const wasEditing = Boolean(editingItem)
      await saveItemToDb(org.id, editingItem, itemDraft)
      await refreshOrganization(org)
      setEditingItem(null)
      setItemDraft({ name: '', category: '', unitPrice: 0, unit: '式', taxKind: 'taxable' })
      setMessage(wasEditing ? '品目を更新しました。' : '品目を追加しました。')
    } catch {
      setMessage('品目を保存できませんでした。権限と通信状態を確認してください。')
    } finally {
      setMutationPending(false)
    }
  }
  const deleteItem = async (item: Item) => {
    if (!org || mutationPending) return
    if (lines.some((line) => line.itemId === item.id) || orgQuotes.some((quote) => quote.lines.some((line) => line.itemId === item.id))) return setMessage('使用中の品目は削除できません。')
    if (!window.confirm(`${item.name} を削除しますか？`)) return
    setMutationPending(true)
    try {
      await deleteItemFromDb(org.id, item.id)
      await refreshOrganization(org)
      setMessage(`${item.name} を削除しました。`)
    } catch {
      setMessage('品目を削除できませんでした。見積で使用中でないか確認してください。')
    } finally {
      setMutationPending(false)
    }
  }
  const addNote = async () => {
    if (!org || mutationPending || !noteQuote || !noteDraft.trim()) return
    setMutationPending(true)
    try {
      await addQuoteNote(noteQuote.id, noteDraft.trim())
      setNoteDraft('')
      await refreshOrganization(org)
      setMessage(`${noteQuote.quoteNo} にメモを追加しました。`)
    } catch {
      setMessage('メモを追加できませんでした。権限と通信状態を確認してください。')
    } finally {
      setMutationPending(false)
    }
  }
  const persistSettings = async () => {
    if (!org || !isAdmin || mutationPending) return
    if (!hasTwoDecimals(settings.taxRate) || settings.taxRate < 0 || settings.taxRate > 100 || !Number.isInteger(settings.nextNo) || settings.nextNo < 1) return setMessage('税率は0〜100%の小数2桁以内、次番号は1以上の整数で入力してください。')
    setMutationPending(true)
    try {
      await saveWorkspaceSettings(org.id, settings)
      setOrganizations((previous) => previous.map((organization) => organization.id === org.id
        ? { ...organization, invoiceRegistrationNo: settings.invoiceRegistrationNo }
        : organization))
      await refreshOrganization({ ...org, invoiceRegistrationNo: settings.invoiceRegistrationNo })
      setMessage('見積番号、税率、企業コードを保存しました。')
    } catch {
      setMessage('設定を保存できませんでした。管理者権限と入力内容を確認してください。')
    } finally {
      setMutationPending(false)
    }
  }
  const draftPreview = () => {
    if (!org) return
    if (!lines.length || lines.some((line) => !line.name.trim() || !isValidLine(line)) || currentTotals.total > MAX_AMOUNT) return setMessage('見積明細の品目名、整数の単価、数量（小数2桁以内）、合計金額を確認してください。')
    const customer = customers.find((candidate) => candidate.id === selectedCustomer)
    if (!customer) return
    setPreview({ kind: 'quote', quote: { id: 'draft', orgId, quoteNo: editingQuote ? quotes.find((quote) => quote.id === editingQuote)?.quoteNo ?? nextQuoteNo : nextQuoteNo, customerId: customer.id, customerName: customer.name, project, amount: currentTotals.total, status: 'Pending', createdAt: now(), updatedAt: now(), memo, lines, notes: [], taxRate: formTaxRate } })
  }
  const selectedCustomerData = orgCustomers.find((customer) => customer.id === selectedCustomer)

  if (isSupabaseConfigured && (!authReady || !session)) {
    return <LoginScreen checking={!authReady} pending={authPending} error={authError} onGoogleLogin={() => void handleGoogleLogin()} />
  }

  if (!isSupabaseConfigured) {
    return <main className="login-panel"><div className="login-card"><h1>Supabase設定が必要です</h1><p className="login-description">`.env.local` に接続先を設定してから起動してください。</p></div></main>
  }

  if (dataLoading) {
    return <main className="login-panel"><div className="login-card"><div className="login-status"><span className="login-spinner" />組織データを読み込んでいます</div></div></main>
  }

  if (!org || !user) {
    return <main className="login-panel"><div className="login-card"><p className="eyebrow">Organization access</p><h1>組織への参加承認をお待ちください</h1><p className="login-description">Googleログインは完了しています。組織管理者が参加申請を承認すると、業務データを利用できます。</p><button className="btn ghost" onClick={() => void signOut()}>ログアウト</button></div></main>
  }

  return (
    <div className="app-shell">
      <header className="topbar" data-ui-version="notion-clean-20260708">
        <div><p className="eyebrow">見積管理・請求書作成アプリ</p><h1>Estimate Management</h1></div>
        <div className="auth-card"><span className="sync-dot active" /><div><strong>{org.company} / {org.name}</strong><span>{user.name} / {org.role === 'admin' ? '管理者' : '担当者'} ・ {session?.user.email}</span></div><button className="btn ghost" onClick={() => void signOut()}>ログアウト</button></div>
      </header>
      <section className="phase-banner" role="status" aria-label="データの保存状態">
        <div>
          <p className="eyebrow">Cloud sync / Supabase</p>
          <strong>業務データはSupabaseへ保存されます。</strong>
          <span>顧客・品目・見積・請求書・更新履歴・設定は組織単位で同期され、RLSで所属組織だけに制限されます。</span>
        </div>
        <button className="btn ghost" type="button" onClick={() => setActivePage('settings')}>バックアップへ</button>
      </section>
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
          <div className="table-wrap"><table className="data-table"><thead><tr><th>見積番号</th><th>取引先</th><th>案件名</th><th>金額</th><th>ステータス</th><th>経過</th><th>提出日</th><th>更新日</th><th>操作</th></tr></thead><tbody>{filteredQuotes.map((quote) => { const waiting = days(quote.createdAt); const attention = quote.status === 'Pending' && waiting >= 10; return <tr key={quote.id} className={attention ? 'row-alert' : undefined}><td><span className={attention ? 'dot danger' : 'dot'} />{quote.quoteNo}</td><td>{quote.customerName}</td><td>{quote.project}</td><td className="amount">{money(quote.amount)}</td><td><StatusBadge status={quote.status} /><select className="compact-select" value={quote.status} disabled={mutationPending || Boolean(quote.invoiceNo) || quote.status === 'Invoiced'} onChange={(event) => void updateQuoteStatus(quote, event.target.value as QuoteStatus)}>{statusList.filter((status) => status !== 'Invoiced' || quote.status === 'Invoiced').map((status) => <option key={status} value={status}>{statusText[status]}</option>)}</select></td><td className={attention ? 'danger-text' : undefined}>{quote.status === 'Pending' ? `${waiting}日経過` : '対応完了'}</td><td>{showDateTime(quote.createdAt)}</td><td>{showDateTime(quote.updatedAt)}</td><td><div className="table-actions"><button onClick={() => setPreview({ kind: 'quote', quote })}>プレビュー</button><button disabled={Boolean(quote.invoiceNo) || quote.status === 'Invoiced'} onClick={() => editQuote(quote)}>編集</button><button onClick={() => duplicateQuote(quote)}>複製</button><button disabled={mutationPending || !isAdmin || (!quote.invoiceNo && quote.taxRate == null)} onClick={() => void convertToInvoice(quote)}>{quote.invoiceNo ? '請求書を確認' : '請求書化'}</button><button onClick={() => setNoteQuoteId(quote.id)}>メモ {quote.notes.length}</button><button className="danger-button" disabled={mutationPending || !isAdmin || Boolean(quote.invoiceNo) || quote.status === 'Invoiced'} onClick={() => void deleteQuote(quote)}>削除</button></div></td></tr> })}</tbody></table></div>
        </section>
        </>}
        {activePage === 'quote' && <>
        <section className="panel quote-panel">
          <div className="panel-head"><div><p className="eyebrow">Speed quote</p><h2>{editingQuote ? '見積編集' : '見積入力'}</h2></div></div>
          <div className="quote-layout"><div className="quote-form"><div className="field-grid"><label><span>顧客名</span><select value={selectedCustomer} onChange={(event) => setSelectedCustomer(event.target.value)}>{orgCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label><span>案件名</span><input value={project} onChange={(event) => setProject(event.target.value)} /></label></div><div className="customer-hint">{selectedCustomerData ? customerSummary(selectedCustomerData) : '顧客マスタを追加してください。'}</div><div className="form-table-wrap"><table className="line-table"><thead><tr><th>品目</th><th>税区分</th><th>単価</th><th>数量</th><th>金額</th><th></th></tr></thead><tbody>{lines.map((line) => <tr key={line.id}><td>{line.isCustom ? <input value={line.name} onChange={(event) => changeLine(line.id, 'name', event.target.value)} placeholder="自由入力項目" /> : <select value={line.itemId} onChange={(event) => changeLine(line.id, 'itemId', event.target.value)}>{orgItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}</td><td><select value={line.taxKind ?? 'taxable'} onChange={(event) => changeLine(line.id, 'taxKind', event.target.value)}><option value="taxable">課税</option><option value="exempt">非課税</option></select></td><td><UnitPriceInput key={`${line.id}-${line.itemId}`} value={line.unitPrice} onChange={(value) => changeLine(line.id, 'unitPrice', String(value))} /></td><td><input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => changeLine(line.id, 'quantity', event.target.value)} /></td><td className="amount">{money(lineAmount(line))}</td><td><button disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((candidate) => candidate.id !== line.id))}>x</button></td></tr>)}</tbody></table></div><div className="quote-footer"><div className="line-add-actions"><button className="btn ghost" onClick={() => orgItems[0] && setLines((prev) => [...prev, lineFrom(orgItems[0])])}>+ マスタ明細を追加</button><button className="btn ghost" onClick={() => setLines((prev) => [...prev, customLine()])}>+ 自由明細を追加</button></div><div className="summary-inline"><span>小計 {money(currentTotals.sub)}</span><span>課税対象 {money(currentTotals.taxable)}</span><span>消費税（{formTaxRate}%）{money(currentTotals.tax)}</span><strong>合計 {money(currentTotals.total)}</strong></div></div><label className="memo-field"><span>メモ</span><textarea value={memo} onChange={(event) => setMemo(event.target.value)} /></label><div className="quote-actions"><button className="btn ghost" onClick={resetForm}>入力をリセット</button><button className="btn ghost" onClick={draftPreview}>見積書を確認</button><button className="btn primary" disabled={mutationPending || !selectedCustomer} onClick={() => void submitQuote()}>{mutationPending ? '保存中' : editingQuote ? '更新する' : '見積を保存'}</button></div></div></div>
        </section>
        </>}
        {activePage === 'invoices' && <>
        <section className="panel invoice-panel">
          <div className="panel-head"><div><p className="eyebrow">Invoices</p><h2>請求書一覧</h2></div><p className="section-note">見積から変換した請求書を確認できます。</p></div>
          <div className="table-wrap"><table className="data-table invoice-table"><thead><tr><th>請求書番号</th><th>取引先</th><th>金額</th><th>作成日</th><th>操作</th></tr></thead><tbody>{orgInvoices.map((invoice) => { const quote = quotes.find((candidate) => candidate.id === invoice.quoteId); return <tr key={invoice.id}><td>{invoice.invoiceNo}{!invoice.snapshot && <span className="danger-text">（要原本確認）</span>}</td><td>{invoice.customerName}</td><td className="amount">{money(invoice.amount)}</td><td>{showDateTime(invoice.createdAt)}</td><td><div className="table-actions invoice-actions"><button disabled={!quote} onClick={() => quote && setPreview({ kind: 'invoice', invoice, quote })}>プレビュー</button></div></td></tr> })}</tbody></table></div>
        </section>
        </>}
        {activePage === 'customers' && <>
<section className="panel"><div className="panel-head"><div><p className="eyebrow">Customer master</p><h2>顧客マスタ</h2></div></div><div className="master-form"><input placeholder="顧客名" value={customerDraft.name} onChange={(event) => setCustomerDraft({ ...customerDraft, name: event.target.value })} /><input placeholder="住所" value={customerDraft.address} onChange={(event) => setCustomerDraft({ ...customerDraft, address: event.target.value })} /><input type="tel" placeholder="電話番号" value={customerDraft.phone} onChange={(event) => setCustomerDraft({ ...customerDraft, phone: event.target.value })} /><input placeholder="担当者" value={customerDraft.contact} onChange={(event) => setCustomerDraft({ ...customerDraft, contact: event.target.value })} /><input placeholder="担当者の役職" value={customerDraft.contactTitle} onChange={(event) => setCustomerDraft({ ...customerDraft, contactTitle: event.target.value })} /><input placeholder="メール" value={customerDraft.email} onChange={(event) => setCustomerDraft({ ...customerDraft, email: event.target.value })} /><input placeholder="INVOICE NO.（企業コード）" value={customerDraft.invoiceRegistrationNo} onChange={(event) => setCustomerDraft({ ...customerDraft, invoiceRegistrationNo: event.target.value })} /><textarea placeholder="メモ" value={customerDraft.memo} onChange={(event) => setCustomerDraft({ ...customerDraft, memo: event.target.value })} /><button className="btn primary" disabled={mutationPending} onClick={() => void saveCustomer()}>{mutationPending ? '保存中' : editingCustomer ? '顧客を更新' : '顧客を追加'}</button></div><div className="master-list">{orgCustomers.map((customer) => <article key={customer.id}><strong>{customer.name}</strong><span>住所: {customer.address || '未登録'}</span><span>電話: {customer.phone || '未登録'} / メール: {customer.email || '未登録'}</span><span>担当者: {customerContactText(customer)}</span><span>INVOICE NO.（企業コード）: {customer.invoiceRegistrationNo || '未登録'}</span><p>{customer.memo}</p>{isAdmin && <div><button onClick={() => { setCustomerDraft({ name: customer.name, address: customer.address, phone: customer.phone, contact: customer.contact, contactTitle: customer.contactTitle, email: customer.email, invoiceRegistrationNo: customer.invoiceRegistrationNo, memo: customer.memo }); setEditingCustomer(customer.id) }}>編集</button><button disabled={mutationPending} onClick={() => void deleteCustomer(customer)}>削除</button></div>}</article>)}</div></section>
        </>}
        {activePage === 'items' && <>
<section className="panel"><div className="panel-head"><div><p className="eyebrow">Item master</p><h2>品目マスタ</h2></div></div><div className="master-form"><input placeholder="品目名" value={itemDraft.name} onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} /><input placeholder="カテゴリ" value={itemDraft.category} onChange={(event) => setItemDraft({ ...itemDraft, category: event.target.value })} /><input type="number" placeholder="単価" value={itemDraft.unitPrice} onChange={(event) => setItemDraft({ ...itemDraft, unitPrice: Math.max(0, Number(event.target.value) || 0) })} /><input placeholder="単位" value={itemDraft.unit} onChange={(event) => setItemDraft({ ...itemDraft, unit: event.target.value })} /><select value={itemDraft.taxKind} onChange={(event) => setItemDraft({ ...itemDraft, taxKind: event.target.value as TaxKind })}><option value="taxable">課税</option><option value="exempt">非課税</option></select><button className="btn primary" disabled={mutationPending} onClick={() => void saveItem()}>{mutationPending ? '保存中' : editingItem ? '品目を更新' : '品目を追加'}</button></div><div className="master-list">{orgItems.map((item) => <article key={item.id}><strong>{item.name}</strong><span>{item.category} / {money(item.unitPrice)} / {item.unit} / {taxKindText(item.taxKind)}</span>{isAdmin && <div><button onClick={() => { setItemDraft({ name: item.name, category: item.category, unitPrice: item.unitPrice, unit: item.unit, taxKind: item.taxKind ?? 'taxable' }); setEditingItem(item.id) }}>編集</button><button disabled={mutationPending} onClick={() => void deleteItem(item)}>削除</button></div>}</article>)}</div></section>

        </>}
        {activePage === 'settings' && <>
        <section className="panel settings-panel">
          <div className="panel-head"><div><p className="eyebrow">Settings</p><h2>設定</h2></div><p className="section-note">会社、組織、ユーザー、見積番号、税率を管理し、契約プランを確認します。</p></div>
          <div className="settings-page">
            <section className="workspace-panel">
              <label><span>会社 / 組織</span><select value={orgId} onChange={(event) => changeOrganization(event.target.value)}>{organizations.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.company} / {candidate.name}</option>)}</select></label>
              <label><span>ログインユーザー / ロール</span><input value={`${user.name} / ${org.role === 'admin' ? '管理者' : '担当者'}`} readOnly /></label>
              <div className="workspace-meta"><strong>{org.company}</strong><span>{org.name} のデータだけを表示中</span></div>
            </section>
            <div className="settings-card">
              <div className="settings-card-head"><p className="eyebrow">Quote rules</p><h3>見積・税率設定</h3></div>
              <div className="settings-strip">
                <label><span>見積番号</span><input disabled={!isAdmin} value={settings.prefix} onChange={(event) => setSettings((prev) => ({ ...prev, prefix: event.target.value || 'Q' }))} /></label>
                <label><span>次番号</span><input disabled={!isAdmin} type="number" value={settings.nextNo} onChange={(event) => setSettings((prev) => ({ ...prev, nextNo: Math.max(1, Number(event.target.value) || 1) }))} /></label>
                <label><span>税率（新規見積の初期値）</span><input disabled={!isAdmin} type="number" min="0" max="100" step="0.01" value={settings.taxRate} onChange={(event) => setSettings((prev) => ({ ...prev, taxRate: Math.max(0, Number(event.target.value) || 0) }))} /></label>
                <label><span>適格請求書発行事業者登録番号</span><input disabled={!isAdmin} value={settings.invoiceRegistrationNo} onChange={(event) => setSettings((prev) => ({ ...prev, invoiceRegistrationNo: event.target.value }))} /></label>
              </div>
              <div className="backup-actions"><button className="btn primary" type="button" disabled={!isAdmin || mutationPending} onClick={() => void persistSettings()}>{mutationPending ? '保存中' : '設定を保存'}</button></div>
            </div>
            <div className="settings-card backup-card">
              <div className="settings-card-head"><p className="eyebrow">Database backup</p><h3>組織データのバックアップ</h3></div>
              <p className="plan-admin-note">画面取得済みデータをJSONへ書き出します。履歴は最大200件で、全件バックアップではありません。発行原本の保護と全件復元の検証が完了するまで、JSON復元・旧ブラウザデータ移行は停止しています。</p>
              <div className="backup-summary" aria-label="バックアップ対象件数">
                <span>顧客 {customers.length}件</span>
                <span>品目 {items.length}件</span>
                <span>見積 {quotes.length}件</span>
                <span>請求書 {invoices.length}件</span>
                <span>履歴 {activities.length}件</span>
              </div>
              <div className="backup-actions">
                <button className="btn primary" type="button" onClick={exportBackup}>JSONを書き出す</button>
                {legacyBackupAvailable && <button className="btn ghost" type="button" disabled title="発行原本の保護と復元検証が完了するまで停止中" onClick={() => void migrateLegacyBrowserData()}>このブラウザの旧データをDBへ移行</button>}
                <label className="btn ghost backup-import-button disabled" title="発行原本を保護するため停止中">
                  JSON復元（停止中）
                  <input type="file" disabled accept="application/json,.json" onChange={importBackup} />
                </label>
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-card-head"><p className="eyebrow">Contract plans</p><h3>契約プラン</h3></div>
              <p className="plan-admin-note">{planAccess.isPlatformAdmin ? '運営管理者として、契約会社のプランを変更できます。' : '契約プランは運営管理者だけが変更できます。'}</p>
              {planLoading ? <p className="plan-empty">契約プランを確認しています…</p> : planAccess.companies.length === 0 ? <p className="plan-empty">所属会社の契約プランが見つかりません。運営管理者へお問い合わせください。</p> : (
                <div className="plan-list">
                  {planAccess.companies.map((company) => (
                    <article className="plan-row" key={company.id}>
                      <div><strong>{company.name}</strong><span>{company.plan === 'pro' ? '見積件数の制限なし' : '見積' + company.freeQuoteLimit + '件まで'}</span></div>
                      <label>
                        <span>契約プラン</span>
                        <select value={company.plan} disabled={!planAccess.isPlatformAdmin || planPendingCompanyId !== null} onChange={(event) => void handlePlanChange(company.id, event.target.value as Plan)}>
                          <option value="free">Free</option>
                          <option value="pro">Pro</option>
                        </select>
                      </label>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
        </>}
      </main>
        </div>
      </div>

      {noteQuote && <div className="modal-overlay" onMouseDown={() => setNoteQuoteId(null)}><div className="modal-window small-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Client memo</p><h2>顧客やり取りメモ</h2><span>{noteQuote.quoteNo} / {noteQuote.customerName}</span></div><button className="btn ghost" onClick={() => setNoteQuoteId(null)}>閉じる</button></div><div className="modal-body"><textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="やり取り内容を入力" /><button className="btn primary" disabled={mutationPending} onClick={() => void addNote()}>{mutationPending ? '保存中' : 'メモを追加'}</button><div className="note-list">{noteQuote.notes.map((note) => <article key={note.id}><time>{showDateTime(note.createdAt)} / {note.author}</time><p>{note.body}</p></article>)}</div></div></div></div>}
      {preview && <div className="modal-overlay" onMouseDown={() => setPreview(null)}><div className="modal-window" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Preview</p><h2>{preview.kind === 'invoice' ? '請求書プレビュー' : '見積書プレビュー'}</h2></div><div className="modal-actions"><button className="btn primary" disabled={preview.kind === 'invoice' ? !preview.invoice.snapshot : preview.quote.id !== 'draft' && preview.quote.taxRate == null} onClick={() => window.print()}>PDF化 / 印刷</button><button className="btn ghost" onClick={() => setPreview(null)}>閉じる</button></div></div><div className="paper-wrap"><PreviewPaper target={preview} taxRate={formTaxRate} invoiceRegistrationNo={savedRegistrationNo} issuerName={org.company} issuerOrganization={org.name} /></div></div></div>}
    </div>
  )
}

export default App
