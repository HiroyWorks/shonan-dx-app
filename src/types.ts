export type QuoteStatus = 'Pending' | 'Won' | 'Invoiced'
export type Role = 'admin' | 'member'
export type Plan = 'free' | 'pro'
export type TaxKind = 'taxable' | 'exempt'
export type ActivityKind = 'quote-created' | 'quote-updated' | 'status-updated' | 'invoice-created' | 'memo-added'

export type Organization = {
  id: string
  companyId: string
  company: string
  name: string
  role: Role
  plan: Plan
  freeQuoteLimit: number
  invoiceRegistrationNo: string
}

export type AppUser = {
  id: string
  name: string
  email: string
}

export type Customer = {
  id: string
  orgId: string
  name: string
  address: string
  phone: string
  contact: string
  contactTitle: string
  email: string
  invoiceRegistrationNo: string
  memo: string
}

export type Item = {
  id: string
  orgId: string
  name: string
  category: string
  unitPrice: number
  unit: string
  taxKind: TaxKind
}

export type Line = {
  id: string
  itemId: string
  name: string
  unitPrice: number
  quantity: number
  unit: string
  taxKind: TaxKind
  isCustom?: boolean
}

export type Note = {
  id: string
  body: string
  author: string
  createdAt: string
}

export type Quote = {
  id: string
  orgId: string
  quoteNo: string
  customerId: string
  customerName: string
  project: string
  amount: number
  status: QuoteStatus
  createdAt: string
  updatedAt: string
  memo: string
  lines: Line[]
  notes: Note[]
  invoiceNo?: string
  // null/undefined means the historical tax rate was not recorded.
  taxRate?: number | null
  revision?: number
}

export type InvoiceSnapshot = {
  version: 1
  issuerName: string
  issuerOrganization: string
  registrationNo: string
  customerName: string
  customerAddress: string
  project: string
  memo: string
  quoteNo: string
  taxRate: number
  lines: Array<{ name: string; unit: string; unitPrice: number; quantity: number; taxKind: TaxKind; amount: number }>
  totals: { sub: number; taxable: number; tax: number; total: number }
}

export type Invoice = {
  id: string
  orgId: string
  invoiceNo: string
  quoteId: string
  customerName: string
  amount: number
  createdAt: string
  snapshot?: InvoiceSnapshot | null
  dueDate?: string | null
  bankDetails?: string
}

export type Activity = {
  id: string
  orgId: string
  kind: ActivityKind
  title: string
  description: string
  createdAt: string
}

export type Settings = {
  taxRate: number
  prefix: string
  year: number
  nextNo: number
  invoiceRegistrationNo: string
}

export type OrganizationData = {
  customers: Customer[]
  items: Item[]
  quotes: Quote[]
  invoices: Invoice[]
  activities: Activity[]
  settings: Settings
}
