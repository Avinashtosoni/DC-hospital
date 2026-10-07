/**
 * A hospital's own domains (Settings → Domain). With a database this talks to the `domains` Edge Function
 * (Cloudflare for SaaS).
 */
import { supabase } from '../lib/supabase'

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

export const domainsApi = (body: DomainAction, _canManage?: boolean) => remote(body)
