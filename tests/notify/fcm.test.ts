/**
 * Firebase Cloud Messaging (supabase/functions/_shared/fcm.ts + the push branch of deliver()):
 * a real RSA key signs the service-account JWT, fetch is mocked for Google's token endpoint and FCM.
 */
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { clearTokenCache, parseServiceAccount, signJwt, type ServiceAccount } from '../../supabase/functions/_shared/fcm'
import { deliver, type Ctx } from '../../supabase/functions/_shared/providers'

let sa: ServiceAccount
let pub: CryptoKey
beforeAll(async () => {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64')
  sa = { project_id: 'dch-test', client_email: 'push@dch-test.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n` }
  pub = kp.publicKey
})

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } }
let calls: Call[] = []
function mock(fcm: (token: string) => [number, unknown]) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: Call['init']) => {
    calls.push({ url, init })
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }))
    const [status, body] = fcm(JSON.parse(String(init.body)).message.token)
    return new Response(JSON.stringify(body), { status })
  }))
}
afterEach(() => { vi.unstubAllGlobals(); clearTokenCache() })

const forgotten: string[][] = []
const ctx = (tokens: string[]): Ctx => ({
  n: { push: { enabled: true } }, secrets: { fcm_service_account: JSON.stringify(sa) }, hospital: 'DC Hospital',
  devices: { tokens: async () => tokens, forget: async (t) => { forgotten.push(t) }, siteUrl: 'https://hospital.example.in' },
})
const msg = { event: 'notice_published', channel: 'push' as const, recipient: 'profile-1', subject: '📌 OPD timings', body: 'OPD opens at 9 AM', vars: { link: 'https://hospital.example.in/notices' } }

describe('FCM', () => {
  test('the service-account JWT is RS256-signed with the right claims', async () => {
    const jwt = await signJwt(sa, 1_700_000_000)
    const [h, c, s] = jwt.split('.')
    const dec = (x: string) => JSON.parse(Buffer.from(x, 'base64url').toString())
    expect(dec(h)).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(dec(c)).toEqual({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: 1_700_000_000, exp: 1_700_003_600 })
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pub, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${c}`))).toBe(true)
  })

  test('bad JSON is a clear configuration error', () => {
    expect(() => parseServiceAccount(undefined)).toThrow(/not configured/)
    expect(() => parseServiceAccount('{"project_id":"x"}')).toThrow(/needs project_id, client_email and private_key/)
  })

  test('sends to each device with the HTTP v1 payload, forgets unregistered tokens', async () => {
    mock((t) => t === 'gone' ? [404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }] : [200, { name: 'projects/dch-test/messages/0:123' }])
    const r = await deliver(msg, ctx(['good', 'gone']))
    expect(r).toEqual({ ok: true, ref: '0:123 · 1/2 devices' })
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token')
    expect(String(calls[0].init.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer')
    expect(calls[1].url).toBe('https://fcm.googleapis.com/v1/projects/dch-test/messages:send')
    expect(calls[1].init.headers.Authorization).toBe('Bearer ya29.test')
    expect(JSON.parse(String(calls[1].init.body)).message).toMatchObject({
      token: 'good', notification: { title: '📌 OPD timings', body: 'OPD opens at 9 AM' },
      data: { event: 'notice_published', link: 'https://hospital.example.in/notices' },
      webpush: { notification: { tag: 'notice_published' }, fcm_options: { link: 'https://hospital.example.in/notices' } },
    })
    expect(forgotten.at(-1)).toEqual(['gone'])
  })

  test('no devices / every device gone → permanent failure; token is cached between messages', async () => {
    mock(() => [404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }])
    expect(await deliver(msg, ctx([]))).toMatchObject({ ok: false, error: expect.stringMatching(/No devices/) })
    const r = await deliver(msg, ctx(['x']))
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/no longer registered/) })
    await deliver(msg, ctx(['y']))
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1)
  })

  test('Google rejecting the service account is reported', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }), { status: 400 })))
    expect(await deliver(msg, ctx(['a']))).toEqual({ ok: false, error: 'Google rejected the API key / service account: Invalid JWT Signature.' })
  })
})
