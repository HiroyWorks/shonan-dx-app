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
