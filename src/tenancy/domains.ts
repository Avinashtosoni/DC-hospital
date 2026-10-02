/**
 * A hospital's own domains (Settings → Domain). With a database this talks to the `domains` Edge Function
 * (Cloudflare for SaaS); in demo mode it simulates the same flow in the browser so it can be tried on the demo.
 */
import { platformDomain, supabase } from '../lib/supabase'
import { domainProblem, isPlatformSubdomain, normaliseDomain } from '../../supabase/functions/_shared/cloudflare'
import { activeDemoTenant, demoKey } from './demo'

export interface DomainRow {
  domain: string
  is_primary: boolean
  method: 'manual' | 'cloudflare'
  status: string | null
  ssl_status: string | null
  verified_at: string | null
  dns_target: string | null
  verification: { txt?: { name: string; value: string }; http?: { http_url: string; http_body: string }; ssl?: unknown[] } | null
  last_error: string | null
  checked_at: string | null
  created_at?: string
}
export interface DomainsState {
  domains: DomainRow[]
  /** Cloudflare for SaaS configured on the server */
  cloudflare: boolean
  /** CNAME target hospitals point their domain at */
  target: string | null
  platform: string
  /** provider admin → may add / remove / change the primary address */
  canManage: boolean
}
export type DomainAction =
  | { action: 'list' }
  | { action: 'check' | 'remove' | 'primary'; domain: string }
  | { action: 'add'; domain: string; method?: 'cloudflare' | 'manual' }

export const DOMAINS_QK = ['tenant-domains'] as const
export const DEMO_TARGET = `customers.${platformDomain}`

/** what the hospital's domain looks like to people: live, waiting for DNS, set up by hand, or broken */
export function domainHealth(d: DomainRow): 'live' | 'pending' | 'manual' | 'problem' {
  if (d.verified_at || (d.status === 'active' && (d.ssl_status === 'active' || d.method === 'manual'))) return 'live'
  if (d.method === 'manual') return 'manual'
  if (d.status === 'missing' || /blocked|moved|deleted|failed|timed_out/.test(`${d.status} ${d.ssl_status}`)) return 'problem'
  return 'pending'
}

/** the "Name / Host" a DNS provider wants for a CNAME — www for www.example.in, @ for an apex */
export function dnsHostLabel(domain: string): string {
  const parts = domain.split('.')
  const apexLen = /\.(co|org|net|gov|ac|edu|gen|firm|ind|res)\.in$/.test(domain) ? 3 : 2
  return parts.length > apexLen ? parts.slice(0, parts.length - apexLen).join('.') : '@'
}

// ------------------------------------------------------------------ Supabase (Edge Function)
async function remote(body: DomainAction): Promise<DomainsState> {
  const { data, error } = await supabase!.functions.invoke('domains', { body })
  if (error) {
    const e = error as { message?: string; context?: Response }
    let msg = e.message ?? 'Request failed'
    try { const j = await e.context?.json?.(); if (j?.error) msg = j.error } catch { /* not json */ }
    if (/Failed to send a request|FunctionsFetchError|not found/i.test(msg)) msg = 'The "domains" Edge Function is not deployed yet — run: supabase functions deploy domains'
    throw new Error(msg)
  }
  return data as DomainsState
}

// ------------------------------------------------------------------ demo mode (browser only)
const KEY = 'dch:domains:v1'
function readLocal(): DomainRow[] {
  try { const v = localStorage.getItem(demoKey(KEY)); if (v) return JSON.parse(v) as DomainRow[] } catch { /* ignore */ }
  const t = activeDemoTenant()
  const now = new Date().toISOString()
  return [{ domain: `www.${t.domain}`, is_primary: true, method: 'cloudflare', status: 'active', ssl_status: 'active', verified_at: now, dns_target: DEMO_TARGET, verification: null, last_error: null, checked_at: now }]
}
const writeLocal = (rows: DomainRow[]) => { try { localStorage.setItem(demoKey(KEY), JSON.stringify(rows)) } catch { /* ignore */ } }

async function local(body: DomainAction, canManage: boolean): Promise<DomainsState> {
  await new Promise((r) => setTimeout(r, 350))
  let rows = readLocal()
  const domain = 'domain' in body ? normaliseDomain(body.domain) : ''
  const now = new Date().toISOString()
  const find = () => rows.find((r) => r.domain === domain)
  if (body.action !== 'list' && body.action !== 'check' && !canManage) throw new Error('Domains are managed by the platform team.')
  if (body.action === 'add') {
    const p = domainProblem(domain, platformDomain)
    if (p) throw new Error(p)
    if (find()) throw new Error('This domain is already added.')
    const own = isPlatformSubdomain(domain, platformDomain)
    const manual = own || body.method === 'manual'
    rows.push({ domain, is_primary: !rows.some((r) => r.is_primary), method: manual ? 'manual' : 'cloudflare',
      status: own ? 'active' : manual ? 'manual' : 'pending', ssl_status: own ? 'active' : manual ? null : 'pending_validation',
      verified_at: own ? now : null, dns_target: own ? null : DEMO_TARGET,
      verification: manual ? null : { txt: { name: `_cf-custom-hostname.${domain}`, value: crypto.randomUUID() } },
      last_error: manual ? null : 'custom hostname does not CNAME to this zone.', checked_at: now })
  } else if (body.action === 'check') {
    const r = find()
    if (!r) throw new Error('No such domain for this hospital.')
    // demo: the first check finds the CNAME in place and the certificate issued
    if (r.method === 'cloudflare' && !r.verified_at) Object.assign(r, { status: 'active', ssl_status: 'active', verified_at: now, last_error: null })
    r.checked_at = now
  } else if (body.action === 'remove') {
    rows = rows.filter((r) => r.domain !== domain)
    if (rows.length && !rows.some((r) => r.is_primary)) rows[0].is_primary = true
  } else if (body.action === 'primary') {
    if (!find()) throw new Error('No such domain for this hospital.')
    rows = rows.map((r) => ({ ...r, is_primary: r.domain === domain }))
  }
  writeLocal(rows)
  return { domains: rows, cloudflare: true, target: DEMO_TARGET, platform: platformDomain, canManage }
}

export const domainsApi = (body: DomainAction, demoCanManage: boolean) => (supabase ? remote(body) : local(body, demoCanManage))
