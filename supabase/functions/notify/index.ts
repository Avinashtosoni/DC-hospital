// Supabase Edge Function: delivers SMS / WhatsApp / email / push (Firebase Cloud Messaging) for DC Hospital.
//
//   supabase functions deploy notify
//
// Requests (JSON body):
//   { "flush": true }                              deliver the queue — service-role key (pg_cron) or a signed-in staff member
//   { "flush": true, "ids": ["…"] }                deliver just these fresh messages (by outbox id or related record id);
//                                                  allowed for anyone, e.g. the OTP a website visitor just requested
//   { "test": { "channel": "sms", "to": "98…" } }  send a test message (hospital owner only; push → the owner's own devices)
//   Custom messages (Settings → Notifications → Custom messages) arrive as event "tpl:<id>"; their WhatsApp template /
//   DLT ID are read from public.notification_templates.
//   { "ping": true }                               health check
//
// Settings come from public.app_settings (Settings → Notifications) and credentials from public.app_secrets,
// read with the service-role key that Supabase injects automatically. Nothing secret is ever returned.
//
// Multi-hospital: every message goes out with the settings, credentials, templates and push devices of *its own*
// hospital (notification_outbox.tenant_id). One scheduler flushes every hospital's queue; a staff member's
// "deliver now" flushes only their hospital's; a test uses the hospital the caller is working in. See ../_shared/tenant.ts.
//
// Hospital Comrade messaging (phase 3): a channel set to source "platform" goes out through the platform's shared
// account (PLATFORM_* secrets, template IDs from public.platform_settings) with the hospital's own name / sender ID —
// see ../_shared/platform.ts. Every outcome is counted per hospital in public.message_usage, and the monthly allowance
// in tenants.messaging.limits is enforced (OTPs always go out). { "ping": true } also reports which shared accounts exist.
// The shared accounts' keys may be saved in the control panel (Platform settings → Integrations, Vault-encrypted);
// those win over the PLATFORM_* Edge secrets of the same name.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'
import { isPermanent, openwaStatus, retryDelayMs, type Channel, type Ctx, type Msg } from '../_shared/providers.ts'
import { deliverRouted, platformCtx, platformDetails, platformStatus, sourceOf, usageMonth, walletOf, type Meter, type Source } from '../_shared/platform.ts'
import { corsHeaders, groupByTenant, resolveCaller, type Caller } from '../_shared/tenant.ts'
import { loadPlatformEnv } from '../_shared/ops.ts'

