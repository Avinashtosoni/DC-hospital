/**
 * supabase/functions/_shared/ops.ts — shared-account keys from the control panel over Edge secrets, the send context
 * for team alerts / broadcasts, panel links, and the live health checks (mocked fetch, no network).
 */
import { describe, expect, test, vi } from 'vitest'
import { cfExpiry, checkDomains, checkFunction, checkProviders, checkSite, msg91Balance, mergeEnv, panelLink, platformSendCtx, runChecks, loadPlatformEnv, clearPlatformEnv } from '../../supabase/functions/_shared/ops'

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
    expect(by['provider:sms']).toMatchObject({ status: 'fail', detail: expect.stringContaining('msg91 rejected the auth key') })
    expect(by['provider:push']).toMatchObject({ status: 'off' })
    expect(seen.every((u) => !/\/emails|messages|send-text|\/flow/.test(u))).toBe(true)
  })

  test('MSG91 and Fast2SMS keys are checked against their balance APIs', async () => {
    const sms = (provider: string, f: any) => checkProviders({ ...base, fetch: f, env: envOf({ PLATFORM_SMS_PROVIDER: provider, PLATFORM_MSG91_AUTH_KEY: 'k91', PLATFORM_FAST2SMS_API_KEY: 'kf2' }) })
      .then((out) => out.find((c) => c.service === 'provider:sms')!)
    expect(await sms('msg91', async (u: string) => { expect(u).toContain('control.msg91.com/api/balance.php?authkey=k91&type=4'); return res(200, '{"SMS":"120.50"}') }))
      .toMatchObject({ status: 'ok', detail: 'msg91 · key accepted · balance 120.50' })
    expect((await sms('msg91', async () => res(200, 'Invalid authkey'))).status).toBe('fail')
    expect((await sms('msg91', async () => { throw new Error('dns') })).status).toBe('warn')
    expect(await sms('fast2sms', async (_u: string, init: any) => { expect(init.headers.authorization).toBe('kf2'); return res(200, { return: true, wallet: '493.20' }) }))
      .toMatchObject({ status: 'ok', detail: 'fast2sms · key accepted · wallet ₹493.20' })
    expect((await sms('fast2sms', async () => res(200, { return: true, wallet: '12.00' }))).status).toBe('warn')
    expect(await sms('fast2sms', async () => res(401, { return: false, status_code: 412, message: 'Invalid Authentication, Check Authorization Key' })))
      .toMatchObject({ status: 'fail', detail: 'fast2sms rejected the key: Invalid Authentication, Check Authorization Key' })
    expect((await sms('fast2sms', async () => res(400, { return: false, status_code: 414 }))).status).toBe('warn')
    expect(msg91Balance('77')).toBe(' · balance 77')
    expect(msg91Balance('<html>')).toBe('')
  })

  test('hospital domains: HTTPS works, Cloudflare certificate status and expiry', async () => {
    expect((await checkDomains(base, [])).status).toBe('off')
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString()
    const later = new Date(Date.now() + 60 * 86_400_000).toISOString()
    expect(cfExpiry({ ssl: { certificates: [{ expires_on: later }, { expires_on: soon }] } })).toBe(new Date(Date.parse(soon)).toISOString())
    const f = async (u: string) => {
      if (u.startsWith('https://broken.in')) throw new Error('invalid peer certificate: Expired')
      if (u.includes('custom_hostnames/cf1')) return res(200, { result: { ssl: { status: 'active', certificates: [{ expires_on: later }] } } })
      if (u.includes('custom_hostnames/cf2')) return res(200, { result: { ssl: { status: 'active', certificates: [{ expires_on: soon }] } } })
      return res(200, 'ok')
    }
    const ok = await checkDomains({ ...base, fetch: f as any }, [{ domain: 'city.in', method: 'cloudflare', cf_hostname_id: 'cf1' }, { domain: 'own.in', method: 'manual', cf_hostname_id: null }], { cf: { token: 't', zone: 'z' } })
    expect(ok).toMatchObject({ service: 'ssl:domains', status: 'ok', detail: `2 domains · HTTPS ok · next certificate expiry ${later.slice(0, 10)}` })
    const warn = await checkDomains({ ...base, fetch: f as any }, [{ domain: 'soon.in', method: 'cloudflare', cf_hostname_id: 'cf2' }], { cf: { token: 't', zone: 'z' } })
    expect(warn).toMatchObject({ status: 'warn', detail: `soon.in: certificate expires ${soon.slice(0, 10)}` })
    const bad = await checkDomains({ ...base, fetch: f as any }, [{ domain: 'broken.in', method: 'manual', cf_hostname_id: null }, { domain: 'own.in', method: 'manual', cf_hostname_id: null }])
    expect(bad).toMatchObject({ status: 'fail', detail: expect.stringContaining('broken.in: HTTPS failed (invalid peer certificate') })
  })

  test('runChecks covers the platform, Supabase, every function and the providers', async () => {
    const out = await runChecks({ ...base, siteUrl: 'https://hc.in', self: 'ops', fetch: (async () => res(200, '[]')) as any, domains: [] })
    expect(out.map((c) => c.service)).toEqual(expect.arrayContaining(['site', 'auth', 'storage', 'fn:notify', 'fn:billing', 'fn:domains', 'fn:impersonate', 'fn:whatsapp-bot', 'fn:ops', 'provider:email', 'provider:push', 'ssl:domains']))
    expect(out.find((c) => c.service === 'fn:ops')?.status).toBe('ok')
  })
})
