import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'

// Public, read-only availability check. Never signs in, reads business rows or sends email.
export async function checkPublicApp(appUrl, fetcher = fetch) {
  const base = new URL(appUrl)
  if (base.protocol !== 'https:' || base.username || base.password) throw new Error('APP_HEALTH_URLには認証情報を含まないHTTPS URLを指定してください。')
  const request = (url) => fetcher(url, { signal: AbortSignal.timeout(20000), redirect: 'error', cache: 'no-store' })
  const response = await request(base)
  if (!response.ok) throw new Error(`公開画面の取得に失敗しました（HTTP ${response.status}）。`)
  const html = await response.text()
  if (!html.includes('Estimate Management')) throw new Error('想定したアプリのHTMLではありません。')
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => new URL(m[1], base))
  if (!scripts.length) throw new Error('アプリの配信JavaScriptが見つかりません。')
  for (const url of scripts) {
    if (url.origin !== base.origin) throw new Error('想定外の外部JavaScriptを検出しました。')
    const asset = await request(url)
    if (!asset.ok || !(asset.headers.get('content-type') ?? '').match(/javascript|ecmascript/)) throw new Error('JavaScript資産が欠落または不正な形式です。')
  }
  return { reachable: true, scripts: scripts.length }
}

// Exercise the same Auth settings endpoint as the app, then check a real
// database response without signing in or reading any business rows.
export async function checkSupabaseServices(supabaseUrl, publishableKey, fetcher = fetch) {
  let base
  try { base = new URL(supabaseUrl) } catch { throw new Error('Supabase監視の接続先が設定されていません。') }
  if (base.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(base.hostname) || base.port || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Supabase監視にはプロジェクトのHTTPS URLを指定してください。')
  }
  if (typeof publishableKey !== 'string' || !publishableKey) throw new Error('Supabase監視の公開APIキーが設定されていません。')
  if (!publishableKey.startsWith('sb_publishable_')) {
    let claims
    try { claims = JSON.parse(Buffer.from(publishableKey.split('.')[1], 'base64url').toString('utf8')) } catch { /* rejected below */ }
    if (claims?.role !== 'anon' || (claims.ref && claims.ref !== base.hostname.split('.')[0])) {
      throw new Error('Supabase監視には対象プロジェクトのpublishable／anonキーだけを使用してください。')
    }
  }
  const request = async (path, label) => {
    try {
      return await fetcher(new URL(path, base), {
        headers: { apikey: publishableKey },
        signal: AbortSignal.timeout(20000), redirect: 'error', cache: 'no-store',
      })
    } catch { throw new Error(`${label}へ接続できませんでした。停止・通信障害・タイムアウトを確認してください。`) }
  }
  const auth = await request('/auth/v1/settings', '認証サービス')
  if (!auth.ok) throw new Error(`認証サービスの確認に失敗しました（HTTP ${auth.status}）。`)
  const settings = await auth.json().catch(() => null)
  if (settings?.external?.google !== true) throw new Error('Googleログインが無効、または認証設定の応答が不正です。')

  // SQLSTATE 42501 proves that PostgREST reached Postgres and that the quotes
  // table still denies anonymous reads. A generic 401/403 is not enough.
  const database = await request('/rest/v1/quotes?select=id&limit=0', '業務DB')
  const denial = await database.json().catch(() => null)
  if (![401, 403].includes(database.status) || denial?.code !== '42501' || !/permission denied for table quotes/i.test(denial.message ?? '')) {
    throw new Error(`業務DBの接続または匿名アクセス保護を確認できませんでした（HTTP ${database.status}）。`)
  }
  return { auth: true, google: true, database: true, anonymousAccessDenied: true }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (existsSync('.env.production')) process.loadEnvFile('.env.production')
  const checks = await Promise.allSettled([
    checkPublicApp(process.env.APP_HEALTH_URL || 'https://app.shonan-dx.com/'),
    checkSupabaseServices(process.env.SUPABASE_HEALTH_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_HEALTH_KEY || process.env.VITE_SUPABASE_ANON_KEY),
  ])
  for (let i = 0; i < checks.length; i++) {
    const result = checks[i]
    if (result.status === 'rejected') {
      console.error(result.reason instanceof Error ? result.reason.message : '本番稼働確認に失敗しました。')
      process.exitCode = 1
    } else {
      console.log(i === 0 ? `公開画面・JavaScript資産の確認に成功しました（${result.value.scripts}件）。` : '認証・Googleログイン設定・業務DB応答・匿名アクセス拒否の確認に成功しました。')
    }
  }
  console.log('認証後の業務操作・メール到達は別途確認が必要です。この監視はFreeプランの自動停止防止を保証しません。')
}
