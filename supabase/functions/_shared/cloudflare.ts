// Cloudflare for SaaS — custom hostnames for hospitals' own domains (phase 2.3 of docs/MULTI_TENANCY.md).
//
//   POST   /zones/{zone}/custom_hostnames            { hostname, ssl: { method: 'http', type: 'dv' } }
//   GET    /zones/{zone}/custom_hostnames/{id}       → result.status, result.ssl.status, verification records
//   GET    /zones/{zone}/custom_hostnames?hostname=  (find an existing one)
//   DELETE /zones/{zone}/custom_hostnames/{id}
//
// The hospital adds ONE record: `CNAME <their domain> → <CF_CNAME_TARGET>`. With HTTP validation Cloudflare checks
// ownership and issues the certificate by itself once that CNAME is live. Pure helpers only (no Deno APIs) so the
// Node tests can import them too.
// deno-lint-ignore-file no-explicit-any

export const CF_API = 'https://api.cloudflare.com/client/v4'

export interface CfConfig { token: string; zone: string; target: string }

/** lower-case host, no scheme / path / port / trailing dot */
export function normaliseDomain(input: string): string {
  return String(input ?? '').trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '')
}

const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** why a domain can't be added (null = fine). `platform` = the Hospital Comrade domain, which no hospital may take. */
export function domainProblem(domain: string, platform: string): string | null {
  if (!HOST.test(domain)) return 'Enter a domain like www.yourhospital.in (no http://, no slashes).'
  const p = normaliseDomain(platform)
  if (p && (domain === p || domain === `www.${p}`)) return 'That is the platform’s own address.'
  return null
}

/** sub-domains of the platform (citycare.hospital.digitalcomrade.in) live in our own zone — no custom hostname needed */
export const isPlatformSubdomain = (domain: string, platform: string) => {
  const p = normaliseDomain(platform)
  return !!p && domain.endsWith(`.${p}`) && domain !== `www.${p}`
}

/** an apex domain (yourhospital.in) can't hold a CNAME at most DNS providers — suggest the www. form */
export const looksLikeApex = (domain: string) => domain.split('.').length === 2 ||
  /^[^.]+\.(co|org|net|gov|ac|edu|gen|firm|ind|res)\.in$/.test(domain)

export interface DomainState {
  status: string | null
  ssl_status: string | null
  verification: Record<string, unknown> | null
  last_error: string | null
  active: boolean
}

/** what we keep from a Cloudflare custom-hostname object */
export function summarise(r: any): DomainState {
  const ssl = r?.ssl ?? {}
  const errors = [...(r?.verification_errors ?? []), ...(ssl.validation_errors ?? []).map((e: any) => e?.message ?? String(e))].filter(Boolean)
  const verification: Record<string, unknown> = {}
  if (r?.ownership_verification) verification.txt = r.ownership_verification
  if (r?.ownership_verification_http) verification.http = r.ownership_verification_http
  if (Array.isArray(ssl.validation_records) && ssl.validation_records.length) verification.ssl = ssl.validation_records
  const status = r?.status ?? null
  const sslStatus = ssl.status ?? null
  return {
    status, ssl_status: sslStatus,
    verification: Object.keys(verification).length ? verification : null,
    last_error: errors.length ? errors.join(' · ').slice(0, 500) : null,
    active: status === 'active' && sslStatus === 'active',
  }
}

/** a Cloudflare API call; throws with Cloudflare's own message on failure */
export async function cf(cfg: CfConfig, method: string, path: string, body?: unknown, f: typeof fetch = fetch): Promise<any> {
  const res = await f(`${CF_API}/zones/${cfg.zone}/custom_hostnames${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let j: any = null
  try { j = await res.json() } catch { /* empty body */ }
  if (!res.ok || j?.success === false) {
    const msg = (j?.errors ?? []).map((e: any) => `${e.message}${e.code ? ` (${e.code})` : ''}`).join('; ') || `Cloudflare HTTP ${res.status}`
    const err = new Error(msg) as Error & { status?: number; codes?: number[] }
    err.status = res.status; err.codes = (j?.errors ?? []).map((e: any) => e.code)
    throw err
  }
  return j?.result
}

export const createHostname = (cfg: CfConfig, hostname: string, f?: typeof fetch) =>
  cf(cfg, 'POST', '', { hostname, ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } } }, f)
export const getHostname = (cfg: CfConfig, id: string, f?: typeof fetch) => cf(cfg, 'GET', `/${encodeURIComponent(id)}`, undefined, f)
export const findHostname = async (cfg: CfConfig, hostname: string, f?: typeof fetch) =>
  ((await cf(cfg, 'GET', `?hostname=${encodeURIComponent(hostname)}`, undefined, f)) ?? [])[0] ?? null
export const deleteHostname = (cfg: CfConfig, id: string, f?: typeof fetch) => cf(cfg, 'DELETE', `/${encodeURIComponent(id)}`, undefined, f)
