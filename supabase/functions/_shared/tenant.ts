// Which hospital an Edge Function call is for (multi-hospital "Hospital Comrade" installs; single installs only
// ever see the primary hospital). Shared by notify and whatsapp-bot; the pure helpers are covered by
// tests/notify/tenant.test.ts.
//
//   • signed-in callers (app):   my_context() run *as the caller* with the x-tenant-id / x-provider-mode headers the
//                                app sends — the same rules as the database (a hospital user is always in their own
//                                hospital; a provider only in a hospital assigned to them)
//   • queue rows (notify):       notification_outbox.tenant_id
//   • webhooks (whatsapp-bot):   ?hospital=<slug> on the webhook address (none = the primary hospital)
//
// The service-role client skips RLS, so every table read in the functions filters on tenant_id explicitly, and
// RPCs get the hospital through the x-tenant-id header (current_tenant() trusts it only without a signed-in user).
// deno-lint-ignore-file no-explicit-any

export const PRIMARY_TENANT = 'a0000000-0000-4000-8000-000000000001'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/

/** CORS for browser calls — the app sends its hospital / provider-mode headers with every request */
export const corsHeaders = (methods = 'POST, OPTIONS') => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tenant-id, x-provider-mode',
  'Access-Control-Allow-Methods': methods,
})

export interface TenantRow { id: string; slug: string; name: string; status: string; is_primary: boolean }

/** the hospital a webhook address points at: `?hospital=<slug>` (or a hospital id); nothing = the primary hospital */
export function webhookTenantRef(url: URL): { slug: string } | { id: string } | { primary: true } | { invalid: true } {
  const v = (url.searchParams.get('hospital') ?? url.searchParams.get('tenant') ?? '').trim().toLowerCase()
  if (!v) return { primary: true }
  if (UUID.test(v)) return { id: v }
  if (SLUG.test(v)) return { slug: v }
  return { invalid: true }
}

/** the webhook address to give a hospital's WhatsApp provider */
export function webhookUrl(supabaseUrl: string, tenant: { slug: string; is_primary?: boolean } | null) {
  const base = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/whatsapp-bot`
  return tenant && !tenant.is_primary ? `${base}?hospital=${encodeURIComponent(tenant.slug)}` : base
}

/** queue rows grouped by hospital (rows from before multi-hospital have no tenant_id → primary) */
export function groupByTenant<T extends { tenant_id?: string | null }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const t = r.tenant_id || PRIMARY_TENANT
    const list = out.get(t)
    if (list) list.push(r)
    else out.set(t, [r])
  }
  return out
}

/** the hospital/provider headers of an incoming request, to forward when acting as the caller */
export function forwardedTenantHeaders(req: Request): Record<string, string> {
  const h: Record<string, string> = {}
  const t = req.headers.get('x-tenant-id')
  const m = req.headers.get('x-provider-mode')
  if (t && UUID.test(t)) h['x-tenant-id'] = t
  if (m && /^(admin|support|finance)$/.test(m)) h['x-provider-mode'] = m
  return h
}

export interface Caller {
  kind: 'anon' | 'service' | 'user'
  id?: string
  /** the app role in this hospital (owner, receptionist, …; providers act as owner / accountant) */
  role?: string | null
  tenant?: string | null
  provider?: string | null
}

/**
 * Who is calling and for which hospital. `userClient` builds a Supabase client that runs as the caller
 * (anon key + their token + forwarded headers) so my_context() applies the database's own rules.
 */
export async function resolveCaller(req: Request, opts: {
  serviceKey: string
  admin: any
  userClient: (jwt: string, headers: Record<string, string>) => any
}): Promise<Caller> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return { kind: 'anon' }
  if (jwt === opts.serviceKey) return { kind: 'service' }
  const { data: { user } } = await opts.admin.auth.getUser(jwt)
  if (!user) return { kind: 'anon' }
  const { data: ctx, error } = await opts.userClient(jwt, forwardedTenantHeaders(req)).rpc('my_context')
  if (error || !ctx) return { kind: 'user', id: user.id, role: null, tenant: null }
  return { kind: 'user', id: user.id, role: ctx.role ?? null, tenant: ctx.tenant?.id ?? null, provider: ctx.provider_role ?? null }
}
