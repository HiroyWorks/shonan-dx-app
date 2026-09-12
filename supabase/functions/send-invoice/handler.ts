import { createClient } from '@supabase/supabase-js'

type Config = { url: string; publishableKey: string; serviceKey: string; resendKey: string; from: string; origin: string }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const hash = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('')
const base64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s) }

export function createDeliveryHandler(config: Config, fetcher: typeof fetch = fetch) {
  return async (req: Request): Promise<Response> => {
    const headers = { 'Access-Control-Allow-Origin': config.origin, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' }
    const respond = (value: unknown, status = 200) => Response.json(value, { status, headers })
    if (req.headers.get('origin') && req.headers.get('origin') !== config.origin) return respond({ error: 'origin not allowed' }, 403)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (req.method !== 'POST') return respond({ error: 'POST required' }, 405)
    const authorization = req.headers.get('authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return respond({ error: 'authentication required' }, 401)
    if (!config.url || !config.publishableKey || !config.serviceKey || !config.resendKey || !config.from || !config.origin) return respond({ error: 'email service is not configured; no email was sent' }, 503)
    const userClient = createClient(config.url, config.publishableKey, { global: { headers: { Authorization: authorization }, fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } })
    const { data: auth, error: authError } = await userClient.auth.getUser(authorization.slice(7))
    if (authError || !auth.user) return respond({ error: 'invalid authentication' }, 401)
    let input: unknown
    try { const text = await req.text(); if (text.length > 1024) return respond({ error: 'request too large' }, 413); input = JSON.parse(text) } catch { return respond({ error: 'invalid JSON' }, 400) }
    if (!record(input) || typeof input.deliveryId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.deliveryId)) return respond({ error: 'deliveryId required' }, 400)
    const deliveryId = input.deliveryId
    const { data: visible, error: visibleError } = await userClient.from('invoice_deliveries').select('id,organization_id,status').eq('id', deliveryId).maybeSingle()
    if (visibleError || !visible) return respond({ error: 'delivery not found' }, 404)
    const { data: membership, error: membershipError } = await userClient.from('organization_memberships').select('id').eq('organization_id', visible.organization_id).eq('user_id', auth.user.id).eq('role', 'admin').maybeSingle()
    if (membershipError || !membership) return respond({ error: 'administrator permission required' }, 403)
    if (visible.status !== 'pending') return respond({ status: visible.status }, visible.status === 'accepted' ? 200 : 409)
    const service = createClient(config.url, config.serviceKey, { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } })
    const { data: claimed, error: claimError } = await service.rpc('claim_invoice_delivery', { p_id: deliveryId })
    if (claimError || !Array.isArray(claimed) || claimed.length !== 1) return respond({ error: 'delivery already claimed or unavailable' }, 409)
    const d: unknown = claimed[0]
    if (!record(d) || typeof d.document_id !== 'string' || typeof d.invoice_id !== 'string' || typeof d.recipient !== 'string' || typeof d.subject !== 'string' || typeof d.body !== 'string') return respond({ error: 'invalid stored delivery' }, 500)
    const finish = async (status: 'accepted' | 'failed' | 'unknown', providerId: string | null, message: string | null) => {
      const { error } = await service.from('invoice_deliveries').update({ status, provider_id: providerId, error_message: message, completed_at: new Date().toISOString() }).eq('id', deliveryId).eq('status', 'sending')
      if (error) throw new Error('delivery result could not be persisted')
    }
    let contactedProvider = false
    try {
      const { data: doc, error: docError } = await service.from('invoice_documents').select('storage_path,sha256,byte_size,invoice_id,organization_id').eq('id', d.document_id).single()
      if (docError || !doc || doc.invoice_id !== d.invoice_id || doc.organization_id !== visible.organization_id) throw new Error('archived document is not valid for this invoice')
      const { data: pdf, error: pdfError } = await service.storage.from('invoice-originals').download(doc.storage_path)
      if (pdfError || !pdf) throw new Error('archived PDF unavailable')
      const bytes = await pdf.arrayBuffer()
      if (bytes.byteLength > 10485760 || bytes.byteLength !== doc.byte_size || await hash(bytes) !== doc.sha256 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('archived PDF failed integrity verification')
      const { data: canceled, error: cancellationError } = await service.from('invoice_cancellations').select('invoice_id').eq('invoice_id', d.invoice_id).maybeSingle()
      if (cancellationError || canceled) throw new Error('invoice canceled or status unavailable')
      contactedProvider = true
      const result = await fetcher('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `invoice-delivery-${deliveryId}` },
        body: JSON.stringify({ from: config.from, to: [d.recipient], subject: d.subject, text: d.body, attachments: [{ filename: 'invoice.pdf', content: base64(new Uint8Array(bytes)), content_type: 'application/pdf' }] }),
      })
      if (!result.ok) {
        // 5xx/timeouts can be ambiguous. Never automatically retry such deliveries.
        const status = result.status >= 500 || result.status === 408 ? 'unknown' : 'failed'
        await finish(status, null, `Email service HTTP ${result.status}. Verify provider before resending.`)
        return respond({ status }, 502)
      }
      const outcome: unknown = await result.json()
      if (!record(outcome) || typeof outcome.id !== 'string') throw new Error('email provider response missing id')
      await finish('accepted', outcome.id, null)
      return respond({ status: 'accepted' })
    } catch {
      const status = contactedProvider ? 'unknown' : 'failed'
      try { await finish(status, null, contactedProvider ? 'Result uncertain. Check provider before resending.' : 'PDF or invoice verification failed. No email was sent.') } catch { /* Sending remains locked; manual reconciliation required. */ }
      return respond({ status, error: 'delivery did not complete; review delivery history' }, 502)
    }
  }
}
