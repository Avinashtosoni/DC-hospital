/**
 * Go-live preflight (phase 8.4) — checks a deployed platform from the outside, the way a browser sees it.
 *
 *   npm run preflight -- https://hospital.digitalcomrade.in
 *   npm run preflight -- https://hospital.digitalcomrade.in --hospital=main      (also open one hospital)
 *
 * Reads the deployment's own /env.js for the Supabase URL and anon key, so no secrets are needed. Checks: the site
 * answers, multi-hospital mode with a real backend, security headers, the legal pages, the control panel is not
 * indexed, the database has every phase installed, Supabase Auth requires e-mail confirmation, the Edge Functions are
 * deployed, and sign-up is configured.
 * Exit code 1 when anything fails (warnings don't fail). Nothing is written anywhere.
 */

export type Status = 'ok' | 'warn' | 'fail'
export interface Check { name: string; status: Status; detail: string }

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

/** window.__ENV__ = { … } → object (only the JSON literal is read; the file is never executed) */
export function parseEnvJs(src: string): Record<string, string> {
  const m = src.match(/window\.__ENV__\s*=\s*(\{[\s\S]*?\})\s*;?\s*$/m)
  if (!m) return {}
  try { return JSON.parse(m[1]) as Record<string, string> } catch { return {} }
}

/** the headers every page should carry */
export function headerChecks(h: Headers): Check[] {
  const csp = h.get('content-security-policy')
  const cspRo = h.get('content-security-policy-report-only')
  const hsts = h.get('strict-transport-security')
  return [
    csp ? { name: 'Content-Security-Policy', status: /frame-ancestors/.test(csp) && /object-src 'none'/.test(csp) ? 'ok' : 'fail', detail: 'enforced' }
      : cspRo ? { name: 'Content-Security-Policy', status: 'fail', detail: 'report-only — set CSP_MODE=enforce' }
      : { name: 'Content-Security-Policy', status: 'fail', detail: 'missing — CSP_MODE=off or an old image' },
    hsts ? { name: 'Strict-Transport-Security', status: /max-age=(\d{7,})/.test(hsts) ? 'ok' : 'fail', detail: hsts }
      : { name: 'Strict-Transport-Security', status: 'fail', detail: 'missing — enable HSTS on the HTTPS endpoint' },
    { name: 'X-Content-Type-Options', status: h.get('x-content-type-options') === 'nosniff' ? 'ok' : 'fail', detail: h.get('x-content-type-options') ?? 'missing' },
    { name: 'X-Frame-Options', status: h.get('x-frame-options') ? 'ok' : 'warn', detail: h.get('x-frame-options') ?? 'missing (CSP frame-ancestors is the primary control)' },
  ]
}

