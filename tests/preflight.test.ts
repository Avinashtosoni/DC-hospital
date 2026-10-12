import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deployArgs, deployCommands } from '../scripts/deploy-functions'
import { headerChecks, parseEnvJs, preflight } from '../scripts/preflight'
import { FUNCTION_MANIFEST, REQUIRED_FUNCTION_CORS_HEADERS } from '../supabase/functions/_shared/manifest'

const ENV = `// Generated at container start — do not edit.
window.__ENV__ = { "VITE_SUPABASE_URL": "https://abc.supabase.co", "VITE_SUPABASE_ANON_KEY": "anon", "REQUIRE_BACKEND": "true", "TENANCY": "multi", "APP_ENV": "production", "PLATFORM_NAME": "Hospital Comrade", "PLATFORM_DOMAIN": "h.in", "PLATFORM_LEGAL_NAME": "Digital Comrade" };
`
const SEC = { 'content-security-policy': "default-src 'self'; object-src 'none'; frame-ancestors 'self'", 'strict-transport-security': 'max-age=31536000', 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN' }
const FUNCTION_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': [...REQUIRED_FUNCTION_CORS_HEADERS].join(', '),
}

function fakeFetch(over: Record<string, Response> = {}) {
  return async (url: string, init?: RequestInit) => {
    const u = new URL(url), key = `${init?.method ?? 'GET'} ${u.host}${u.pathname}`
    if (over[key]) return over[key].clone()
    if (u.host === 'h.in') {
      if (u.pathname === '/env.js') return new Response(ENV)
      if (u.pathname === '/control-panel/') return new Response('', { headers: { 'x-robots-tag': 'noindex, nofollow' } })
      return new Response('ok', { headers: SEC })
    }
    if (u.pathname === '/rest/v1/rpc/platform_signup_info') return Response.json({ enabled: true, mode: 'approve', trialDays: 14, plan: 'clinic', plans: ['clinic'], otp: { required: true, channels: ['whatsapp', 'sms'] } })
    if (u.pathname === '/rest/v1/rpc/resolve_tenant') return Response.json([{ slug: 'main' }])
    if (u.pathname === '/rest/v1/patients') return Response.json([])
    if (u.pathname === '/auth/v1/settings') return Response.json({ mailer_autoconfirm: false, disable_signup: false })
    if (u.pathname.startsWith('/functions/v1/')) return new Response('ok', { headers: FUNCTION_CORS })
    return new Response('nope', { status: 404 })
  }
}

