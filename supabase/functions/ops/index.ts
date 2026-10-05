// Supabase Edge Function: the control panel's messaging, alerts and health checks.
//
//   supabase functions deploy ops
//
// Requests (JSON body):
//   { "ping": true }                                   is it deployed?
//   { "flush": true }                                  deliver public.platform_outbox (team alerts, broadcasts) — service role (pg_cron)
//   { "health": true }                                 run the live checks and store them (record_health) — service role, or a
//                                                      control-panel admin / support member ("Check now")
//   { "test": { "channel": "email", "to": "…" } }      send a test on the shared account — control-panel admin; push → their own browsers
//
// Shared-account keys come from the control panel (platform_env(): settings + Vault) with the PLATFORM_* Edge secrets as
// fallback. Nothing secret is ever returned. See ../_shared/ops.ts and scripts/sql/cp_notify.sql.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'
import { deliver, isPermanent, retryDelayMs, type Channel, type Msg } from '../_shared/providers.ts'
import { loadPlatformEnv, panelLink, platformSendCtx, runChecks } from '../_shared/ops.ts'
import { corsHeaders } from '../_shared/tenant.ts'

const cors = corsHeaders()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

type Who = { kind: 'service' } | { kind: 'team'; id: string; role: string } | null
async function who(req: Request): Promise<Who> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  if (jwt === SERVICE_KEY) return { kind: 'service' }
  const { data: { user } } = await admin.auth.getUser(jwt)
  if (!user) return null
  const { data } = await admin.from('provider_users').select('role, active').eq('user_id', user.id).maybeSingle()
  return data?.active ? { kind: 'team', id: user.id, role: data.role } : null
}

async function settings() {
  const { data } = await admin.from('platform_settings').select('key, data').in('key', ['ops', 'messaging'])
  const by = Object.fromEntries(((data ?? []) as any[]).map((r) => [r.key, r.data ?? {}]))
  return { siteUrl: String(by.ops?.health?.siteUrl ?? ''), templates: (by.messaging?.templates ?? {}) as Record<string, any>,
    sslDays: Number(by.ops?.thresholds?.sslDays ?? 14) || 14 }
}

const devices = {
  tokens: async (userId: string) => {
    const { data } = await admin.from('cp_push_tokens').select('token').eq('user_id', userId).order('last_seen_at', { ascending: false }).limit(10)
    return ((data ?? []) as any[]).map((r) => r.token)
  },
  forget: async (tokens: string[]) => { await admin.from('cp_push_tokens').delete().in('token', tokens) },
}

async function ctx() {
  const [env, s] = await Promise.all([loadPlatformEnv(admin, (k) => Deno.env.get(k)), settings()])
  return { env, siteUrl: s.siteUrl, c: platformSendCtx(env, { templates: s.templates, siteUrl: s.siteUrl, devices }) }
}

const EVENT: Record<string, string> = { alert: 'platform_alert', broadcast: 'platform_broadcast', test: 'test' }