const cors = corsHeaders()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
/** runs as the caller (their token + hospital headers), so the database's own tenant rules apply */
const userClient = (jwt: string, headers: Record<string, string>) => createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
  auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}`, ...headers } },
})
const caller = (req: Request): Promise<Caller> => resolveCaller(req, { serviceKey: SERVICE_KEY, admin, userClient })

/** everything needed to deliver one hospital's messages (the service role skips RLS → filter on tenant_id) */
interface Setup { own: Ctx; platform: Ctx; meter: Meter }
/** shared-account settings: saved in the control panel (platform_env, Vault) first, then the PLATFORM_* Edge secrets */
const platformEnv = () => loadPlatformEnv(admin, (k) => Deno.env.get(k))
async function loadCtx(tenant: string, events: string[] = []): Promise<Setup> {
  const env = await platformEnv()
  const tplIds = [...new Set(events.filter((e) => e.startsWith('tpl:')).map((e) => e.slice(4)))]
  const [{ data: s }, { data: sec }, { data: site }, { data: tpls }, { data: t }, { data: plat }, { data: usage }] = await Promise.all([
    admin.from('app_settings').select('data').eq('tenant_id', tenant).eq('key', 'app').maybeSingle(),
    admin.from('app_secrets').select('key, value').eq('tenant_id', tenant),
    admin.from('site_content').select('data').eq('tenant_id', tenant).eq('key', 'settings').maybeSingle(),
    tplIds.length ? admin.from('notification_templates').select('id, wa_template, wa_params, sms_template_id').eq('tenant_id', tenant).in('id', tplIds) : Promise.resolve({ data: [] as any[] }),
    admin.from('tenants').select('name, messaging, plan, billing, wallet_paise, is_primary').eq('id', tenant).maybeSingle(),
    admin.from('platform_settings').select('key, data').in('key', ['messaging', 'billing']),
    admin.from('message_usage').select('channel, sent').eq('tenant_id', tenant).eq('month', usageMonth()).eq('source', 'platform'),
  ])
  const n = (s?.data as any)?.notifications ?? {}
  // custom messages look like built-in events to the providers (approved WhatsApp template, DLT ID)
  n.templates = { ...(n.templates ?? {}) }
  for (const t of (tpls ?? []) as any[]) n.templates[`tpl:${t.id}`] = { waTemplate: t.wa_template ?? '', waParams: t.wa_params ?? '', smsTemplateId: t.sms_template_id ?? '' }
  const siteUrl = String((site?.data as any)?.siteUrl ?? '')
  const own: Ctx = {
    n,
    secrets: Object.fromEntries((sec ?? []).map((r: any) => [r.key, r.value])),
    hospital: (site?.data as any)?.name || t?.name || 'DC Hospital',
    devices: {
      siteUrl: /^https:\/\//.test(siteUrl) ? siteUrl : undefined,
      icon: /^https:\/\//.test(siteUrl) ? `${siteUrl.replace(/\/$/, '')}/favicon.svg` : undefined,
      tokens: async (profileId) => {
        const { data } = await admin.from('push_tokens').select('token').eq('tenant_id', tenant).eq('profile_id', profileId).order('last_seen_at', { ascending: false }).limit(10)
        return (data ?? []).map((r: any) => r.token)
      },
      forget: async (tokens) => { await admin.from('push_tokens').delete().eq('tenant_id', tenant).in('token', tokens) },
    },
  }
  const tm = ((t as any)?.messaging ?? {}) as Meter['tenant']
  const pset = Object.fromEntries(((plat ?? []) as any[]).map((r) => [r.key, r.data])) as { messaging?: any; billing?: any }
  return {
    own,
    platform: platformCtx(own, env, { platform: pset.messaging ?? null, tenant: tm, replyTo: String((site?.data as any)?.email ?? '') }),
    meter: { tenant: tm, wallet: walletOf(t, pset.billing), used: Object.fromEntries(((usage ?? []) as any[]).map((r) => [r.channel, Number(r.sent) || 0])) },
  }
}

/** add one batch's outcomes to public.message_usage (best effort — never blocks delivery) */
async function recordUsage(tenant: string, counts: Map<string, { sent: number; failed: number }>) {
  for (const [key, v] of counts) {
    const [channel, source] = key.split(':')
    await admin.rpc('record_message_usage', { p_tenant: tenant, p_channel: channel, p_source: source, p_sent: v.sent, p_failed: v.failed }).then(() => {}, () => {})
  }
}
const tally = (counts: Map<string, { sent: number; failed: number }>, channel: string, source: Source, ok: boolean) => {
  const k = `${channel}:${source}`; const v = counts.get(k) ?? { sent: 0, failed: 0 }
  ok ? v.sent++ : v.failed++; counts.set(k, v)
}

/** deliver claimed rows, each with its own hospital's settings and credentials */
async function deliverRows(rows: any[]) {
  let sent = 0, failed = 0
  for (const [tenant, list] of groupByTenant(rows)) {
    let c: Setup
    try { c = await loadCtx(tenant, list.map((r) => r.event)) }
    catch (e) {   // settings unreadable → try again later (counts as an attempt)
      for (const row of list) await finish(row, { ok: false, error: `Could not load the hospital's settings: ${(e as Error).message}` })
      failed += list.length
      continue
    }
    const counts = new Map<string, { sent: number; failed: number }>()
    for (const row of list) {
      const r = await deliverRouted({ id: row.id, event: row.event, channel: row.channel, recipient: row.recipient, subject: row.subject, body: row.body, vars: row.vars ?? {} }, c.own, c.platform, c.meter)
      r.ok ? sent++ : failed++
      const final = await finish(row, r)
      if (final) tally(counts, row.channel, r.source, r.ok)
    }
    await recordUsage(tenant, counts)
  }
  return { processed: rows.length, sent, failed }
}

