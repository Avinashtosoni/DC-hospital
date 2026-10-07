// Supabase Edge Function: a hospital's own domains (Cloudflare for SaaS custom hostnames). Phase 2.3.
//
//   supabase functions deploy domains
//   supabase secrets set CF_API_TOKEN=… CF_ZONE_ID=… CF_CNAME_TARGET=customers.hospital.digitalcomrade.in PLATFORM_DOMAIN=hospital.digitalcomrade.in
//
// Called by the app (Settings → Domain) with the signed-in user's token and the usual x-tenant-id / x-provider-mode
// headers; my_context() — run as the caller — decides which hospital this is, exactly like the database does.
//
//   POST { action: 'list' }                                   owner of the hospital, or a provider admin
//   POST { action: 'check',  domain }                         owner or provider admin — refreshes status from Cloudflare
//   POST { action: 'add',    domain, method?: 'cloudflare' | 'manual', primary?: boolean }      provider admin only
//   POST { action: 'remove', domain }                         provider admin only
//   POST { action: 'primary', domain }                        provider admin only — the hospital's canonical address
//
// Without CF_* secrets the function still works in 'manual' mode (the platform team sets DNS + SSL up by hand, e.g.
// a Coolify/Traefik domain). Sub-domains of PLATFORM_DOMAIN are always manual (they live in our own zone).
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, resolveCaller } from '../_shared/tenant.ts'
import {
  createHostname, deleteHostname, domainProblem, findHostname, getHostname, isPlatformSubdomain, normaliseDomain, summarise,
  type CfConfig,
} from '../_shared/cloudflare.ts'

