import assert from 'node:assert/strict'
import test from 'node:test'
import { checkPublicApp, checkSupabaseServices } from '../scripts/health-check.mjs'

test('public availability check detects missing assets and never accepts cross-origin scripts', async () => {
  const html = (src = '/assets/app.js') => new Response(`<title>Estimate Management</title><script src="${src}"></script>`)
  const healthy = async (url) => url.pathname === '/' ? html() : new Response('/* code */', { headers: { 'content-type': 'text/javascript' } })
  assert.deepEqual(await checkPublicApp('https://app.example.invalid/', healthy), { reachable: true, scripts: 1 })
  await assert.rejects(checkPublicApp('http://example.invalid', healthy), /HTTPS/)
  await assert.rejects(checkPublicApp('https://app.example.invalid/', async (u) => u.pathname === '/' ? html() : new Response('', { status: 404 })), /JavaScript/)
  await assert.rejects(checkPublicApp('https://app.example.invalid/', async () => html('https://elsewhere.invalid/script.js')), /外部/)
})

const projectUrl = 'https://testproject.supabase.co/'
const anonKey = `header.${Buffer.from(JSON.stringify({ role: 'anon', ref: 'testproject' })).toString('base64url')}.signature`
const authSettings = () => Response.json({ external: { google: true } })
const databaseDenial = () => Response.json({ code: '42501', message: 'permission denied for table quotes' }, { status: 401 })

test('Supabase monitoring confirms auth and a protected database without reading rows or signing in', async () => {
  const calls = []
  const result = await checkSupabaseServices(projectUrl, anonKey, async (url, options) => {
    calls.push({ url, options })
    return url.pathname === '/auth/v1/settings' ? authSettings() : databaseDenial()
  })
  assert.deepEqual(result, { auth: true, google: true, database: true, anonymousAccessDenied: true })
  assert.deepEqual(calls.map(({ url }) => url.pathname), ['/auth/v1/settings', '/rest/v1/quotes'])
  assert.equal(calls[1].url.search, '?select=id&limit=0')
  for (const { options } of calls) {
    assert.equal(options.method, undefined)
    assert.equal(options.headers.apikey, anonKey)
    assert.equal(options.redirect, 'error')
    assert.equal(options.signal instanceof AbortSignal, true)
  }
})

test('Supabase monitoring detects pausing, database failures and invalid authentication responses', async () => {
  await assert.rejects(checkSupabaseServices(projectUrl, anonKey, async () => new Response('', { status: 521 })), /認証.*521/)
  for (const badDatabase of [
    new Response('', { status: 503 }),
    Response.json({ code: 'PGRST301', message: 'invalid JWT' }, { status: 401 }),
    Response.json({ code: '42501', message: 'permission denied for schema public' }, { status: 403 }),
    Response.json([]),
  ]) {
    await assert.rejects(checkSupabaseServices(projectUrl, anonKey, async (url) => url.pathname === '/auth/v1/settings' ? authSettings() : badDatabase), /業務DB/)
  }
  for (const badAuth of [Response.json({ external: { google: false } }), new Response('<html>proxy</html>')]) {
    await assert.rejects(checkSupabaseServices(projectUrl, anonKey, async () => badAuth), /Googleログイン/)
  }
})

test('Supabase monitoring rejects unsafe keys and URLs before making requests', async () => {
  let requests = 0
  const fetcher = async () => { requests++; return authSettings() }
  const serviceKey = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`
  for (const key of [serviceKey, 'sb_secret_private', 'invalid', '']) {
    await assert.rejects(checkSupabaseServices(projectUrl, key, fetcher), /キー/)
  }
  for (const url of ['https://attacker.invalid', 'http://testproject.supabase.co', 'https://user:pass@testproject.supabase.co', `${projectUrl}?token=private`]) {
    await assert.rejects(checkSupabaseServices(url, anonKey, fetcher), /HTTPS URL/)
  }
  await assert.rejects(checkSupabaseServices('https://anotherproject.supabase.co', anonKey, fetcher), /対象プロジェクト/)
  assert.equal(requests, 0)
})

test('Supabase monitoring supports publishable keys and sanitizes network failures', async () => {
  const key = 'sb_publishable_test'
  assert.equal((await checkSupabaseServices(projectUrl, key, async (url) => url.pathname === '/auth/v1/settings' ? authSettings() : databaseDenial())).database, true)
  await assert.rejects(checkSupabaseServices(projectUrl, key, async () => { throw new Error(`fetch failed with ${key}`) }), (error) => /認証サービスへ接続/.test(error.message) && !error.message.includes(key))
})