/** returns true when the message reached a final state (sent, or failed for good) — those are the ones metered */
async function finish(row: any, r: { ok: boolean; error?: string; ref?: string; source?: Source }) {
  const giveUp = !r.ok && (row.attempts >= 3 || isPermanent(r.error))
  await admin.from('notification_outbox').update({
    status: r.ok ? 'sent' : giveUp ? 'failed' : 'pending', source: r.source ?? null,
    error: r.error ?? null, provider_ref: r.ref ?? null, sent_at: r.ok ? new Date().toISOString() : null,
    // retry later with backoff (2, 4, 8 min after this attempt — not after the message was created)
    ...(!r.ok && !giveUp ? { next_attempt_at: new Date(Date.now() + retryDelayMs(row.attempts)).toISOString() } : {}),
    // never keep one-time codes around
    ...((row.event === 'otp' || row.event === 'password_otp') && (r.ok || giveUp) ? { body: '[code redacted]', vars: {} } : {}),
  }).eq('id', row.id)
  return r.ok || giveUp
}

// ------------------------------------------------------------------ handler
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }

  if (body.ping) {
    const env = await platformEnv()
    return json({ ok: true, message: 'notify function is deployed and reachable', platform: platformStatus(env), platform_details: platformDetails(env) })
  }

  if (body.test) {
    // owner only
    const who = await caller(req)
    if (who.role !== 'owner' || !who.tenant) return json({ ok: false, message: 'Only the hospital owner can send test messages' }, 403)
    const channel = body.test.channel as Channel
    const to = channel === 'push' ? who.id! : String(body.test.to ?? '').trim()
    if (!['sms', 'whatsapp', 'email', 'push'].includes(channel) || !to) return json({ ok: false, message: 'channel and to are required' }, 400)
    const setup = await loadCtx(who.tenant)
    const source = sourceOf(setup.own.n, channel)
    const c = source === 'platform' ? setup.platform : setup.own
    const m: Msg = { event: 'test', channel, recipient: channel === 'email' || channel === 'push' ? to : to.replace(/\D/g, '').slice(-10),
      subject: channel === 'push' ? `Test notification from ${c.hospital}` : `Test email from ${c.hospital}`,
      body: `This is a test message from ${c.hospital}. If you received it, ${channel.toUpperCase()} notifications are working.`, vars: { hospital: c.hospital } }
    // OpenWA: check the WhatsApp session first so a disconnected phone gives a clear answer
    let st: Awaited<ReturnType<typeof openwaStatus>> | null = null
    if (channel === 'whatsapp' && c.n.whatsapp?.provider === 'openwa') {
      st = await openwaStatus(c)
      if (!st.ok) return json({ ok: false, message: st.error })
    }
    const r = await deliverRouted(m, setup.own, setup.platform, setup.meter)
    if (r.ok && st?.phone) r.ref = `${r.ref} · from ${st.phone}`
    await admin.from('notification_outbox').insert({ tenant_id: who.tenant, event: 'test', channel, recipient: m.recipient, subject: m.subject, body: m.body, status: r.ok ? 'sent' : 'failed', attempts: 1, error: r.error ?? null, provider_ref: r.ref ?? null, sent_at: r.ok ? new Date().toISOString() : null, source })
    const counts = new Map<string, { sent: number; failed: number }>(); tally(counts, channel, source, r.ok); await recordUsage(who.tenant, counts)
    const via = source === 'platform' ? `Hospital Comrade (${c.n[channel]?.provider})` : (c.n[channel]?.provider ?? 'Firebase')
    return json({ ok: r.ok, message: r.ok ? `Sent via ${via}${r.ref ? ` · ${r.ref}` : ''}` : r.error, provider_ref: r.ref ?? null, source })
  }

  if (body.flush) {
    const ids = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 10) : []
    let claim
    if (ids.length) claim = await admin.rpc('claim_notifications_for', { p_ids: ids })
    else {
      // the whole queue: the scheduler (service-role key) → every hospital; hospital staff → their own hospital
      const who = await caller(req)
      if (who.kind === 'service') claim = await admin.rpc('claim_notifications', { p_limit: 25 })
      else if (who.kind === 'user' && who.tenant && who.role && who.role !== 'patient') claim = await admin.rpc('claim_notifications', { p_limit: 25, p_tenant: who.tenant })
      else return json({ error: 'Not allowed — pass the ids of the messages to deliver' }, 403)
    }
    const { data: rows, error } = claim
    if (error) return json({ error: error.message }, 500)
    if (!rows?.length) return json({ processed: 0, sent: 0, failed: 0 })
    return json(await deliverRows(rows as any[]))
  }

  return json({ error: 'Unknown request' }, 400)
})
