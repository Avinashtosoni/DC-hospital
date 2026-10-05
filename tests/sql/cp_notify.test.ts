/**
 * Control panel → messaging & alerts, broadcasts and live health (scripts/sql/cp_notify.sql): write-only shared-account
 * keys, team alerts with admin switches + personal choices, broadcasts to hospital staff, health history and alerts.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, type Db } from './harness'

let db: Db
const B = 'b0000000-0000-4000-8000-000000000002'
const B_OWNER = 'b0b00000-0000-4000-8000-000000000001'
const B_DOCTOR = 'b0b00000-0000-4000-8000-000000000002'
const P_ADMIN = 'e0e00000-0000-4000-8000-000000000001'
const P_SUPPORT = 'e0e00000-0000-4000-8000-000000000002'
const P_FINANCE = 'e0e00000-0000-4000-8000-000000000003'

const signUp = (id: string, email: string, meta: Record<string, unknown>) => db.as(null,
  `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'x', $3::jsonb)`, [id, email, JSON.stringify(meta)])
async function call<T = any>(who: string | null, fn: string, args: unknown[] = [], types: string[] = []): Promise<T> {
  const list = args.map((_, i) => `$${i + 1}${types[i] ? '::' + types[i] : ''}`).join(', ')
  const r = await db.one<{ r: T }>(who, `select public.${fn}(${list}) as r`, args.map((a) => (a !== null && typeof a === 'object' && !Array.isArray(a) ? JSON.stringify(a) : a)))
  return r.r
}
const fails = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re)
const freshSignIn = () => db.as(null, `select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ iat: Math.floor(Date.now() / 1000) })])
const outbox = (where = 'true') => db.as<any>(null, `select * from public.platform_outbox where ${where} order by created_at`)
const inbox = (user: string) => db.as<any>(null, `select a.event, a.title, i.read_at from public.platform_alert_inbox i join public.platform_alerts a on a.id = i.alert_id where i.user_id = $1 order by a.created_at`, [user])

beforeAll(async () => {
  db = await freshDb('master')
  await db.as(null, `insert into public.tenants (id, slug, name, code, plan, status) values ($1, 'city', 'City Hospital', 'CTY', 'clinic', 'active')`, [B])
  await signUp(B_OWNER, 'owner@cityhospital.in', { full_name: 'City Owner', tenant_id: B })
  await signUp(B_DOCTOR, 'doc@cityhospital.in', { full_name: 'City Doctor', tenant_id: B })
  await db.as(null, `update public.profiles set role = 'owner', phone = '98765 43210' where id = $1`, [B_OWNER])
  await db.as(null, `update public.profiles set role = 'doctor', phone = '9876500000' where id = $1`, [B_DOCTOR])
  for (const [id, email, role] of [[P_ADMIN, 'admin@hc.in', 'admin'], [P_SUPPORT, 'support@hc.in', 'support'], [P_FINANCE, 'finance@hc.in', 'finance']]) {
    await signUp(id, email, { full_name: `Provider ${role}` })
    await db.as(null, `select set_config('app.tenant_move', 'on', false)`)
    await db.as(null, `update public.profiles set tenant_id = null where id = $1`, [id])
    await db.as(null, `select set_config('app.tenant_move', '', false)`)
    await db.as(null, `delete from public.patients where profile_id = $1`, [id])
    await db.as(null, `insert into public.provider_users (user_id, role) values ($1, $2)`, [id, role])
  }
}, 240_000)

describe('shared accounts', () => {
  test('admins only; keys need a fresh sign-in, are never shown back and reach only the service role', async () => {
    await fails(call(P_SUPPORT, 'cp_messaging_setup'), /Hospital Comrade team/)
    await fails(call(B_OWNER, 'cp_messaging_setup'), /Hospital Comrade team/)
    await db.as(null, `select set_config('request.jwt.claims', '', false)`)
    await fails(call(P_ADMIN, 'cp_save_messaging_setup', [{}, { PLATFORM_RESEND_API_KEY: 're_123456789abcdef' }], ['jsonb', 'jsonb']), /REAUTH_REQUIRED/)
    // plain settings don't need the password
    let s = await call(P_ADMIN, 'cp_save_messaging_setup', [{ PLATFORM_EMAIL_PROVIDER: 'resend', PLATFORM_EMAIL_FROM: 'hello@hc.in' }, {}], ['jsonb', 'jsonb'])
    expect(s.settings).toEqual({ PLATFORM_EMAIL_PROVIDER: 'resend', PLATFORM_EMAIL_FROM: 'hello@hc.in' })
    await freshSignIn()
    s = await call(P_ADMIN, 'cp_save_messaging_setup', [{}, { PLATFORM_RESEND_API_KEY: 're_123456789abcdef' }], ['jsonb', 'jsonb'])
    expect(s.secrets).toEqual([expect.objectContaining({ key: 'PLATFORM_RESEND_API_KEY', hint: '••••cdef', updated_by_name: 'Provider admin' })])
    expect(JSON.stringify(s)).not.toContain('re_123456789')
    expect(s.vault).toBe(false)   // PGlite has no Vault → the locked table is used
    await fails(call(P_ADMIN, 'cp_save_messaging_setup', [{ PLATFORM_RESEND_API_KEY: 'x' }, {}], ['jsonb', 'jsonb']), /is an API key/)
    await fails(call(P_ADMIN, 'cp_save_messaging_setup', [{ OTHER_THING: 'x' }, {}], ['jsonb', 'jsonb']), /Unknown setting/)
    expect(await call('service', 'platform_env')).toMatchObject({ PLATFORM_EMAIL_PROVIDER: 'resend', PLATFORM_RESEND_API_KEY: 're_123456789abcdef' })
    await fails(call(P_ADMIN, 'platform_env'), /permission denied/)
    await fails(db.as(P_ADMIN, `select * from public.platform_secrets`), /permission denied/)
    expect((await db.as<any>(null, `select action, detail from public.provider_audit where action = 'messaging:setup' order by at`)).at(-1).detail.changed).toEqual(['PLATFORM_RESEND_API_KEY'])
    // '' removes
    s = await call(P_ADMIN, 'cp_save_messaging_setup', [{ PLATFORM_EMAIL_FROM: '' }, { PLATFORM_RESEND_API_KEY: '' }], ['jsonb', 'jsonb'])
    expect(s.secrets).toEqual([])
    expect(s.settings).toEqual({ PLATFORM_EMAIL_PROVIDER: 'resend' })
  })

  test('templates: cleaned and stored where the notify function reads them', async () => {
    const t = await call(P_ADMIN, 'cp_save_platform_templates', [{ otp: { waTemplate: ' otp_v2 ', waParams: 'code', smsTemplateId: '' }, empty: { waTemplate: '' } }], ['jsonb'])
    expect(t).toEqual({ otp: { waTemplate: 'otp_v2', waParams: 'code' } })
    expect((await db.one<any>(null, `select data from public.platform_settings where key = 'messaging'`)).data.templates).toEqual(t)
    await fails(call(P_SUPPORT, 'cp_save_platform_templates', [{}], ['jsonb']), /Hospital Comrade team/)
  })
})

describe('alerts', () => {
  test('a new lead reaches admins (bell + e-mail by default for warnings, bell for info); others by role', async () => {
    await db.as('anon', `select public.submit_platform_lead('Ravi Kumar', 'Sunrise Clinic', '9876543210', 'ravi@sunrise.in', 'Patna', 'clinic', null, null)`)
    expect(await inbox(P_ADMIN)).toEqual([expect.objectContaining({ event: 'lead_new', title: 'Call-back request: Sunrise Clinic', read_at: null })])
    expect(await inbox(P_SUPPORT)).toEqual([])
    expect(await outbox(`kind = 'alert'`)).toEqual([])   // info → bell only
    await db.as(null, `insert into public.platform_incidents (title, severity) values ('Leaked export', 'high')`)
    expect((await inbox(P_SUPPORT)).map((r: any) => r.event)).toEqual(['incident_new'])
    const mails = await outbox(`kind = 'alert' and channel = 'email'`)
    expect(mails.map((m: any) => m.recipient).sort()).toEqual(['admin@hc.in', 'support@hc.in'])
    expect(mails[0]).toMatchObject({ subject: '[Critical] Incident: Leaked export', status: 'pending' })
  })

  test('the bell: list, unread count, mark read; members see only their own', async () => {
    const a = await call(P_ADMIN, 'cp_alerts')
    expect(a.unread).toBe(2)
    expect(a.items.map((i: any) => i.event)).toEqual(['incident_new', 'lead_new'])
    expect(await call(P_ADMIN, 'cp_alerts_read', [[a.items[1].id]], ['uuid[]'])).toBe(1)
    expect((await call(P_SUPPORT, 'cp_alerts')).unread).toBe(1)
    expect(await call(P_ADMIN, 'cp_alerts_read')).toBe(0)
    await fails(call(B_OWNER, 'cp_alerts'), /Hospital Comrade team/)
  })

  test('admin switches channels and events; members choose within them; repeats are folded', async () => {
    await fails(call(P_SUPPORT, 'cp_save_alert_prefs', [{ events: { lead_new: ['bell'] } }], ['jsonb']).then(() => call(P_SUPPORT, 'cp_save_alert_prefs', [{ events: { nope: ['bell'] } }], ['jsonb'])), /Unknown alert/)
    await fails(call(P_ADMIN, 'cp_save_alert_prefs', [{ events: { lead_new: ['fax'] } }], ['jsonb']), /Unknown channel/)
    await fails(call(P_ADMIN, 'cp_save_alert_prefs', [{ whatsapp: '123' }], ['jsonb']), /10-digit/)
    const prefs = await call(P_ADMIN, 'cp_save_alert_prefs', [{ events: { lead_new: ['bell', 'whatsapp', 'push'] }, whatsapp: '+91 99999 88888' }], ['jsonb'])
    expect(prefs.whatsapp).toBe('9999988888')
    expect(prefs.events.find((e: any) => e.key === 'lead_new').mine).toEqual(['bell', 'whatsapp', 'push'])
    // support sees only its events
    expect((await call(P_SUPPORT, 'cp_alert_prefs')).events.map((e: any) => e.key)).not.toContain('lead_new')
    // WhatsApp is off platform-wide → nothing on WhatsApp yet
    await call(null, 'raise_platform_alert', ['lead_new', 'Test lead 1', 'x', null, null, 60, null, {}], ['text', 'text', 'text', 'text', 'text', 'int', 'text', 'jsonb'])
    expect(await outbox(`channel = 'whatsapp'`)).toEqual([])
    await fails(call(P_SUPPORT, 'cp_save_ops_settings', [{}], ['jsonb']), /Hospital Comrade team/)
    const ops = await call(P_ADMIN, 'cp_save_ops_settings', [{ channels: { whatsapp: true, push: true }, events: { trial_ending: { enabled: false } }, thresholds: { latencyMs: 2000 }, health: { siteUrl: 'https://hospital.example.in/' } }], ['jsonb'])
    expect(ops).toMatchObject({ channels: { bell: true, email: true, whatsapp: true, push: true }, thresholds: { latencyMs: 2000, dbPct: 80 }, health: { siteUrl: 'https://hospital.example.in' } })
    expect(ops.events.trial_ending).toEqual({ enabled: false, severity: 'info' })
    await fails(call(P_ADMIN, 'cp_save_ops_settings', [{ health: { siteUrl: 'http://x.in' } }], ['jsonb']), /https/)
    await call(null, 'raise_platform_alert', ['lead_new', 'Test lead 2', 'x', null, 'lead:dup', 60, null, {}], ['text', 'text', 'text', 'text', 'text', 'int', 'text', 'jsonb'])
    expect(await call(null, 'raise_platform_alert', ['lead_new', 'Test lead 2 again', 'x', null, 'lead:dup', 60, null, {}], ['text', 'text', 'text', 'text', 'text', 'int', 'text', 'jsonb'])).toBeNull()
    expect((await outbox(`channel = 'whatsapp'`)).map((m: any) => [m.recipient, m.body])).toEqual([['9999988888', 'Test lead 2\n\nx']])
    // push only to members with a registered device
    expect(await outbox(`channel = 'push'`)).toEqual([])
    await fails(call(P_ADMIN, 'cp_register_push', ['short']), /Invalid device token/)
    expect(await call(P_ADMIN, 'cp_register_push', ['tok_'.padEnd(40, 'x'), 'Chrome'])).toBe(1)
    await call(null, 'raise_platform_alert', ['lead_new', 'Test lead 3', '', null, null, 60, null, {}], ['text', 'text', 'text', 'text', 'text', 'int', 'text', 'jsonb'])
    expect((await outbox(`channel = 'push'`)).map((m: any) => m.recipient)).toEqual([P_ADMIN])
    expect(await call(P_ADMIN, 'cp_push_config')).toBeNull()   // no Firebase web settings yet
    await call(P_ADMIN, 'cp_save_messaging_setup', [{ PLATFORM_FCM_PROJECT_ID: 'hc-push', PLATFORM_FCM_API_KEY: 'AIza…', PLATFORM_FCM_SENDER_ID: '123', PLATFORM_FCM_APP_ID: '1:123:web:abc', PLATFORM_FCM_VAPID_KEY: 'BXYZ' }, {}], ['jsonb', 'jsonb'])
    expect(await call(P_SUPPORT, 'cp_push_config')).toMatchObject({ projectId: 'hc-push', vapidKey: 'BXYZ', devices: 0 })
    expect(await call(P_ADMIN, 'cp_unregister_push')).toBe(0)
    // a switched-off event raises nothing
    expect(await call(null, 'raise_platform_alert', ['trial_ending', 'x', '', null, null, 60, null, {}], ['text', 'text', 'text', 'text', 'text', 'int', 'text', 'jsonb'])).toBeNull()
  })

  test('payments, trials and wallets', async () => {
    const pay = (await db.one<any>(null, `insert into public.billing_payments (tenant_id, kind, plan, months, base_paise, gst_paise, total_paise, order_id)
      values ($1, 'plan', 'clinic', 1, 99900, 17982, 117882, 'order_test_1') returning id`, [B])).id
    await db.as(null, `update public.billing_payments set status = 'failed' where id = $1`, [pay])
    const fin = await inbox(P_FINANCE)
    expect(fin.map((r: any) => r.title)).toEqual(['Payment failed: City Hospital'])
    expect((await outbox(`recipient = 'finance@hc.in'`))[0].body).toContain('₹1,178.82 · clinic plan')
    await call(P_ADMIN, 'cp_save_ops_settings', [{ events: { trial_ending: { enabled: true } }, thresholds: { walletLowPaise: 50000 } }], ['jsonb'])
    await db.as(null, `update public.tenants set trial_ends_at = now() + interval '2 days', wallet_paise = 1000 where id = $1`, [B])
    expect(await call(null, 'run_platform_hourly_alerts')).toBe(2)
    expect(await call(null, 'run_platform_hourly_alerts')).toBe(0)   // once a day
    expect((await inbox(P_FINANCE)).map((r: any) => r.title)).toContain('Wallet low: City Hospital')
  })
})

describe('broadcasts', () => {
  test('preview, send on every channel, delivery counts', async () => {
    await db.as(null, `insert into public.push_tokens (profile_id, token) values ($1, $2)`, [B_OWNER, 'push_'.padEnd(40, 'y')]).catch(async () => {
      await db.as(null, `insert into public.push_tokens (tenant_id, profile_id, token) values ($1, $2, $3)`, [B, B_OWNER, 'push_'.padEnd(40, 'y')])
    })
    await fails(call(P_SUPPORT, 'cp_save_broadcast', [{ title: 'Hello' }], ['jsonb']), /Hospital Comrade team/)
    await fails(call(P_ADMIN, 'cp_save_broadcast', [{ title: 'Hello', audience: { roles: ['patient'] } }], ['jsonb']), /staff roles only/)
    const audience = { hospitals: [B], roles: ['owner', 'doctor'] }
    expect(await call(P_ADMIN, 'cp_broadcast_preview', [audience, ['email', 'sms']], ['jsonb', 'text[]'])).toMatchObject({ hospitals: 1, people: 2, email: 2, sms: 2, push: 1, sample: ['City Hospital'] })
    expect(await call(P_ADMIN, 'cp_broadcast_preview', [{ plans: ['enterprise'] }, ['email']], ['jsonb', 'text[]'])).toMatchObject({ hospitals: 0, people: 0 })
    const b = await call(P_ADMIN, 'cp_save_broadcast', [{ title: 'Maintenance on Sunday', body: 'Short downtime 2–3 am.', level: 'warning', channels: ['inapp', 'email', 'sms', 'push'], audience }], ['jsonb'])
    expect(b.status).toBe('draft')
    const sent = await call(P_ADMIN, 'cp_send_broadcast', [b.id, null], ['uuid', 'timestamptz'])
    expect(sent).toMatchObject({ status: 'sent', stats: { inapp: 1, email: 2, sms: 2, push: 1 } })
    expect((await outbox(`ref_id = '${b.id}' and channel = 'sms'`)).map((m: any) => m.recipient).sort()).toEqual(['9876500000', '9876543210'])
    expect((await db.one<any>(null, `select hospital_ids, roles, level from public.platform_announcements where id = $1`, [sent.announcement_id]))).toEqual({ hospital_ids: [B], roles: ['owner', 'doctor'], level: 'warning' })
    expect((await db.one<any>(null, `select count(*)::int n from public.notification_outbox where related_id = $1 and channel = 'push' and tenant_id = $2`, [b.id, B])).n).toBe(1)
    await fails(call(P_ADMIN, 'cp_send_broadcast', [b.id, null], ['uuid', 'timestamptz']), /already sent/)
    const list = await call(P_ADMIN, 'cp_broadcasts')
    expect(list[0].delivery).toMatchObject({ email: { pending: 2 }, sms: { pending: 2 }, push: { pending: 1 } })
  })

  test('scheduling and cancelling', async () => {
    const b = await call(P_ADMIN, 'cp_save_broadcast', [{ title: 'New feature', channels: ['inapp'] }], ['jsonb'])
    const s = await call(P_ADMIN, 'cp_send_broadcast', [b.id, new Date(Date.now() + 3600_000).toISOString()], ['uuid', 'timestamptz'])
    expect(s.status).toBe('scheduled')
    expect(await call(null, 'run_due_broadcasts')).toBe(0)
    await db.as(null, `update public.platform_broadcasts set scheduled_at = now() - interval '1 minute' where id = $1`, [b.id])
    expect(await call(null, 'run_due_broadcasts')).toBe(1)
    expect((await db.one<any>(null, `select status, hospital_ids from public.platform_broadcasts b join public.platform_announcements a on a.id = b.announcement_id where b.id = $1`, [b.id]))).toEqual({ status: 'sent', hospital_ids: null })
    const d = await call(P_ADMIN, 'cp_save_broadcast', [{ title: 'Draft only' }], ['jsonb'])
    expect(await call(P_ADMIN, 'cp_cancel_broadcast', [d.id])).toBeNull()
    expect((await db.one<any>(null, `select count(*)::int n from public.platform_broadcasts where id = $1`, [d.id])).n).toBe(0)
  })
})

describe('delivery log', () => {
  test('both queues, filters, retry of failed messages only', async () => {
    const row = (await outbox(`kind = 'broadcast' and channel = 'email'`))[0]
    await db.as(null, `update public.platform_outbox set status = 'failed', error = 'Resend rejected the API key' where id = $1`, [row.id])
    const log = await call(P_SUPPORT, 'cp_delivery_log', [{ status: 'failed' }], ['jsonb'])
    expect(log.map((r: any) => [r.source, r.id, r.hospital])).toContainEqual(['platform', row.id, 'City Hospital'])
    expect(await call(P_SUPPORT, 'cp_delivery_log', [{ source: 'hospital', channel: 'push' }], ['jsonb'])).toEqual([expect.objectContaining({ recipient: 'device', kind: 'platform_broadcast' })])
    await fails(call(P_FINANCE, 'cp_delivery_log', [{}], ['jsonb']), /Hospital Comrade team/)
    await call(P_SUPPORT, 'cp_retry_message', ['platform', row.id], ['text', 'uuid'])
    expect((await outbox(`id = '${row.id}'`))[0]).toMatchObject({ status: 'pending', attempts: 0, error: null })
    await fails(call(P_SUPPORT, 'cp_retry_message', ['platform', row.id], ['text', 'uuid']), /Only failed messages/)
  })

  test('claiming for delivery', async () => {
    const got = await db.as<any>('service', `select * from public.claim_platform_outbox(3)`)
    expect(got).toHaveLength(3)
    expect(got.every((r: any) => r.status === 'sending' && r.attempts === 1)).toBe(true)
    await fails(db.as(P_ADMIN, `select * from public.claim_platform_outbox(3)`), /permission denied/)
  })
})

describe('health', () => {
  test('records checks, adds the database ones, alerts on down / slow / recovered, keeps uptime', async () => {
    const before = (await inbox(P_SUPPORT)).length
    const r = await call('service', 'record_health', [[
      { service: 'fn:notify', label: 'notify function', group: 'Edge Functions', status: 'fail', latency_ms: 120, detail: 'not deployed' },
      { service: 'site', label: 'Website', group: 'Platform', status: 'ok', latency_ms: 9000, detail: 'HTTP 200' },
      { service: 'provider:sms', label: 'SMS', group: 'Providers', status: 'off', detail: 'not configured' },
    ]], ['jsonb'])
    expect(r.map((x: any) => x.service)).toEqual(expect.arrayContaining(['db:size', 'db:queue', 'db:delivery', 'db:cron']))
    const titles = (await inbox(P_SUPPORT)).slice(before).map((x: any) => x.title)
    expect(titles).toEqual(expect.arrayContaining(['notify function is down', 'Website needs attention', 'Scheduler is down']))   // PGlite has no pg_cron
    await call('service', 'record_health', [[{ service: 'fn:notify', label: 'notify function', status: 'ok', latency_ms: 80 }]], ['jsonb'])
    expect((await inbox(P_SUPPORT)).map((x: any) => x.title)).toContain('notify function is back to normal')
    const live = await call(P_SUPPORT, 'cp_health_live')
    const notify = live.services.find((s: any) => s.service === 'fn:notify')
    expect(notify).toMatchObject({ status: 'ok', uptime24: 50, group: 'Edge Functions' })
    expect(live.services.find((s: any) => s.service === 'site')).toMatchObject({ status: 'warn', detail: 'HTTP 200 · slow (9000 ms)' })
    expect(live.failures.length).toBeGreaterThan(0)
    expect(live.settings).toMatchObject({ enabled: true, siteUrl: 'https://hospital.example.in' })
    await fails(call(P_FINANCE, 'cp_health_live'), /Hospital Comrade team/)
    await fails(call(P_ADMIN, 'record_health', [[]], ['jsonb']), /permission denied/)
  })

  test('the every-minute tick runs without pg_net / pg_cron', async () => {
    await db.as(null, `select public.ops_cron_tick()`)
    await db.as(null, `select public.notify_cron_flush()`)
  })
})