async function flush() {
  const { data: rows, error } = await admin.rpc('claim_platform_outbox', { p_limit: 25 })
  if (error) return { error: error.message }
  if (!rows?.length) return { processed: 0, sent: 0, failed: 0 }
  const { c, siteUrl } = await ctx()
  let sent = 0, failed = 0
  for (const row of rows as any[]) {
    const link = row.kind === 'alert' ? panelLink(siteUrl, row.vars?.link) : String(row.vars?.link ?? '')
    const body = row.kind === 'alert' && link && row.channel !== 'push' ? `${row.body}\n\nOpen: ${link}` : row.body
    const m: Msg = { id: row.id, event: EVENT[row.kind] ?? row.kind, channel: row.channel as Channel, recipient: row.recipient, subject: row.subject, body,
      vars: { ...(row.vars ?? {}), link, body: String(row.vars?.body ?? row.body ?? '') } }
    const r = String(c.n[row.channel]?.provider ?? '').endsWith('-missing')
      ? { ok: false, error: `The shared ${row.channel} account is not configured` }
      : row.channel === 'push' && !c.n.push?.enabled ? { ok: false, error: 'Firebase service-account JSON is not configured' } : await deliver(m, c)
    r.ok ? sent++ : failed++
    const giveUp = !r.ok && (row.attempts >= 3 || isPermanent(r.error))
    await admin.from('platform_outbox').update({
      status: r.ok ? 'sent' : giveUp ? 'failed' : 'pending', error: r.error ?? null, provider_ref: (r as any).ref ?? null,
      sent_at: r.ok ? new Date().toISOString() : null,
      ...(!r.ok && !giveUp ? { next_attempt_at: new Date(Date.now() + retryDelayMs(row.attempts)).toISOString() } : {}),
    }).eq('id', row.id)
  }
  return { processed: rows.length, sent, failed }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }
  if (body.ping) return json({ ok: true, message: 'ops function is deployed and reachable' })

  const w = await who(req)
  if (body.flush) {
    if (w?.kind !== 'service') return json({ error: 'Not allowed' }, 403)
    return json(await flush())
  }

  if (body.health) {
    if (!(w?.kind === 'service' || (w?.kind === 'team' && (w.role === 'admin' || w.role === 'support')))) return json({ error: 'Only admins and support can run the checks' }, 403)
    const [{ env, siteUrl }, s, doms] = await Promise.all([ctx(), settings(),
      admin.from('tenant_domains').select('domain, method, cf_hostname_id').not('verified_at', 'is', null).order('created_at').limit(40)])
    const token = Deno.env.get('CF_API_TOKEN'), zone = Deno.env.get('CF_ZONE_ID')
    const checks = await runChecks({ supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY, anonKey: Deno.env.get('SUPABASE_ANON_KEY'), siteUrl, env, self: 'ops',
      domains: (doms.data ?? []) as any[], cf: token && zone ? { token, zone } : null, sslWarnDays: s.sslDays })
    const { data, error } = await admin.rpc('record_health', { p_results: checks })
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true, results: data })
  }

  if (body.test) {
    if (w?.kind !== 'team' || w.role !== 'admin') return json({ ok: false, message: 'Only admins can send test messages' }, 403)
    const channel = String(body.test.channel ?? '') as Channel
    if (!['sms', 'whatsapp', 'email', 'push'].includes(channel)) return json({ ok: false, message: 'Choose a channel' }, 400)
    const to = channel === 'push' ? w.id : String(body.test.to ?? '').trim()
    if (!to) return json({ ok: false, message: channel === 'email' ? 'Enter an e-mail address' : 'Enter a mobile number' }, 400)
    if (channel === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ ok: false, message: 'Enter a valid e-mail address' }, 400)
    const { c } = await ctx()
    const recipient = channel === 'email' || channel === 'push' ? to : to.replace(/\D/g, '').slice(-10)
    const m: Msg = { event: 'test', channel, recipient, subject: `Test from ${c.hospital}`,
      body: `This is a test message from ${c.hospital}. If you received it, the shared ${channel === 'sms' ? 'SMS' : channel === 'whatsapp' ? 'WhatsApp' : channel === 'push' ? 'browser push' : 'e-mail'} account works.`,
      vars: { hospital: c.hospital, name: 'Team' } }
    const r = String(c.n[channel]?.provider ?? '').endsWith('-missing') ? { ok: false, error: `The shared ${channel} account is not configured — choose a provider and save its key first` }
      : channel === 'push' && !c.n.push?.enabled ? { ok: false, error: 'Add the Firebase service-account JSON first' } : await deliver(m, c)
    await admin.from('platform_outbox').insert({ kind: 'test', channel, recipient: channel === 'push' ? w.id : recipient, user_id: w.id, subject: m.subject, body: m.body,
      status: r.ok ? 'sent' : 'failed', attempts: 1, error: r.error ?? null, provider_ref: (r as any).ref ?? null, sent_at: r.ok ? new Date().toISOString() : null })
    const provider = channel === 'push' ? 'Firebase' : c.n[channel]?.provider
    return json({ ok: r.ok, message: r.ok ? `Sent via ${provider}${(r as any).ref ? ` · ${(r as any).ref}` : ''}` : r.error })
  }

  return json({ error: 'Unknown request' }, 400)
})
