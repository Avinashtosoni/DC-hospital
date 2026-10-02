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
    csp ? { name: 'Content-Security-Policy', status: /frame-ancestors/.test(csp) && /object-src 'none'/.test(csp) ? 'ok' : 'warn', detail: 'enforced' }
      : cspRo ? { name: 'Content-Security-Policy', status: 'warn', detail: 'report-only (CSP_MODE=report-only) — switch to enforce once the console is clean' }
      : { name: 'Content-Security-Policy', status: 'fail', detail: 'missing — CSP_MODE=off or an old image' },
    hsts ? { name: 'Strict-Transport-Security', status: /max-age=(\d{7,})/.test(hsts) ? 'ok' : 'warn', detail: hsts } : { name: 'Strict-Transport-Security', status: 'warn', detail: 'missing (HSTS=off?)' },
    { name: 'X-Content-Type-Options', status: h.get('x-content-type-options') === 'nosniff' ? 'ok' : 'fail', detail: h.get('x-content-type-options') ?? 'missing' },
    { name: 'X-Frame-Options', status: h.get('x-frame-options') ? 'ok' : 'warn', detail: h.get('x-frame-options') ?? 'missing' },
  ]
}

export async function preflight(base: string, opts: { hospital?: string; fetch?: Fetch } = {}): Promise<Check[]> {
  const f: Fetch = opts.fetch ?? ((u, i) => fetch(u, { redirect: 'follow', ...i, signal: AbortSignal.timeout(15_000) }))
  const root = base.replace(/\/+$/, '')
  const out: Check[] = []
  const add = (name: string, status: Status, detail: string) => out.push({ name, status, detail })
  const get = async (path: string, init?: RequestInit) => { try { return await f(`${root}${path}`, init) } catch (e) { return e as Error } }

  // 1. the site
  if (!root.startsWith('https://')) add('HTTPS', 'fail', `${root} — use the https:// address`)
  const health = await get('/healthz')
  if (health instanceof Error || !health.ok) { add('Site reachable (/healthz)', 'fail', health instanceof Error ? health.message : `HTTP ${health.status}`); return out }
  add('Site reachable (/healthz)', 'ok', 'ok')
  const home = await get('/')
  if (!(home instanceof Error)) out.push(...headerChecks(home.headers))

  // 2. runtime config
  const envRes = await get('/env.js')
  const env = envRes instanceof Error || !envRes.ok ? {} : parseEnvJs(await envRes.text())
  const url = (env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, ''), key = env.VITE_SUPABASE_ANON_KEY ?? ''
  add('Backend configured', url && key ? 'ok' : 'fail', url && key ? url : 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are empty — the site runs in demo mode')
  add('Multi-hospital mode', env.TENANCY === 'multi' ? 'ok' : 'fail', `TENANCY=${env.TENANCY ?? '(unset)'}`)
  add('Production environment', env.APP_ENV === 'staging' ? 'warn' : 'ok', `APP_ENV=${env.APP_ENV ?? 'production'}`)
  add('Backend required', env.REQUIRE_BACKEND && env.REQUIRE_BACKEND !== 'false' ? 'ok' : 'warn', env.REQUIRE_BACKEND ? 'REQUIRE_BACKEND set' : 'REQUIRE_BACKEND is not set — a config mistake would silently show demo data')
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
  if (url && key) {
    const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
    const rpc = async (fn: string, body: object = {}) => { try { return await f(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: JSON.stringify(body) }) } catch (e) { return e as Error } }
    const info = await rpc('platform_signup_info')
    if (info instanceof Error || !info.ok) add('Database up to date', 'fail', info instanceof Error ? info.message : `platform_signup_info → HTTP ${info.status}: run supabase/upgrade-2026-10.sql (or production.sql on a new project)`)
    else {
      const s = await info.json() as { enabled: boolean; mode: string; trialDays: number }
      add('Database up to date', 'ok', 'phase 8 functions installed')
      add('Free-trial sign-up', 'ok', s.enabled ? `open · ${s.mode === 'instant' ? 'instant' : 'review first'} · ${s.trialDays} days` : 'closed (contact form only)')
    }
    if (opts.hospital) {
      const t = await rpc('resolve_tenant', { p_host: new URL(root).hostname, p_slug: opts.hospital })
      const rows = t instanceof Error || !t.ok ? [] : await t.json() as unknown[]
      add(`Hospital "${opts.hospital}"`, Array.isArray(rows) && rows.length ? 'ok' : 'fail', Array.isArray(rows) && rows.length ? 'found' : 'not found')
    }
    // Auth: "Confirm email" must stay on — owners, doctors and staff are matched to their hospital by e-mail, so an
    // unconfirmed sign-up with someone else's address must never get in (GoTrue's public settings endpoint says)
    try {
      const r = await f(`${url}/auth/v1/settings`, { headers: { apikey: key } })
      if (!r.ok) add('Auth: confirm e-mail', 'warn', `could not read /auth/v1/settings (HTTP ${r.status}) — check Authentication → Providers → Email by hand`)
      else {
        const a = await r.json() as { mailer_autoconfirm?: boolean; disable_signup?: boolean }
        add('Auth: confirm e-mail', a.mailer_autoconfirm ? 'fail' : 'ok', a.mailer_autoconfirm
          ? '"Confirm email" is OFF — anyone could sign up with an owner\'s or doctor\'s address. Supabase → Authentication → Providers → Email → turn "Confirm email" on'
          : 'on — new accounts must confirm their e-mail')
        add('Auth: sign-ups allowed', a.disable_signup ? 'fail' : 'ok', a.disable_signup
          ? 'sign-ups are disabled in Supabase Auth — new owners, staff invites and patients cannot create accounts'
          : 'on')
      }
    } catch (e) { add('Auth: confirm e-mail', 'warn', (e as Error).message) }
    // anonymous visitors must not read private tables
    try {
      const r = await f(`${url}/rest/v1/patients?select=id&limit=1`, { headers: h })
      const rows = r.ok ? await r.json() as unknown[] : []
      add('Patients hidden from visitors', rows.length === 0 ? 'ok' : 'fail', rows.length === 0 ? `anonymous read → ${r.status === 200 ? 'no rows' : `HTTP ${r.status}`}` : 'anonymous visitors can read patients!')
    } catch (e) { add('Patients hidden from visitors', 'warn', (e as Error).message) }
    // Edge Functions: deployed functions answer the CORS preflight; missing ones are 404
    for (const fn of ['notify', 'billing', 'domains', 'whatsapp-bot']) {
      let r: Response | Error
      try { r = await f(`${url}/functions/v1/${fn}`, { method: 'OPTIONS', headers: { Origin: root, 'Access-Control-Request-Method': 'POST' } }) } catch (e) { r = e as Error }
      add(`Function ${fn}`, r instanceof Error ? 'warn' : r.status === 404 ? 'fail' : 'ok', r instanceof Error ? r.message : r.status === 404 ? 'not deployed (supabase functions deploy …)' : `HTTP ${r.status}`)
    }
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
