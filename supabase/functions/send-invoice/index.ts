import { createDeliveryHandler } from './handler.ts'

Deno.serve(createDeliveryHandler({
  url: Deno.env.get('SUPABASE_URL') ?? '',
  publishableKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  resendKey: Deno.env.get('RESEND_API_KEY') ?? '',
  from: Deno.env.get('INVOICE_EMAIL_FROM') ?? '',
  origin: Deno.env.get('APP_ORIGIN') ?? '',
}))