describe('go-live preflight', () => {
  it('reads env.js without running it', () => {
    expect(parseEnvJs(ENV)).toMatchObject({ TENANCY: 'multi', VITE_SUPABASE_URL: 'https://abc.supabase.co' })
    expect(parseEnvJs('alert(1)')).toEqual({})
  })
  it('grades security headers', () => {
    expect(headerChecks(new Headers(SEC)).map((c) => c.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    const ro = headerChecks(new Headers({ 'content-security-policy-report-only': 'x' }))
    expect(ro[0].status).toBe('fail')
    expect(ro[1].status).toBe('fail')
    expect(ro[2].status).toBe('fail')
  })
  it('uses one manifest for every deployed Edge Function and its gateway-JWT mode', () => {
    const dirs = readdirSync(resolve(process.cwd(), 'supabase/functions'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
      .map((entry) => entry.name).sort()
    const manifest = FUNCTION_MANIFEST.map((entry) => entry.name).sort()
    expect(manifest).toEqual(dirs)
    expect(new Set(manifest).size).toBe(manifest.length)
    expect(FUNCTION_MANIFEST.filter((entry) => !entry.verifyJwt).map((entry) => entry.name).sort())
      .toEqual(['billing', 'whatsapp-bot'])
    expect(deployArgs('billing', false)).toEqual(['functions', 'deploy', 'billing', '--no-verify-jwt'])
    expect(deployCommands()).toContain('supabase functions deploy ai-page-builder')
    expect(deployCommands()).toContain('supabase functions deploy whatsapp-bot --no-verify-jwt')
  })
  it('a healthy platform has nothing blocking', async () => {
    const r = await preflight('https://h.in/', { hospital: 'main', fetch: fakeFetch() })
    expect(r.filter((c) => c.status === 'fail')).toEqual([])
    expect(r.find((c) => c.name === 'Free-trial sign-up')?.detail).toBe('open · review first · 14 days')
    expect(r.find((c) => c.name === 'Company details for the legal pages')?.status).toBe('warn')
  })
  it('fails closed when a deployed function does not permit the app CORS request', async () => {
    const r = await preflight('https://h.in', { fetch: fakeFetch({
      'OPTIONS abc.supabase.co/functions/v1/ai-page-builder': new Response('ok', {
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'OPTIONS' },
      }),
    }) })
    const check = r.find((c) => c.name === 'Function ai-page-builder')
    expect(check?.status).toBe('fail')
    expect(check?.detail).toMatch(/invalid CORS.*POST=false.*authorization/)
  })
  it('flags demo mode, an old database, readable patients and missing functions', async () => {
    const r = await preflight('https://h.in', { fetch: fakeFetch({
      'GET h.in/env.js': new Response('window.__ENV__ = { "VITE_SUPABASE_URL": "https://abc.supabase.co", "VITE_SUPABASE_ANON_KEY": "anon", "TENANCY": "single" };'),
      'POST abc.supabase.co/rest/v1/rpc/platform_signup_info': new Response('{}', { status: 404 }),
      'GET abc.supabase.co/rest/v1/patients': Response.json([{ id: 1 }]),
      'OPTIONS abc.supabase.co/functions/v1/billing': new Response('', { status: 404 }),
    }) })
    const failed = r.filter((c) => c.status === 'fail').map((c) => c.name)
    expect(failed).toEqual(['Multi-hospital mode', 'Database up to date', 'Patients hidden from visitors', 'Function billing'])
  })
  it('fails when Supabase Auth lets people in without confirming their e-mail', async () => {
    const r = await preflight('https://h.in', { fetch: fakeFetch({ 'GET abc.supabase.co/auth/v1/settings': Response.json({ mailer_autoconfirm: true, disable_signup: true }) }) })
    expect(r.filter((c) => c.status === 'fail').map((c) => c.name)).toEqual(['Auth: confirm e-mail', 'Auth: sign-ups allowed'])
    expect(r.find((c) => c.name === 'Auth: confirm e-mail')?.detail).toMatch(/Confirm email" is OFF/)
    const unknown = await preflight('https://h.in', { fetch: fakeFetch({ 'GET abc.supabase.co/auth/v1/settings': new Response('', { status: 401 }) }) })
    expect(unknown.filter((c) => c.name.startsWith('Auth:')).map((c) => c.status)).toEqual(['fail', 'fail'])
  })
  it('fails closed for unknown, malformed and error responses', async () => {
    const signup = await preflight('https://h.in', { fetch: fakeFetch({
      'POST abc.supabase.co/rest/v1/rpc/platform_signup_info': Response.json({ enabled: true, mode: 'unknown', trialDays: -1 }),
    }) })
    expect(signup.find((c) => c.name === 'Database up to date')?.status).toBe('fail')
    expect(signup.find((c) => c.name === 'Free-trial sign-up')?.status).toBe('fail')

    const auth = await preflight('https://h.in', { fetch: fakeFetch({
      'GET abc.supabase.co/auth/v1/settings': Response.json(null),
      'GET abc.supabase.co/rest/v1/patients': new Response('unavailable', { status: 503 }),
      'OPTIONS abc.supabase.co/functions/v1/notify': new Response('unavailable', { status: 503 }),
    }) })
    expect(auth.filter((c) => c.name.startsWith('Auth:')).map((c) => c.status)).toEqual(['fail', 'fail'])
    expect(auth.find((c) => c.name === 'Patients hidden from visitors')?.status).toBe('fail')
    expect(auth.find((c) => c.name === 'Function notify')?.status).toBe('fail')
  })
  it('never probes an invalid/insecure Supabase URL and does not require REQUIRE_BACKEND', async () => {
    const optionalEnv = ENV.replace(', "REQUIRE_BACKEND": "true"', '')
    const optional = await preflight('https://h.in', { fetch: fakeFetch({ 'GET h.in/env.js': new Response(optionalEnv) }) })
    expect(optional.find((c) => c.name === 'Backend configured')?.status).toBe('ok')
    expect(optional.find((c) => c.name === 'Backend fallback disabled')?.status).toBe('ok')

    let backendRequests = 0
    const insecureEnv = optionalEnv.replace('https://abc.supabase.co', 'http://abc.supabase.co')
    const insecure = await preflight('https://h.in', { fetch: async (url, init) => {
      if (new URL(url).host === 'abc.supabase.co') backendRequests++
      if (new URL(url).pathname === '/env.js') return new Response(insecureEnv)
      return fakeFetch()(url, init)
    } })
    expect(insecure.find((c) => c.name === 'Backend configured')?.status).toBe('fail')
    expect(insecure.find((c) => c.name === 'Database up to date')?.status).toBe('fail')
    expect(insecure.filter((c) => c.name.startsWith('Auth:') || c.name.startsWith('Function '))).toEqual([])
    expect(backendRequests).toBe(0)
  })
  it('stops before any request when the public site address is unsafe', async () => {
    for (const base of ['http://h.in', 'https://user:pass@h.in', 'https://h.in/?x=1', 'https://h.in/#frag']) {
      let calls = 0
      const r = await preflight(base, { fetch: async () => { calls++; throw new Error('must not probe') } })
      expect(r).toHaveLength(1)
      expect(r[0].status).toBe('fail')
      expect(calls).toBe(0)
    }
  })
  it('stops early when the site is down', async () => {
    const r = await preflight('https://h.in', { fetch: async () => { throw new Error('ECONNREFUSED') } })
    expect(r.map((c) => c.status)).toEqual(['ok', 'fail'])
  })
})
