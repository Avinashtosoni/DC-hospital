// Supabase Edge Function: delivers SMS / WhatsApp / email for DC Hospital.
//
//   supabase functions deploy notify
//
// Requests (JSON body):
//   { "flush": true }                              deliver the queue — service-role key (pg_cron) or a signed-in staff member
//   { "flush": true, "ids": ["…"] }                deliver just these fresh messages (by outbox id or related record id);
//                                                  allowed for anyone, e.g. the OTP a website visitor just requested
//   { "test": { "channel": "sms", "to": "98…" } }  send a test message (hospital owner only)
//   { "ping": true }                               health check
//
// Settings come from public.app_settings (Settings → Notifications) and credentials from public.app_secrets,
// read with the service-role key that Supabase injects automatically. Nothing secret is ever returned.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'
import { deliver, isPermanent, openwaStatus, retryDelayMs, type Channel, type Ctx, type Msg } from '../_shared/providers.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, { auth: { persistSession: false } })

async function loadCtx(): Promise<Ctx> {
  const [{ data: s }, { data: sec }, { data: site }] = await Promise.all([
    admin.from('app_settings').select('data').eq('key', 'app').maybeSingle(),
    admin.from('app_secrets').select('key, value'),
    admin.from('site_content').select('data').eq('key', 'settings').maybeSingle(),
  ])
  return {
    n: (s?.data as any)?.notifications ?? {},
    secrets: Object.fromEntries((sec ?? []).map((r: any) => [r.key, r.value])),
    hospital: (site?.data as any)?.name || 'DC Hospital',
  }
}

/** 'service' for the service-role key, otherwise the caller's role (or null for anonymous / invalid). */
async function callerRole(req: Request): Promise<string | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  if (jwt === SERVICE_KEY) return 'service'
  const { data: { user } } = await admin.auth.getUser(jwt)
  if (!user) return null
  const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  return prof?.role ?? null
}

// ------------------------------------------------------------------ handler
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }

  if (body.ping) return json({ ok: true, message: 'notify function is deployed and reachable' })

  if (body.test) {
    // owner only
    if (await callerRole(req) !== 'owner') return json({ ok: false, message: 'Only the hospital owner can send test messages' }, 403)
    const channel = body.test.channel as Channel
    const to = String(body.test.to ?? '').trim()
    if (!['sms', 'whatsapp', 'email'].includes(channel) || !to) return json({ ok: false, message: 'channel and to are required' }, 400)
    const c = await loadCtx()
    const m: Msg = { event: 'test', channel, recipient: channel === 'email' ? to : to.replace(/\D/g, '').slice(-10), subject: `Test email from ${c.hospital}`,
      body: `This is a test message from ${c.hospital}. If you received it, ${channel.toUpperCase()} notifications are working.`, vars: { hospital: c.hospital } }
    // OpenWA: check the WhatsApp session first so a disconnected phone gives a clear answer
    let st: Awaited<ReturnType<typeof openwaStatus>> | null = null
    if (channel === 'whatsapp' && c.n.whatsapp?.provider === 'openwa') {
      st = await openwaStatus(c)
      if (!st.ok) return json({ ok: false, message: st.error })
    }
    const r = await deliver(m, c)
    if (r.ok && st?.phone) r.ref = `${r.ref} · from ${st.phone}`
    await admin.from('notification_outbox').insert({ event: 'test', channel, recipient: m.recipient, subject: m.subject, body: m.body, status: r.ok ? 'sent' : 'failed', attempts: 1, error: r.error ?? null, provider_ref: r.ref ?? null, sent_at: r.ok ? new Date().toISOString() : null })
    return json({ ok: r.ok, message: r.ok ? `Sent via ${c.n[channel]?.provider}${r.ref ? ` · ${r.ref}` : ''}` : r.error, provider_ref: r.ref ?? null })
  }

  if (body.flush) {
    const ids = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 10) : []
    let claim
    if (ids.length) claim = await admin.rpc('claim_notifications_for', { p_ids: ids })
    else {
      // the whole queue: pg_cron (service-role key) or hospital staff only
      const role = await callerRole(req)
      if (!role || role === 'patient') return json({ error: 'Not allowed — pass the ids of the messages to deliver' }, 403)
      claim = await admin.rpc('claim_notifications', { p_limit: 25 })
    }
    const { data: rows, error } = claim
    if (error) return json({ error: error.message }, 500)
    if (!rows?.length) return json({ processed: 0, sent: 0, failed: 0 })
    const c = await loadCtx()
    let sent = 0, failed = 0
    for (const row of rows as any[]) {
      const r = await deliver({ id: row.id, event: row.event, channel: row.channel, recipient: row.recipient, subject: row.subject, body: row.body, vars: row.vars ?? {} }, c)
      r.ok ? sent++ : failed++
      const giveUp = !r.ok && (row.attempts >= 3 || isPermanent(r.error))
      await admin.from('notification_outbox').update({
        status: r.ok ? 'sent' : giveUp ? 'failed' : 'pending',
        error: r.error ?? null, provider_ref: r.ref ?? null, sent_at: r.ok ? new Date().toISOString() : null,
        // retry later with backoff (2, 4, 8 min after this attempt — not after the message was created)
        ...(!r.ok && !giveUp ? { next_attempt_at: new Date(Date.now() + retryDelayMs(row.attempts)).toISOString() } : {}),
        // never keep one-time codes around
        ...(row.event === 'otp' && (r.ok || giveUp) ? { body: '[code redacted]', vars: {} } : {}),
      }).eq('id', row.id)
    }
    return json({ processed: rows.length, sent, failed })
  }

  return json({ error: 'Unknown request' }, 400)
})
