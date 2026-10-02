import { describe, expect, it } from 'vitest'
import { headerChecks, parseEnvJs, preflight } from '../scripts/preflight'

const ENV = `// Generated at container start — do not edit.
window.__ENV__ = { "VITE_SUPABASE_URL": "https://abc.supabase.co", "VITE_SUPABASE_ANON_KEY": "anon", "REQUIRE_BACKEND": "true", "TENANCY": "multi", "APP_ENV": "production", "PLATFORM_NAME": "Hospital Comrade", "PLATFORM_DOMAIN": "h.in", "PLATFORM_LEGAL_NAME": "Digital Comrade" };
`
const SEC = { 'content-security-policy': "default-src 'self'; object-src 'none'; frame-ancestors 'self'", 'strict-transport-security': 'max-age=31536000', 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN' }

function fakeFetch(over: Record<string, Response> = {}) {
  return async (url: string, init?: RequestInit) => {
    const u = new URL(url), key = `${init?.method ?? 'GET'} ${u.host}${u.pathname}`
    if (over[key]) return over[key].clone()
    if (u.host === 'h.in') {
      if (u.pathname === '/env.js') return new Response(ENV)
      if (u.pathname === '/control-panel/') return new Response('', { headers: { 'x-robots-tag': 'noindex, nofollow' } })
      return new Response('ok', { headers: SEC })
    }
    if (u.pathname === '/rest/v1/rpc/platform_signup_info') return Response.json({ enabled: true, mode: 'approve', trialDays: 14 })
    if (u.pathname === '/rest/v1/rpc/resolve_tenant') return Response.json([{ slug: 'main' }])
    if (u.pathname === '/rest/v1/patients') return Response.json([])
    if (u.pathname.startsWith('/functions/v1/')) return new Response('ok')
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
    expect(ro[0].status).toBe('warn')
    expect(ro[2].status).toBe('fail')
  })
  it('a healthy platform has nothing blocking', async () => {
    const r = await preflight('https://h.in/', { hospital: 'main', fetch: fakeFetch() })
    expect(r.filter((c) => c.status === 'fail')).toEqual([])
    expect(r.find((c) => c.name === 'Free-trial sign-up')?.detail).toBe('open · review first · 14 days')
    expect(r.find((c) => c.name === 'Company details for the legal pages')?.status).toBe('warn')
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
  it('stops early when the site is down', async () => {
    const r = await preflight('http://h.in', { fetch: async () => { throw new Error('ECONNREFUSED') } })
    expect(r.map((c) => c.status)).toEqual(['fail', 'fail'])
  })
})
