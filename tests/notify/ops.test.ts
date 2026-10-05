/**
 * supabase/functions/_shared/ops.ts — shared-account keys from the control panel over Edge secrets, the send context
 * for team alerts / broadcasts, panel links, and the live health checks (mocked fetch, no network).
 */
import { describe, expect, test, vi } from 'vitest'
import { checkFunction, checkProviders, checkSite, mergeEnv, panelLink, platformSendCtx, runChecks, loadPlatformEnv, clearPlatformEnv } from '../../supabase/functions/_shared/ops'

const envOf = (vars: Record<string, string>) => (k: string) => vars[k]
const res = (status: number, body: unknown = '') => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

describe('keys', () => {
  test('a value saved in the control panel wins; empty falls back to the Edge secret', () => {
    const env = mergeEnv({ PLATFORM_SMS_PROVIDER: 'fast2sms', PLATFORM_EMAIL_FROM: '  ' }, envOf({ PLATFORM_SMS_PROVIDER: 'msg91', PLATFORM_EMAIL_FROM: 'a@b.in' }))
    expect(env('PLATFORM_SMS_PROVIDER')).toBe('fast2sms')
    expect(env('PLATFORM_EMAIL_FROM')).toBe('a@b.in')
    expect(env('NOPE')).toBeUndefined()
  })

  test('platform_env is read once a minute and an older database just means Edge secrets', async () => {
    clearPlatformEnv()
    const rpc = vi.fn(async () => ({ data: { PLATFORM_NAME: 'HC' }, error: null }))
    const e1 = await loadPlatformEnv({ rpc }, envOf({}))
    await loadPlatformEnv({ rpc }, envOf({}))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(e1('PLATFORM_NAME')).toBe('HC')
    clearPlatformEnv()
    const e2 = await loadPlatformEnv({ rpc: async () => { throw new Error('function platform_env() does not exist') } }, envOf({ PLATFORM_NAME: 'Edge' }))
    expect(e2('PLATFORM_NAME')).toBe('Edge')
    clearPlatformEnv()
  })
})

describe('send context', () => {
  test('every configured channel on, the platform name, Firebase for team push; missing channels are marked', () => {
    const c = platformSendCtx(envOf({
      PLATFORM_NAME: 'Hospital Comrade', PLATFORM_EMAIL_PROVIDER: 'resend', PLATFORM_EMAIL_FROM: 'alerts@hc.in', PLATFORM_RESEND_API_KEY: 're_x',
      PLATFORM_FCM_SERVICE_ACCOUNT: '{"project_id":"p"}',
    }), { templates: { platform_alert: { waTemplate: 'alert_v1' } }, siteUrl: 'https://hc.in/', devices: { tokens: async () => [], forget: async () => {} } })
    expect(c.hospital).toBe('Hospital Comrade')
    expect(c.n.email).toMatchObject({ enabled: true, provider: 'resend', fromEmail: 'alerts@hc.in', fromName: 'Hospital Comrade' })
    expect(c.n.sms.provider).toBe('platform-sms-missing')
    expect(c.n.push).toEqual({ enabled: true })
    expect(c.secrets).toEqual({ resend_api_key: 're_x', fcm_service_account: '{"project_id":"p"}' })
    expect(c.n.templates.platform_alert.waTemplate).toBe('alert_v1')
    expect(c.devices?.siteUrl).toBe('https://hc.in/control-panel/')
  })

  test('panel links become absolute only with an https platform address', () => {
    expect(panelLink('https://hc.in/', '/health')).toBe('https://hc.in/control-panel/health')
    expect(panelLink('', '/health')).toBe('')
    expect(panelLink('', 'https://x.in/a')).toBe('https://x.in/a')
  })
})

describe('health checks', () => {
  const base = { supabaseUrl: 'https://p.supabase.co', serviceKey: 'svc', env: envOf({}) }

  test('site: off without an address, ok on 200, fail on errors', async () => {
    expect((await checkSite(base)).status).toBe('off')
    expect(await checkSite({ ...base, siteUrl: 'https://hc.in', fetch: async () => res(200, 'ok') })).toMatchObject({ status: 'ok', detail: 'HTTP 200 · ok' })
    expect(await checkSite({ ...base, siteUrl: 'https://hc.in', fetch: async () => res(502) })).toMatchObject({ status: 'fail', detail: 'HTTP 502' })
    expect(await checkSite({ ...base, siteUrl: 'https://hc.in', fetch: async () => { throw new Error('dns') } })).toMatchObject({ status: 'fail', detail: 'dns' })
  })

  test('functions: deployed = any answer but "not found" / 5xx', async () => {
    const calls: string[] = []
    const f = async (url: string) => { calls.push(url); return url.endsWith('/billing') ? res(404, '{"code":"NOT_FOUND","message":"Requested function was not found"}') : res(400, '{"error":"Unknown request"}') }
    expect(await checkFunction({ ...base, fetch: f as any }, 'notify')).toMatchObject({ status: 'ok', service: 'fn:notify' })
    expect(await checkFunction({ ...base, fetch: f as any }, 'billing')).toMatchObject({ status: 'fail', detail: 'Not deployed — supabase functions deploy billing' })
    expect(calls).toEqual(['https://p.supabase.co/functions/v1/notify', 'https://p.supabase.co/functions/v1/billing'])
  })

  test('providers: key accepted / rejected / not configured; never sends a message', async () => {
    const seen: string[] = []
    const f = async (url: string) => { seen.push(url); return url.includes('resend') ? res(401, '{"name":"restricted_api_key"}') : res(401, '{}') }
    const out = await checkProviders({ ...base, fetch: f as any, env: envOf({
      PLATFORM_EMAIL_PROVIDER: 'resend', PLATFORM_EMAIL_FROM: 'a@hc.in', PLATFORM_RESEND_API_KEY: 're_x',
      PLATFORM_WHATSAPP_PROVIDER: 'meta', PLATFORM_META_PHONE_NUMBER_ID: '123', PLATFORM_META_ACCESS_TOKEN: 'bad',
      PLATFORM_SMS_PROVIDER: 'msg91', PLATFORM_MSG91_AUTH_KEY: 'k',
    }) })
    const by = Object.fromEntries(out.map((c) => [c.service, c]))
    expect(by['provider:email']).toMatchObject({ status: 'ok', detail: 'resend · key accepted' })   // sending-only key
    expect(by['provider:whatsapp']).toMatchObject({ status: 'fail', detail: 'meta rejected the key (HTTP 401)' })
    expect(by['provider:sms']).toMatchObject({ status: 'ok', detail: 'msg91 · configured (key not checked)' })
    expect(by['provider:push']).toMatchObject({ status: 'off' })
    expect(seen.every((u) => !/\/emails|messages|send-text|\/flow/.test(u))).toBe(true)
  })

  test('runChecks covers the platform, Supabase, every function and the providers', async () => {
    const out = await runChecks({ ...base, siteUrl: 'https://hc.in', self: 'ops', fetch: (async () => res(200, '[]')) as any })
    expect(out.map((c) => c.service)).toEqual(expect.arrayContaining(['site', 'auth', 'storage', 'fn:notify', 'fn:billing', 'fn:domains', 'fn:impersonate', 'fn:whatsapp-bot', 'fn:ops', 'provider:email', 'provider:push']))
    expect(out.find((c) => c.service === 'fn:ops')?.status).toBe('ok')
  })
})
