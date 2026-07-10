import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = createClient(
  supabaseUrl || 'https://example.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
)

type AuthSettings = {
  external?: Record<string, boolean>
}

export const isGoogleProviderEnabled = async () => {
  if (!isSupabaseConfigured) return false

  const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: supabaseAnonKey },
  })

  if (!response.ok) throw new Error('ログイン設定を確認できませんでした。')

  const settings = await response.json() as AuthSettings
  return settings.external?.google === true
}

export const signInWithGoogle = async () => {
  if (!isSupabaseConfigured) throw new Error('Supabaseが設定されていません。')

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname,
    },
  })

  if (error) throw error
}

export const signOut = async () => {
  if (!isSupabaseConfigured) return
  await supabase.auth.signOut()
}

export type CompanyPlan = {
  id: string
  name: string
  plan: 'free' | 'pro'
  freeQuoteLimit: number
}

export type CompanyPlanAccess = {
  companies: CompanyPlan[]
  isPlatformAdmin: boolean
}

type CompanyPlanRow = {
  id: string
  name: string
  plan: 'free' | 'pro'
  free_quote_limit: number
}

export const loadCompanyPlanAccess = async (userId: string): Promise<CompanyPlanAccess> => {
  const { data: platformAdmin, error: platformAdminError } = await supabase
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (platformAdminError) throw platformAdminError

  const isPlatformAdmin = Boolean(platformAdmin)
  let companyIds: string[] | null = null

  if (!isPlatformAdmin) {
    const { data: memberships, error: membershipsError } = await supabase
      .from('organization_memberships')
      .select('organization_id')
      .eq('user_id', userId)

    if (membershipsError) throw membershipsError
    const organizationIds = [...new Set((memberships ?? []).map((membership) => membership.organization_id))]
    if (organizationIds.length === 0) return { companies: [], isPlatformAdmin }

    const { data: organizations, error: organizationsError } = await supabase
      .from('organizations')
      .select('company_id')
      .in('id', organizationIds)

    if (organizationsError) throw organizationsError
    companyIds = [...new Set((organizations ?? []).map((organization) => organization.company_id))]
    if (companyIds.length === 0) return { companies: [], isPlatformAdmin }
  }

  let query = supabase
    .from('companies')
    .select('id, name, plan, free_quote_limit')
    .order('name')

  if (companyIds) query = query.in('id', companyIds)

  const { data, error } = await query
  if (error) throw error

  return {
    isPlatformAdmin,
    companies: ((data ?? []) as CompanyPlanRow[]).map((company) => ({
      id: company.id,
      name: company.name,
      plan: company.plan,
      freeQuoteLimit: company.free_quote_limit,
    })),
  }
}

export const updateCompanyPlan = async (companyId: string, plan: 'free' | 'pro') => {
  const { data, error } = await supabase
    .from('companies')
    .update({ plan })
    .eq('id', companyId)
    .select('id, name, plan, free_quote_limit')
    .single()

  if (error) throw error

  const company = data as CompanyPlanRow
  return {
    id: company.id,
    name: company.name,
    plan: company.plan,
    freeQuoteLimit: company.free_quote_limit,
  } satisfies CompanyPlan
}
