import { createHmac } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import { checkRazorpayKeys, createOrder, paymentSignature, razorpayConfig, razorpayFromPlatform, razorpayMode, verifyPayment, verifyWebhook, webhookPayment } from '../../supabase/functions/_shared/razorpay'

describe('Razorpay helpers (phase 4.3)', () => {
  test('signatures match an independent HMAC-SHA256; anything else is refused', async () => {
    const want = createHmac('sha256', 'secret').update('order_1|pay_1').digest('hex')
    expect(await paymentSignature('secret', 'order_1', 'pay_1')).toBe(want)
    expect(await verifyPayment('secret', 'order_1', 'pay_1', want)).toBe(true)
    expect(await verifyPayment('secret', 'order_1', 'pay_2', want)).toBe(false)
    expect(await verifyPayment('secret', 'order_1', 'pay_1', '')).toBe(false)
    const raw = '{"event":"payment.captured"}'
    expect(await verifyWebhook('wh', raw, createHmac('sha256', 'wh').update(raw).digest('hex'))).toBe(true)
    expect(await verifyWebhook('wh', raw + ' ', createHmac('sha256', 'wh').update(raw).digest('hex'))).toBe(false)
    expect(await verifyWebhook('', raw, 'x')).toBe(false)
  })
  test('config needs both keys; order request is Basic-auth JSON in paise', async () => {
    expect(razorpayConfig(() => undefined)).toBeNull()
    const cfg = razorpayConfig((k) => ({ RAZORPAY_KEY_ID: 'rzp_k', RAZORPAY_KEY_SECRET: 's' } as Record<string, string>)[k])!
    const f = vi.fn(async (_u: any, _i: any) => new Response('{"id":"order_X","amount":118000,"currency":"INR","status":"created"}'))
    expect((await createOrder(cfg, { amount: 118000, receipt: 'r'.repeat(50) }, f as never)).id).toBe('order_X')
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.razorpay.com/v1/orders')
    expect(init.headers.Authorization).toBe(`Basic ${btoa('rzp_k:s')}`)
    expect(JSON.parse(init.body)).toEqual({ amount: 118000, currency: 'INR', receipt: 'r'.repeat(40), notes: {} })
    const bad = vi.fn(async () => new Response('{"error":{"description":"Authentication failed"}}', { status: 401 }))
    await expect(createOrder(cfg, { amount: 1000, receipt: 'x' }, bad as never)).rejects.toThrow(/rejected the API keys/)
    await expect(createOrder(cfg, { amount: 50, receipt: 'x' }, f as never)).rejects.toThrow(/at least/)
  })
  test('webhook events → order / payment', () => {
    expect(webhookPayment({ event: 'payment.failed', payload: { payment: { entity: { id: 'p', order_id: 'o', method: 'upi' } } } }))
      .toEqual({ event: 'payment.failed', orderId: 'o', paymentId: 'p', method: 'upi', captured: false, failed: true })
    expect(webhookPayment({ event: 'order.paid', payload: { order: { entity: { id: 'o2' } } } }).orderId).toBe('o2')
  })

  test('keys from the control panel win as a pair; the webhook secret falls back on its own', () => {
    const env = (v: Record<string, string>) => (k: string) => v[k]
    expect(razorpayFromPlatform(env({}))).toBeNull()
    expect(razorpayFromPlatform(env({ RAZORPAY_KEY_ID: 'rzp_live_e', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w' })))
      .toEqual({ keyId: 'rzp_live_e', keySecret: 's', webhookSecret: 'w', source: 'edge' })
    expect(razorpayFromPlatform(env({ PLATFORM_RAZORPAY_KEY_ID: 'rzp_test_p', PLATFORM_RAZORPAY_KEY_SECRET: 'ps', RAZORPAY_KEY_ID: 'rzp_live_e', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w' })))
      .toEqual({ keyId: 'rzp_test_p', keySecret: 'ps', webhookSecret: 'w', source: 'panel' })
    // only the key ID saved in the panel → still the Edge pair (never a mixed pair)
    expect(razorpayFromPlatform(env({ PLATFORM_RAZORPAY_KEY_ID: 'rzp_test_p', RAZORPAY_KEY_ID: 'rzp_live_e', RAZORPAY_KEY_SECRET: 's' }))?.keyId).toBe('rzp_live_e')
    expect([razorpayMode('rzp_live_x'), razorpayMode('rzp_test_x'), razorpayMode('x')]).toEqual(['live', 'test', 'unknown'])
  })

  test('key check lists one order and explains a rejection', async () => {
    const f = vi.fn(async () => new Response('{"items":[]}', { status: 200 }))
    expect(await checkRazorpayKeys({ keyId: 'k', keySecret: 's' }, f as any)).toMatchObject({ ok: true })
    expect(f.mock.calls[0]).toEqual(['https://api.razorpay.com/v1/orders?count=1', { headers: { Authorization: `Basic ${btoa('k:s')}` } }])
    const bad = await checkRazorpayKeys({ keyId: 'k', keySecret: 's' }, (async () => new Response('{"error":{"description":"Authentication failed"}}', { status: 401 })) as any)
    expect(bad).toEqual({ ok: false, status: 401, message: 'Razorpay rejected the key ID / secret' })
  })
})