export async function preflight(base: string, opts: { hospital?: string; fetch?: Fetch } = {}): Promise<Check[]> {
  const f: Fetch = opts.fetch ?? ((u, i) => fetch(u, { redirect: 'follow', ...i, signal: AbortSignal.timeout(15_000) }))
  const root = base.replace(/\/+$/, '')
  const out: Check[] = []
  const add = (name: string, status: Status, detail: string) => out.push({ name, status, detail })
  let rootUrl: URL | null = null
  try { rootUrl = new URL(root) } catch { /* invalid address */ }
  if (!rootUrl || rootUrl.protocol !== 'https:' || rootUrl.username || rootUrl.password || rootUrl.search || rootUrl.hash) {
    add('HTTPS', 'fail', `${root || '(empty address)'} — use a valid https:// address without embedded credentials`)
    return out // Never send probe traffic (or API keys) over an untrusted/invalid base URL.
  }
  add('HTTPS', 'ok', rootUrl.origin)
  const get = async (path: string, init?: RequestInit) => { try { return await f(`${root}${path}`, init) } catch (e) { return e as Error } }

  // 1. the site
  const health = await get('/healthz')
  if (health instanceof Error || !health.ok) { add('Site reachable (/healthz)', 'fail', health instanceof Error ? health.message : `HTTP ${health.status}`); return out }
  add('Site reachable (/healthz)', 'ok', 'ok')
  const home = await get('/')
  if (!(home instanceof Error)) out.push(...headerChecks(home.headers))

  // 2. runtime config
  const envRes = await get('/env.js')
  const envOk = !(envRes instanceof Error) && envRes.ok
  const env = envRes instanceof Error || !envRes.ok ? {} : parseEnvJs(await envRes.text())
  add('Runtime config (/env.js)', envOk && Object.keys(env).length ? 'ok' : 'fail', envOk && Object.keys(env).length ? 'parsed' : envRes instanceof Error ? envRes.message : `HTTP ${envRes.status} or invalid JSON`)
  const url = (env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, ''), key = env.VITE_SUPABASE_ANON_KEY ?? ''
  let backendHttps = false
  try {
    const backendUrl = new URL(url)
    backendHttps = backendUrl.protocol === 'https:' && !backendUrl.username && !backendUrl.password && !backendUrl.search && !backendUrl.hash
  } catch { /* invalid / missing URL */ }
  const backendReady = backendHttps && !!key.trim()
  add('Backend configured', backendReady ? 'ok' : 'fail', backendReady ? url : 'VITE_SUPABASE_URL must be HTTPS and VITE_SUPABASE_ANON_KEY must be set')
  add('Multi-hospital mode', env.TENANCY === 'multi' ? 'ok' : 'fail', `TENANCY=${env.TENANCY ?? '(unset)'}`)
  add('Production environment', env.APP_ENV === 'staging' ? 'warn' : 'ok', `APP_ENV=${env.APP_ENV ?? 'production'}`)
  // REQUIRE_BACKEND is now optional: the app no longer has a browser-only/demo data mode.
  add('Backend fallback disabled', 'ok', 'the app has no in-browser demo mode; REQUIRE_BACKEND is optional')
  const missingLegal = ['PLATFORM_LEGAL_NAME', 'PLATFORM_ADDRESS', 'PLATFORM_EMAIL', 'PLATFORM_GRIEVANCE_OFFICER'].filter((k) => !env[k])
  add('Company details for the legal pages', missingLegal.length ? 'warn' : 'ok', missingLegal.length ? `not set (defaults shown): ${missingLegal.join(', ')}` : env.PLATFORM_LEGAL_NAME)
  add('Error reporting', env.SENTRY_DSN ? 'ok' : 'warn', env.SENTRY_DSN ? 'SENTRY_DSN set' : 'SENTRY_DSN not set (optional)')

  // 3. pages
  for (const p of ['/legal/terms', '/legal/privacy', '/legal/refunds', '/signup']) {
    const r = await get(p)
    add(`Page ${p}`, !(r instanceof Error) && r.ok ? 'ok' : 'fail', r instanceof Error ? r.message : `HTTP ${r.status}`)
  }
  const panel = await get('/control-panel/')
  add('Control panel not indexed', !(panel instanceof Error) && /noindex/.test(panel.headers.get('x-robots-tag') ?? '') ? 'ok' : 'fail',
    panel instanceof Error ? panel.message : panel.headers.get('x-robots-tag') ?? 'no X-Robots-Tag')

  // 4. the database
  if (backendReady) {
    const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
    const rpc = async (fn: string, body: object = {}) => { try { return await f(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: JSON.stringify(body) }) } catch (e) { return e as Error } }
    const info = await rpc('platform_signup_info')
    if (info instanceof Error || !info.ok) add('Database up to date', 'fail', info instanceof Error ? info.message : `platform_signup_info → HTTP ${info.status}: run supabase/upgrade-2026-10.sql (or production.sql on a new project)`)
    else {
      type SignupInfo = { enabled?: unknown; mode?: unknown; trialDays?: unknown; plan?: unknown; plans?: unknown; otp?: unknown }
      let rawSignupInfo: unknown = null
      try { rawSignupInfo = await info.json() } catch { /* invalid response */ }
      const s = rawSignupInfo && typeof rawSignupInfo === 'object' && !Array.isArray(rawSignupInfo) ? rawSignupInfo as SignupInfo : null
      const rawOtp = s?.otp
      const otp = rawOtp && typeof rawOtp === 'object' && !Array.isArray(rawOtp) ? rawOtp as Record<string, unknown> : null
      const validSignupInfo = !!s
        && typeof s.enabled === 'boolean' && (s.mode === 'instant' || s.mode === 'approve')
        && Number.isInteger(s.trialDays) && (s.trialDays as number) >= 1 && (s.trialDays as number) <= 90
        && typeof s.plan === 'string' && !!s.plan.trim()
        && Array.isArray(s.plans) && s.plans.every((p: unknown) => typeof p === 'string')
        && !!otp && typeof otp.required === 'boolean' && Array.isArray(otp.channels)
        && otp.channels.every((c: unknown) => c === 'sms' || c === 'whatsapp')
      if (!s || !validSignupInfo) {
        add('Database up to date', 'fail', 'platform_signup_info returned an unexpected response — run supabase/upgrade-2026-10.sql')
        add('Free-trial sign-up', 'fail', 'could not verify configuration')
      } else {
        add('Database up to date', 'ok', 'phase 8 functions installed')
        add('Free-trial sign-up', 'ok', s.enabled ? `open · ${s.mode === 'instant' ? 'instant' : 'review first'} · ${s.trialDays} days` : 'closed (contact form only)')
      }
    }
    if (opts.hospital) {
      const t = await rpc('resolve_tenant', { p_host: new URL(root).hostname, p_slug: opts.hospital })
      let rows: unknown = null
      try { if (!(t instanceof Error) && t.ok) rows = await t.json() } catch { /* invalid response */ }
      const found = Array.isArray(rows) && rows.length > 0
      add(`Hospital "${opts.hospital}"`, found ? 'ok' : 'fail', found ? 'found' : 'not found or response was malformed')
    }
    // Auth: "Confirm email" must stay on — owners, doctors and staff are matched to their hospital by e-mail, so an
    // unconfirmed sign-up with someone else's address must never get in (GoTrue's public settings endpoint says)
    try {
      const r = await f(`${url}/auth/v1/settings`, { headers: { apikey: key } })
      if (!r.ok) {
        add('Auth: confirm e-mail', 'fail', `could not verify /auth/v1/settings (HTTP ${r.status})`)
        add('Auth: sign-ups allowed', 'fail', `could not verify /auth/v1/settings (HTTP ${r.status})`)
      } else {
        const a = await r.json() as { mailer_autoconfirm?: unknown; disable_signup?: unknown }
        if (typeof a.mailer_autoconfirm !== 'boolean') add('Auth: confirm e-mail', 'fail', 'setting is missing or unknown — confirm e-mail could not be verified')
        else add('Auth: confirm e-mail', a.mailer_autoconfirm ? 'fail' : 'ok', a.mailer_autoconfirm
          ? '"Confirm email" is OFF — anyone could sign up with an owner\'s or doctor\'s address. Supabase → Authentication → Providers → Email → turn "Confirm email" on'
          : 'on — new accounts must confirm their e-mail')
        if (typeof a.disable_signup !== 'boolean') add('Auth: sign-ups allowed', 'fail', 'setting is missing or unknown — sign-up configuration could not be verified')
        else add('Auth: sign-ups allowed', a.disable_signup ? 'fail' : 'ok', a.disable_signup
          ? 'sign-ups are disabled in Supabase Auth — new owners, staff invites and patients cannot create accounts'
          : 'on')
      }
    } catch (e) {
      add('Auth: confirm e-mail', 'fail', (e as Error).message)
      add('Auth: sign-ups allowed', 'fail', 'could not verify Supabase Auth configuration')
    }
    // anonymous visitors must not read private tables. A 401/403 is an explicit deny; network/server errors are unknown.
    try {
      const r = await f(`${url}/rest/v1/patients?select=id&limit=1`, { headers: h })
      if (r.status === 401 || r.status === 403) add('Patients hidden from visitors', 'ok', `anonymous read explicitly denied (HTTP ${r.status})`)
      else if (!r.ok) add('Patients hidden from visitors', 'fail', `could not verify access (HTTP ${r.status})`)
      else {
        const rows = await r.json() as unknown
        add('Patients hidden from visitors', Array.isArray(rows) && rows.length === 0 ? 'ok' : 'fail',
          Array.isArray(rows) && rows.length === 0 ? 'anonymous read → no rows' : Array.isArray(rows) ? 'anonymous visitors can read patients!' : 'unexpected response — access could not be verified')
      }
    } catch (e) { add('Patients hidden from visitors', 'fail', (e as Error).message) }
    // Edge Functions must answer a successful CORS preflight; errors and unreachable checks are failures, not unknown passes.
    for (const fn of ['notify', 'billing', 'domains', 'whatsapp-bot']) {
      let r: Response | Error
      try { r = await f(`${url}/functions/v1/${fn}`, { method: 'OPTIONS', headers: { Origin: root, 'Access-Control-Request-Method': 'POST' } }) } catch (e) { r = e as Error }
      add(`Function ${fn}`, r instanceof Error ? 'fail' : r.ok ? 'ok' : 'fail', r instanceof Error ? r.message : r.ok ? `HTTP ${r.status}` : `not ready (HTTP ${r.status})`)
    }
  } else {
    add('Database up to date', 'fail', 'cannot check the schema until an HTTPS Supabase URL and anon key are configured')
  }
  return out
}

const ICON: Record<Status, string> = { ok: '✓', warn: '!', fail: '✗' }

async function main() {
  const args = process.argv.slice(2)
  const base = args.find((a) => !a.startsWith('--'))
  const hospital = args.find((a) => a.startsWith('--hospital='))?.split('=')[1]
  if (!base) { console.error('Usage: npm run preflight -- https://your-platform-domain [--hospital=slug]'); process.exit(2) }
  console.log(`Preflight for ${base}\n`)
  const checks = await preflight(base, { hospital })
  const w = Math.max(...checks.map((c) => c.name.length))
  for (const c of checks) console.log(` ${ICON[c.status]}  ${c.name.padEnd(w)}  ${c.detail}`)
  const fails = checks.filter((c) => c.status === 'fail').length, warns = checks.filter((c) => c.status === 'warn').length
  console.log(`\n${fails ? `✗ ${fails} to fix` : '✓ Nothing blocking'}${warns ? ` · ${warns} to review` : ''} — then open the control panel → System health → Launch checklist.`)
  process.exit(fails ? 1 : 0)
}

if (process.argv[1] && /preflight\.ts$/.test(process.argv[1])) void main()
