import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import test from 'node:test'
import { loadTs } from './load-ts.mjs'

const { createDeliveryHandler } = loadTs('supabase/functions/send-invoice/handler.ts')
const config = { url: 'https://test.supabase.co', publishableKey: 'public-test', serviceKey: 'server-test', resendKey: 'provider-test', from: 'billing@example.invalid', origin: 'https://app.example.invalid' }
function fixture(options = {}) {
  const id = randomUUID(), invoice = randomUUID(), org = randomUUID(), document = randomUUID(), user = randomUUID()
  let status = 'pending', sends = 0, claims = 0, storedPayload
  const bytes = Buffer.from('%PDF-1.4\nTEST ONLY\n%%EOF'), hash = createHash('sha256').update(bytes).digest('hex')
  const json = (data, code = 200) => new Response(JSON.stringify(data), { status: code, headers: { 'Content-Type': 'application/json' } })
  const fetcher = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.pathname === '/auth/v1/user') return options.invalidAuth ? json({ message: 'invalid JWT' }, 401) : json({ id: user, email: 'admin@example.invalid' })
    if (url.pathname === '/rest/v1/invoice_deliveries') {
      if (init.method === 'PATCH') { const body = JSON.parse(init.body); status = body.status; return new Response(null, { status: 204 }) }
      return json(options.otherOrg ? null : { id, organization_id: org, status })
    }
    if (url.pathname === '/rest/v1/organization_memberships') return json(options.member ? null : { id: randomUUID() })
    if (url.pathname === '/rest/v1/rpc/claim_invoice_delivery') {
      claims++
      if (status !== 'pending') return json([])
      status = 'sending'
      return json([{ id, organization_id: org, invoice_id: invoice, document_id: document, recipient: 'client@example.invalid', subject: '請求書', body: '本文' }])
    }
    if (url.pathname === '/rest/v1/invoice_documents') return json({ storage_path: `${org}/${invoice}/${document}.pdf`, sha256: options.badHash ? '0'.repeat(64) : hash, byte_size: bytes.length, invoice_id: invoice, organization_id: org })
    if (url.pathname.startsWith('/storage/v1/object/')) return new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } })
    if (url.pathname === '/rest/v1/invoice_cancellations') return json(options.canceled ? { invoice_id: invoice } : null)
    if (url.origin === 'https://api.resend.com') {
      sends++; storedPayload = JSON.parse(init.body)
      assert.equal(new Headers(init.headers).get('Idempotency-Key'), `invoice-delivery-${id}`)
      if (options.networkFailure) throw new Error('simulated timeout')
      return json(options.httpError ? { message: 'provider unavailable' } : { id: 'provider-id' }, options.httpError ?? 200)
    }
    throw new Error(`Unexpected mocked endpoint: ${url.pathname}`)
  }
  const handler = createDeliveryHandler({ ...config, ...options.config }, fetcher)
  const request = (origin = config.origin) => new Request(`${config.url}/functions/v1/send-invoice`, { method: 'POST', headers: { Authorization: 'Bearer verified-test-token', Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ deliveryId: id }) })
  return { handler, request, get status() { return status }, get sends() { return sends }, get claims() { return claims }, get payload() { return storedPayload } }
}

test('email worker validates auth/role/origin before touching provider or queue', async () => {
  for (const [options, code] of [[{ invalidAuth: true }, 401], [{ member: true }, 403], [{ otherOrg: true }, 404], [{ config: { resendKey: '' } }, 503]]) {
    const f = fixture(options), response = await f.handler(f.request())
    assert.equal(response.status, code); assert.equal(f.sends, 0); assert.equal(f.claims, 0)
  }
  const f = fixture()
  assert.equal((await f.handler(f.request('https://evil.example.invalid'))).status, 403)
  assert.equal(f.sends, 0)
})
test('email uses archived PDF bytes and an idempotency key, retry does not resend', async () => {
  const f = fixture()
  assert.equal((await f.handler(f.request())).status, 200)
  assert.equal(f.status, 'accepted'); assert.equal(f.sends, 1)
  assert.deepEqual(f.payload.to, ['client@example.invalid'])
  assert.equal(Buffer.from(f.payload.attachments[0].content, 'base64').subarray(0, 5).toString(), '%PDF-')
  assert.equal((await f.handler(f.request())).status, 200); assert.equal(f.sends, 1)
})
test('hash mismatch/canceled invoice never reaches email provider', async () => {
  for (const options of [{ badHash: true }, { canceled: true }]) {
    const f = fixture(options)
    assert.equal((await f.handler(f.request())).status, 502); assert.equal(f.status, 'failed'); assert.equal(f.sends, 0)
  }
})
test('ambiguous provider failure stays locked and requires manual reconciliation', async () => {
  for (const options of [{ networkFailure: true }, { httpError: 503 }]) {
    const f = fixture(options)
    assert.equal((await f.handler(f.request())).status, 502); assert.equal(f.status, 'unknown')
    assert.equal((await f.handler(f.request())).status, 409); assert.equal(f.sends, 1)
  }
})
