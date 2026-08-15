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
}

export type Invoice = {
  id: string
  orgId: string
  invoiceNo: string
  quoteId: string
  customerName: string
  amount: number
  createdAt: string
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
