// Supabase Edge Function: hospitals pay Hospital Comrade — plan renewals and wallet top-ups through Razorpay. Phase 4.3.
//
//   supabase functions deploy billing --no-verify-jwt        (the Razorpay webhook has no Supabase token)
//   supabase secrets set RAZORPAY_KEY_ID=rzp_live_… RAZORPAY_KEY_SECRET=… RAZORPAY_WEBHOOK_SECRET=… PLATFORM_NAME="Hospital Comrade"
//   Razorpay Dashboard → Webhooks → URL https://<project>.supabase.co/functions/v1/billing?webhook=razorpay
//     secret = RAZORPAY_WEBHOOK_SECRET, events: payment.captured, payment.failed, order.paid
//
// Called by the app (Settings → Plan & billing) with the signed-in user's token and the usual x-tenant-id /
// x-provider-mode headers. The hospital's owner pays; Hospital Comrade admins / finance may too (for the hospital
// chosen in their banner). Prices always come from the database (billing_quote) — never from the browser.
//
//   POST { action: 'config' }                                    → { enabled, key_id }
//   POST { action: 'order', kind: 'plan', months: 1 | 12 }       → Razorpay order for checkout.js
//   POST { action: 'order', kind: 'wallet', amount: ₹ }
//   POST { action: 'verify', order_id, payment_id, signature }   → applies the payment, { ok, invoice_no }
//   POST ?webhook=razorpay  (X-Razorpay-Signature)               → same, if the browser never came back
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, resolveCaller } from '../_shared/tenant.ts'
import { createOrder, razorpayConfig, verifyPayment, verifyWebhook, webhookPayment } from '../_shared/razorpay.ts'

const cors = corsHeaders('POST, OPTIONS')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const env = (k: string) => (Deno.env.get(k) ?? '').trim()
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const SUPABASE_URL = env('SUPABASE_URL')
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const userClient = (jwt: string, headers: Record<string, string>) => createClient(SUPABASE_URL, env('SUPABASE_ANON_KEY'), {
  auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}`, ...headers } },
})
const NOT_SET_UP = 'Online payment is not set up yet — please contact Hospital Comrade to renew.'

/** marks the payment paid (idempotent in the database) */
async function apply(paymentRow: string, ref: string | null, method: string | null) {
  const { data, error } = await admin.rpc('apply_payment', { p_payment: paymentRow, p_ref: ref, p_method: method })
  if (error) throw new Error(error.message)
  return data as { ok: boolean; already: boolean; invoice_no: string }
}

async function webhook(req: Request, raw: string) {
  const cfg = razorpayConfig((k) => Deno.env.get(k))
  if (!cfg?.webhookSecret) return json({ error: 'webhook secret not set' }, 503)
  if (!(await verifyWebhook(cfg.webhookSecret, raw, req.headers.get('x-razorpay-signature')))) return json({ error: 'bad signature' }, 401)
  let event: any
  try { event = JSON.parse(raw) } catch { return json({ error: 'Invalid JSON' }, 400) }
  const w = webhookPayment(event)
  if (!w.orderId) return json({ ok: true, ignored: w.event })
  const { data: row } = await admin.from('billing_payments').select('id, status').eq('order_id', w.orderId).maybeSingle()
  if (!row) return json({ ok: true, ignored: 'unknown order' })    // not ours (another app on the same account) — don't make Razorpay retry
  if (w.captured) return json(await apply(row.id, w.paymentId, w.method))
  if (w.failed && row.status === 'created') await admin.from('billing_payments').update({ status: 'failed', payment_id: w.paymentId }).eq('id', row.id).eq('status', 'created')
  return json({ ok: true })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const raw = await req.text()
  const url = new URL(req.url)
  if (url.searchParams.has('webhook') || req.headers.has('x-razorpay-signature')) {
    try { return await webhook(req, raw) } catch (e: any) { return json({ error: e?.message ?? String(e) }, 500) }
  }
  let body: any
  try { body = JSON.parse(raw || '{}') } catch { return json({ error: 'Invalid JSON' }, 400) }

  const caller = await resolveCaller(req, { serviceKey: SERVICE_KEY, admin, userClient })
  if (caller.kind !== 'user' || !caller.tenant) return json({ error: 'Sign in first.' }, 403)
  const tenant = caller.tenant
  const isOwner = !caller.provider && caller.role === 'owner'
  const isPlatform = caller.provider === 'admin' || caller.provider === 'finance'
  if (!isOwner && !isPlatform) return json({ error: 'Only the hospital owner can pay for Hospital Comrade.' }, 403)

  const cfg = razorpayConfig((k) => Deno.env.get(k))
  const action = String(body?.action ?? 'config')
  try {
    if (action === 'config') return json({ enabled: !!cfg, key_id: cfg?.keyId ?? null })
    if (!cfg) return json({ error: NOT_SET_UP }, 503)

    if (action === 'order') {
      const kind = body?.kind === 'wallet' ? 'wallet' : 'plan'
      const { data: q, error } = await admin.rpc('billing_quote', { p_tenant: tenant, p_kind: kind, p_months: Number(body?.months) || 1, p_amount: kind === 'wallet' ? Number(body?.amount) : null, p_plan: kind === 'plan' && typeof body?.plan === 'string' ? body.plan : null })
      if (error || !q) return json({ error: error?.message ?? 'Could not price this' }, 400)
      const id = crypto.randomUUID()
      const { error: insErr } = await admin.from('billing_payments').insert({
        id, tenant_id: tenant, kind, plan: q.plan ?? null, months: q.months ?? null, base_paise: q.base_paise, gst_paise: q.gst_paise, total_paise: q.total_paise,
        period_from: q.period_from ?? null, period_to: q.period_to ?? null, provider: 'razorpay', created_by: caller.id,
      })
      if (insErr) throw new Error(insErr.message)
      const order = await createOrder(cfg, { amount: Number(q.total_paise), receipt: id, notes: { payment: id, tenant, kind, months: String(q.months ?? '') } })
      await admin.from('billing_payments').update({ order_id: order.id }).eq('id', id).eq('tenant_id', tenant)
      const name = env('PLATFORM_NAME') || 'Hospital Comrade'
      return json({
        key_id: cfg.keyId, order_id: order.id, amount: order.amount, currency: order.currency, payment: id, name,
        description: kind === 'plan' ? `${String(q.plan ?? '').replace(/^./, (c: string) => c.toUpperCase())} plan · ${q.months === 12 ? '12 months' : '1 month'}` : 'Messaging wallet top-up',
        quote: q,
      })
    }

    if (action === 'verify') {
      const orderId = String(body?.order_id ?? ''), paymentId = String(body?.payment_id ?? '')
      if (!(await verifyPayment(cfg.keySecret, orderId, paymentId, String(body?.signature ?? '')))) return json({ error: 'The payment could not be verified. If money was taken, it will be applied automatically within a few minutes.' }, 400)
      const { data: row } = await admin.from('billing_payments').select('id').eq('order_id', orderId).eq('tenant_id', tenant).maybeSingle()
      if (!row) return json({ error: 'Payment not found for this hospital' }, 404)
      return json(await apply(row.id, paymentId, 'razorpay'))
    }
    return json({ error: `Unknown action ${action}` }, 400)
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 502)
  }
})
