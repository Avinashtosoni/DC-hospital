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
//   { "check": "razorpay" | "sms" | "whatsapp" | "email" | "push" }   check one account now (Platform settings → Integrations) — admin
//   { "sources": ["PLATFORM_…"] }                  for each key: saved in the panel / set as an Edge secret (never the value) — admin
//   { "deliver_otp": "<login_otps id>" }            send the caller's own sign-in code now (request_login_otp queued it) — team member
//
// With "Sign-in OTP for the team" on (Platform settings → Security), a team member who has not entered this session's code
// can only ask for deliver_otp; everything else answers 403 until login_otp_status() says passed.
//
// Shared-account keys come from the control panel (platform_env(): settings + Vault) with the PLATFORM_* Edge secrets as
// fallback. Nothing secret is ever returned. See ../_shared/ops.ts and scripts/sql/cp_notify.sql.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'
import { deliver, isPermanent, retryDelayMs, type Channel, type Msg } from '../_shared/providers.ts'
import { checkProviders, checkRazorpay, clearPlatformEnv, keySources, loadPlatformEnv, panelLink, platformSendCtx, runChecks } from '../_shared/ops.ts'
import { corsHeaders } from '../_shared/tenant.ts'

const cors = corsHeaders()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

type Who = { kind: 'service' } | { kind: 'team'; id: string; role: string; otpPassed: boolean } | null
async function who(req: Request): Promise<Who> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  if (jwt === SERVICE_KEY) return { kind: 'service' }
  const { data: { user } } = await admin.auth.getUser(jwt)
  if (!user) return null
  const { data } = await admin.from('provider_users').select('role, active').eq('user_id', user.id).maybeSingle()
  if (!data?.active) return null
  return { kind: 'team', id: user.id, role: data.role, otpPassed: await otpPassed(jwt) }
}

/** has this session (the caller's JWT) passed the team sign-in OTP? Older databases without the function: yes. */
async function otpPassed(jwt: string): Promise<boolean> {
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!anon) return true
  const asUser = createClient(SUPABASE_URL, anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } })
  const { data, error } = await asUser.rpc('login_otp_status')
  if (error) return /login_otp_status|PGRST202|42883/.test(`${error.message} ${(error as any).code ?? ""}`)   // missing function = older database
  return (data as any)?.passed !== false
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

const EVENT: Record<string, string> = { alert: 'platform_alert', broadcast: 'platform_broadcast', test: 'test', otp: 'platform_otp' }

async function flush() {
  const { data: rows, error } = await admin.rpc('claim_platform_outbox', { p_limit: 25 })
  if (error) return { error: error.message }
  return deliverRows((rows ?? []) as any[])
}

/** deliver claimed ("sending") platform_outbox rows and record the outcome (retry later / give up) */
async function deliverRows(rows: any[]) {
  if (!rows.length) return { processed: 0, sent: 0, failed: 0, errors: [] as string[] }
  const { c, siteUrl } = await ctx()
  let sent = 0, failed = 0
  const errors: string[] = []
  for (const row of rows) {
    const link = row.kind === 'alert' ? panelLink(siteUrl, row.vars?.link) : String(row.vars?.link ?? '')
    const body = row.kind === 'alert' && link && row.channel !== 'push' ? `${row.body}\n\nOpen: ${link}` : row.body
    const m: Msg = { id: row.id, event: EVENT[row.kind] ?? row.kind, channel: row.channel as Channel, recipient: row.recipient, subject: row.subject, body,
      vars: { ...(row.vars ?? {}), link, body: String(row.vars?.body ?? row.body ?? '') } }
    const r = String(c.n[row.channel]?.provider ?? '').endsWith('-missing')
      ? { ok: false, error: `The shared ${row.channel} account is not configured` }
      : row.channel === 'push' && !c.n.push?.enabled ? { ok: false, error: 'Firebase service-account JSON is not configured' } : await deliver(m, c)
    r.ok ? sent++ : failed++
    if (!r.ok && r.error) errors.push(r.error)
    const giveUp = !r.ok && (row.attempts >= 3 || isPermanent(r.error))
    await admin.from('platform_outbox').update({
      status: r.ok ? 'sent' : giveUp ? 'failed' : 'pending', error: r.error ?? null, provider_ref: (r as any).ref ?? null,
      sent_at: r.ok ? new Date().toISOString() : null,
      ...(!r.ok && !giveUp ? { next_attempt_at: new Date(Date.now() + retryDelayMs(row.attempts)).toISOString() } : {}),
    }).eq('id', row.id)
  }
  return { processed: rows.length, sent, failed, errors }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }
  if (body.ping) return json({ ok: true, message: 'ops function is deployed and reachable' })

  const w = await who(req)

  // a team member's own sign-in code: deliver it now rather than at the next scheduled flush
  if (body.deliver_otp) {
    if (w?.kind !== 'team') return json({ ok: false, message: 'Please sign in again' }, 403)
    const { data: rows, error } = await admin.from('platform_outbox')
      .update({ status: 'sending', attempts: 1, next_attempt_at: new Date().toISOString() })
      .eq('kind', 'otp').eq('ref_id', String(body.deliver_otp)).eq('user_id', w.id).eq('status', 'pending').select('*')
    if (error) return json({ ok: false, message: error.message }, 500)
    if (!rows?.length) return json({ ok: true, message: 'Already on its way' })
    const r = await deliverRows(rows as any[])
    return json({ ok: r.sent > 0, message: r.sent > 0 ? 'Code sent' : r.errors[0] ?? 'Could not send the code' })
  }
  if (w?.kind === 'team' && !w.otpPassed) return json({ ok: false, error: 'Enter your sign-in code first', message: 'Enter your sign-in code first' }, 403)

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

  // Platform settings → Integrations: check one account now (stored like a scheduled check), and where keys come from
  if (body.check) {
    if (w?.kind !== 'team' || w.role !== 'admin') return json({ error: 'Only admins can check integrations' }, 403)
    const id = String(body.check)
    if (!['razorpay', 'sms', 'whatsapp', 'email', 'push'].includes(id)) return json({ error: 'Unknown integration' }, 400)
    clearPlatformEnv()
    const { env } = await ctx()
    const o = { supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY, env }
    const check = id === 'razorpay' ? await checkRazorpay(o) : (await checkProviders(o)).find((c) => c.service === `provider:${id}`)
    if (!check) return json({ error: 'No result' }, 500)
    const { error } = await admin.rpc('record_health', { p_results: [check] })
    if (error) return json({ error: error.message }, 500)
    return json({ ok: check.status === 'ok', check })
  }
  if (body.sources) {
    if (w?.kind !== 'team' || w.role !== 'admin') return json({ error: 'Only admins can see this' }, 403)
    let saved: Record<string, unknown> = {}
    try { const { data } = await admin.rpc('platform_env'); if (data && typeof data === 'object') saved = data } catch { /* older database */ }
    return json({ sources: keySources(Array.isArray(body.sources) ? body.sources.map(String) : [], saved, (k) => Deno.env.get(k)) })
  }

  return json({ error: 'Unknown request' }, 400)
})