const cors = corsHeaders('POST, OPTIONS')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const env = (k: string) => (Deno.env.get(k) ?? '').trim()
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const SUPABASE_URL = env('SUPABASE_URL')
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const userClient = (jwt: string, headers: Record<string, string>) => createClient(SUPABASE_URL, env('SUPABASE_ANON_KEY'), {
  auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}`, ...headers } },
})

const PLATFORM = normaliseDomain(env('PLATFORM_DOMAIN') || 'hospital.digitalcomrade.in')
const cfConfig = (): CfConfig | null => {
  const token = env('CF_API_TOKEN'), zone = env('CF_ZONE_ID')
  return token && zone ? { token, zone, target: normaliseDomain(env('CF_CNAME_TARGET') || PLATFORM) } : null
}

/** supabase-js returns errors instead of throwing — writes must not fail silently */
const must = async (q: PromiseLike<{ error: any }>) => { const { error } = await q; if (error) throw new Error(error.message) }

const COLS = 'domain, tenant_id, is_primary, method, status, ssl_status, verified_at, dns_target, verification, last_error, checked_at, created_at'
const list = async (tenant: string) =>
  ((await admin.from('tenant_domains').select(COLS).eq('tenant_id', tenant).order('is_primary', { ascending: false }).order('created_at')).data ?? [])
const row = async (tenant: string, domain: string) =>
  (await admin.from('tenant_domains').select(COLS + ', cf_hostname_id').eq('tenant_id', tenant).eq('domain', domain).maybeSingle()).data as any

/** Cloudflare's current state → the row (service role skips RLS → always filter on tenant_id) */
async function refresh(cfg: CfConfig, tenant: string, r: any) {
  let h: any = null
  try { h = r.cf_hostname_id ? await getHostname(cfg, r.cf_hostname_id) : await findHostname(cfg, r.domain) }
  catch (e: any) { if (e?.status !== 404) throw e }
  const patch: Record<string, unknown> = { checked_at: new Date().toISOString() }
  if (!h) Object.assign(patch, { status: 'missing', ssl_status: null, verified_at: null, last_error: 'Not found at Cloudflare — remove and add the domain again.' })
  else {
    const s = summarise(h)
    Object.assign(patch, { cf_hostname_id: h.id, status: s.status, ssl_status: s.ssl_status, verification: s.verification, last_error: s.last_error,
      verified_at: s.active ? (r.verified_at ?? new Date().toISOString()) : null })
  }
  await must(admin.from('tenant_domains').update(patch).eq('tenant_id', tenant).eq('domain', r.domain))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  let body: any
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const caller = await resolveCaller(req, { serviceKey: SERVICE_KEY, admin, userClient })
  if (caller.kind !== 'user' || !caller.tenant) return json({ error: 'Sign in first.' }, 403)
  const tenant = caller.tenant
  const isAdmin = caller.provider === 'admin'
  const isOwner = !caller.provider && caller.role === 'owner'
  if (!isAdmin && !isOwner) return json({ error: 'Only the hospital owner can see its domains.' }, 403)

  const action = String(body?.action ?? 'list')
  const cfg = cfConfig()
  const meta = { cloudflare: !!cfg, target: cfg?.target ?? null, platform: PLATFORM, canManage: isAdmin }
  const domain = normaliseDomain(body?.domain ?? '')

  try {
    if (action === 'list') return json({ ...meta, domains: await list(tenant) })

    if (action === 'check') {
      const r = await row(tenant, domain)
      if (!r) return json({ error: 'No such domain for this hospital.' }, 404)
      if (r.method === 'cloudflare') {
        if (!cfg) return json({ error: 'Cloudflare is not configured on the server.' }, 400)
        await refresh(cfg, tenant, r)
      }
      return json({ ...meta, domains: await list(tenant) })
    }

    if (!isAdmin) return json({ error: 'Domains are managed by the platform team.' }, 403)

    if (action === 'add') {
      const problem = domainProblem(domain, PLATFORM)
      if (problem) return json({ error: problem }, 400)
      const taken = (await admin.from('tenant_domains').select('tenant_id').eq('domain', domain).maybeSingle()).data as any
      if (taken) return json({ error: taken.tenant_id === tenant ? 'This domain is already added.' : 'This domain belongs to another hospital.' }, 409)
      const ownZone = isPlatformSubdomain(domain, PLATFORM)
      const method = ownZone || body?.method === 'manual' || !cfg ? 'manual' : 'cloudflare'
      const hasPrimary = (await list(tenant)).some((d: any) => d.is_primary)
      const base = { domain, tenant_id: tenant, method, is_primary: !hasPrimary, checked_at: new Date().toISOString() }
      if (method === 'manual') {
        await must(admin.from('tenant_domains').insert({ ...base, status: ownZone ? 'active' : 'manual', ssl_status: ownZone ? 'active' : null,
          verified_at: ownZone ? new Date().toISOString() : null, dns_target: ownZone ? null : (cfg?.target ?? PLATFORM) }))
      } else {
        let h: any
        try { h = await createHostname(cfg!, domain) }
        catch (e: any) {
          // already registered at Cloudflare (e.g. added before and removed only here) → adopt it
          h = e?.codes?.includes(1406) ? await findHostname(cfg!, domain) : null
          if (!h) throw e
        }
        const s = summarise(h)
        await must(admin.from('tenant_domains').insert({ ...base, cf_hostname_id: h.id, status: s.status, ssl_status: s.ssl_status,
          verification: s.verification, last_error: s.last_error, dns_target: cfg!.target, verified_at: s.active ? new Date().toISOString() : null }))
      }
      return json({ ...meta, domains: await list(tenant) })
    }

    if (action === 'remove') {
      const r = await row(tenant, domain)
      if (!r) return json({ error: 'No such domain for this hospital.' }, 404)
      if (r.method === 'cloudflare' && r.cf_hostname_id && cfg) {
        try { await deleteHostname(cfg, r.cf_hostname_id) } catch (e: any) { if (e?.status !== 404) throw e }
      }
      await must(admin.from('tenant_domains').delete().eq('tenant_id', tenant).eq('domain', domain))
      // keep one primary address if any are left
      const rest = await list(tenant)
      if (rest.length && !rest.some((d: any) => d.is_primary)) await must(admin.from('tenant_domains').update({ is_primary: true }).eq('tenant_id', tenant).eq('domain', rest[0].domain))
      return json({ ...meta, domains: await list(tenant) })
    }

    if (action === 'primary') {
      const r = await row(tenant, domain)
      if (!r) return json({ error: 'No such domain for this hospital.' }, 404)
      await must(admin.from('tenant_domains').update({ is_primary: false }).eq('tenant_id', tenant).eq('is_primary', true))
      await must(admin.from('tenant_domains').update({ is_primary: true }).eq('tenant_id', tenant).eq('domain', domain))
      return json({ ...meta, domains: await list(tenant) })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502)
  }
})
