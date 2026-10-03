// Razorpay (Hospital Comrade's own account — hospitals pay the platform). Phase 4.3.
// Orders API + Standard Checkout: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/
//   1. server: POST https://api.razorpay.com/v1/orders  (Basic key_id:key_secret)  { amount (paise), currency, receipt, notes }
//   2. browser: checkout.js with key_id + order_id → handler gets razorpay_payment_id, razorpay_order_id, razorpay_signature
//   3. server: signature = HMAC-SHA256(order_id + "|" + payment_id, key_secret)
//   4. webhook (backup when the browser closes early): X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret)
// Works in Deno (Edge Functions) and Node ≥ 18 (vitest): only fetch + Web Crypto.

export interface RazorpayConfig { keyId: string; keySecret: string; webhookSecret?: string }

/** from RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET — null = online payment not set up */
export function razorpayConfig(env: (k: string) => string | undefined): RazorpayConfig | null {
  const keyId = (env('RAZORPAY_KEY_ID') ?? '').trim(), keySecret = (env('RAZORPAY_KEY_SECRET') ?? '').trim()
  if (!keyId || !keySecret) return null
  return { keyId, keySecret, webhookSecret: (env('RAZORPAY_WEBHOOK_SECRET') ?? '').trim() || undefined }
}

export interface OrderInput { amount: number; receipt: string; notes?: Record<string, string> }
export interface Order { id: string; amount: number; currency: string; status: string }

export async function createOrder(cfg: RazorpayConfig, o: OrderInput, f: typeof fetch = fetch): Promise<Order> {
  if (!Number.isInteger(o.amount) || o.amount < 100) throw new Error('Amount must be at least ₹1')
  const r = await f('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${btoa(`${cfg.keyId}:${cfg.keySecret}`)}` },
    body: JSON.stringify({ amount: o.amount, currency: 'INR', receipt: o.receipt.slice(0, 40), notes: o.notes ?? {} }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || !data?.id) {
    const msg = data?.error?.description || `Razorpay error ${r.status}`
    throw new Error(r.status === 401 ? 'Razorpay rejected the API keys — check RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET' : msg)
  }
  return data as Order
}

const enc = new TextEncoder()
async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))].map((b) => b.toString(16).padStart(2, '0')).join('')
}
/** constant-time compare of two hex strings */
function sameHex(a: string, b: string) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

/** the checkout handler's razorpay_signature */
export const paymentSignature = (secret: string, orderId: string, paymentId: string) => hmacHex(secret, `${orderId}|${paymentId}`)
export async function verifyPayment(secret: string, orderId: string, paymentId: string, signature: string) {
  if (!orderId || !paymentId || !signature) return false
  return sameHex(await paymentSignature(secret, orderId, paymentId), String(signature).toLowerCase())
}

/** X-Razorpay-Signature over the exact raw request body */
export const webhookSignature = (secret: string, rawBody: string) => hmacHex(secret, rawBody)
export async function verifyWebhook(secret: string, rawBody: string, signature: string | null) {
  if (!secret || !signature) return false
  return sameHex(await webhookSignature(secret, rawBody), signature.toLowerCase())
}

/** the order / payment a webhook is about (payment.captured, payment.failed, order.paid) */
export function webhookPayment(event: any): { event: string; orderId: string | null; paymentId: string | null; method: string | null; captured: boolean; failed: boolean } {
  const p = event?.payload?.payment?.entity ?? {}
  const o = event?.payload?.order?.entity ?? {}
  const name = String(event?.event ?? '')
  return {
    event: name,
    orderId: p.order_id ?? o.id ?? null,
    paymentId: p.id ?? null,
    method: p.method ?? null,
    captured: name === 'payment.captured' || name === 'order.paid',
    failed: name === 'payment.failed',
  }
}
