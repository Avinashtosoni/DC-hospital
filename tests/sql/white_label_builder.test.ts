/**
 * White-label CMS/onboarding and AI access controls (scripts/sql/white_label_builder.sql).
 * Exercises tenant ownership, optional consent, channel eligibility, plan overrides and atomic usage accounting.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, type Db } from './harness'

let db: Db
const HOSPITAL = 'b0000000-0000-4000-8000-000000000002'
const OWNER = 'b0b00000-0000-4000-8000-000000000001'
const PATIENT = 'b0b00000-0000-4000-8000-000000000002'
const LATE_HOSPITAL = 'b0000000-0000-4000-8000-000000000003'
const LATE_OWNER = 'b0b00000-0000-4000-8000-000000000003'
const ADMIN = 'e0e00000-0000-4000-8000-000000000001'

const signUp = (id: string, email: string, meta: Record<string, unknown>) => db.as(null,
  `insert into auth.users (id,email,encrypted_password,raw_user_meta_data) values ($1,$2,'x',$3::jsonb)`, [id, email, JSON.stringify(meta)])
async function call<T = any>(who: string | null, fn: string, args: unknown[] = [], types: string[] = []): Promise<T> {
  const list = args.map((_, i) => `$${i + 1}${types[i] ? '::' + types[i] : ''}`).join(', ')
  const r = await db.one<{ r: T }>(who, `select public.${fn}(${list}) as r`, args.map((a) => a !== null && typeof a === 'object' ? JSON.stringify(a) : a))
  return r.r
}
const fails = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re)

beforeAll(async () => {
  db = await freshDb('master')
  await db.as(null, `insert into public.tenants (id,slug,name,code,plan,status,trial_ends_at)
    values ($1,'builder-hospital','Builder Hospital','BLD','clinic','trial',now()+interval '14 days')`, [HOSPITAL])
  await db.as(null, `select public.seed_hospital_defaults($1)`, [HOSPITAL])
  await signUp(OWNER, 'owner@builder.in', { full_name: 'Builder Owner', phone: '+91 98765 43210', tenant_id: HOSPITAL })
  await db.as(null, `update public.profiles set role='owner' where id=$1`, [OWNER])
  await signUp(PATIENT, 'patient@builder.in', { full_name: 'Builder Patient', tenant_id: HOSPITAL })
  await signUp(ADMIN, 'admin@builder.in', { full_name: 'Platform Admin' })
  await db.as(null, `select set_config('app.tenant_move','on',false)`)
  await db.as(null, `update public.profiles set tenant_id=null where id=$1`, [ADMIN])
  await db.as(null, `select set_config('app.tenant_move','',false)`)
  await db.as(null, `delete from public.patients where profile_id=$1`, [ADMIN])
  await db.as(null, `insert into public.provider_users(user_id,role) values ($1,'admin')`, [ADMIN])
}, 240_000)

describe('tenant onboarding', () => {
  test('progress is private to the hospital owner, the owner phone is normalized and help does not imply consent', async () => {
    const initial = await call<any>(OWNER, 'my_onboarding')
    expect(initial).toMatchObject({ current_step: 'details', completed_steps: ['account'], owner_phone: '+919876543210', followup_consent: false })
    const saved = await call<any>(OWNER, 'save_onboarding_progress', [{ completed_steps: ['account', 'details', 'website'], followup_consent: false }], ['jsonb'])
    expect(saved).toMatchObject({ current_step: 'doctors', followup_consent: false, consent_source: 'hospital_owner' })
    expect(saved.completed_steps).toEqual(expect.arrayContaining(['account', 'details', 'website']))
    const help = await call<any>(OWNER, 'request_onboarding_help', ['Please help us add our doctors.'], ['text'])
    expect(help.status).toBe('open')
    expect((await db.one<{ consent: boolean; source: string }>(null,
      `select followup_consent consent, consent_source source from public.tenant_onboarding where tenant_id=$1`, [HOSPITAL])))
      .toEqual({ consent: false, source: 'hospital_owner' })
    expect(Number((await db.one<{ n: number }>(null, `select count(*)::int n from public.platform_onboarding_help where hospital_id=$1`, [HOSPITAL])).n)).toBe(1)
    await fails(call(PATIENT, 'my_onboarding'), /hospital owner/)
    await fails(call(PATIENT, 'request_onboarding_help', ['Need setup support'], ['text']), /hospital owner/)
    await expect(db.as('anon', `select public.my_onboarding()`)).rejects.toThrow(/hospital owner/)
  })

  test('reminders always allow in-app but external email is sent only after explicit consent and valid tenant configuration', async () => {
    await db.as(null, `update public.tenant_onboarding set followup_consent=false, completed_at=null, reminder_count=0,
      next_followup_at=now()-interval '1 minute' where tenant_id=$1`, [HOSPITAL])
    await db.as('service', `select public.process_onboarding_reminders()`)
    expect(await db.as(null, `select 1 from public.notification_outbox where tenant_id=$1 and event='onboarding_reminder' and channel='email'`, [HOSPITAL])).toHaveLength(0)
    expect(await db.as(null, `select 1 from public.user_notifications where tenant_id=$1 and profile_id=$2 and event='onboarding_reminder'`, [HOSPITAL, OWNER])).toHaveLength(1)

    await db.as(null, `delete from public.notification_outbox where tenant_id=$1 and event='onboarding_reminder'`, [HOSPITAL])
    await db.as(null, `delete from public.user_notifications where tenant_id=$1 and profile_id=$2 and event='onboarding_reminder'`, [HOSPITAL, OWNER])
    await db.as(null, `update public.app_settings set data=jsonb_set(data,'{notifications,email}',
      '{"enabled":true,"source":"own","provider":"resend","fromEmail":"owner@builder.in"}'::jsonb,true)
      where tenant_id=$1 and key='app'`, [HOSPITAL])
    await db.as(null, `insert into public.app_secrets(tenant_id,key,value) values ($1,'resend_api_key','test-secret')`, [HOSPITAL])
    await db.as(null, `update public.tenant_onboarding set followup_consent=true, completed_at=null, reminder_count=0,
      next_followup_at=now()-interval '1 minute' where tenant_id=$1`, [HOSPITAL])
    await db.as('service', `select public.process_onboarding_reminders()`)
    const mail = await db.as<{ recipient: string; channel: string }>(null,
      `select recipient,channel from public.notification_outbox where tenant_id=$1 and event='onboarding_reminder'`, [HOSPITAL])
    expect(mail).toContainEqual({ recipient: 'owner@builder.in', channel: 'email' })
  })

  test('unavailable channels do not spend reminder attempts; an owner can still receive in-app help without external consent', async () => {
    await db.as(null, `insert into public.tenants (id,slug,name,code,plan,status,trial_ends_at)
      values ($1,'late-builder-hospital','Late Builder Hospital','LTH','clinic','trial',now()+interval '14 days')`, [LATE_HOSPITAL])
    await db.as(null, `select public.seed_hospital_defaults($1)`, [LATE_HOSPITAL])
    await db.as(null, `update public.tenant_onboarding set followup_consent=false, next_followup_at=now()-interval '1 minute' where tenant_id=$1`, [LATE_HOSPITAL])
    await db.as('service', `select public.process_onboarding_reminders()`)
    const waiting = await db.one<{ reminder_count: number; due: boolean }>(null,
      `select reminder_count::int, next_followup_at>now() due from public.tenant_onboarding where tenant_id=$1`, [LATE_HOSPITAL])
    expect(waiting).toEqual({ reminder_count: 0, due: true })

    await signUp(LATE_OWNER, 'late-owner@builder.in', { full_name: 'Late Owner', phone: '+91 98765 43211', tenant_id: LATE_HOSPITAL })
    await db.as(null, `update public.profiles set role='owner' where id=$1`, [LATE_OWNER])
    await db.as(null, `update public.tenant_onboarding set next_followup_at=now()-interval '1 minute' where tenant_id=$1`, [LATE_HOSPITAL])
    await db.as('service', `select public.process_onboarding_reminders()`)
    expect(await db.as(null, `select 1 from public.user_notifications where tenant_id=$1 and profile_id=$2 and event='onboarding_reminder'`, [LATE_HOSPITAL, LATE_OWNER])).toHaveLength(1)
    expect(await db.as(null, `select 1 from public.notification_outbox where tenant_id=$1 and event='onboarding_reminder' and channel in ('email','whatsapp','push')`, [LATE_HOSPITAL])).toHaveLength(0)
    expect((await db.one<{ reminder_count: number }>(null, `select reminder_count::int from public.tenant_onboarding where tenant_id=$1`, [LATE_HOSPITAL])).reminder_count).toBe(1)
  })
})

describe('AI page assistance', () => {
  test('entitlement follows the selected plan unless an admin override is present; keys are never exposed to owners', async () => {
    const disabled = await call<any>(OWNER, 'my_ai_access')
    expect(disabled).toMatchObject({ entitled: false, enabled: false })
    await db.as(null, `update public.tenants set ai_assistance_override=true where id=$1`, [HOSPITAL])
    const override = await call<any>(OWNER, 'my_ai_access')
    expect(override.entitled).toBe(true)
    expect(JSON.stringify(override)).not.toContain('test-api-key')
    await db.as(null, `update public.tenants set ai_assistance_override=null, plan='enterprise' where id=$1`, [HOSPITAL])
    const plan = await call<any>(OWNER, 'my_ai_access')
    expect(plan.entitled).toBe(true)
    expect(plan.enabled).toBe(false) // platform master switch and provider are off by default
    await db.as(null, `update public.tenants set ai_assistance_override=false where id=$1`, [HOSPITAL])
    expect((await call<any>(OWNER, 'my_ai_access')).entitled).toBe(false)
  })

  test('platform admin configures ordered providers, usage is reserved atomically and the per-hospital cap is enforced', async () => {
    await db.as(null, `update public.tenants set ai_assistance_override=null, plan='clinic' where id=$1`, [HOSPITAL])
    const saved = await call<any>(ADMIN, 'cp_save_ai_builder_settings', [{ enabled: true, dailyLimit: 1, maxOutputTokens: 700,
      providers: [{ id: 'openai', model: 'gpt-4o-mini', enabled: true }, { id: 'gemini', model: 'gemini-2.5-flash-lite', enabled: false }] }], ['jsonb'])
    expect(saved).toMatchObject({ enabled: true, dailyLimit: 1, maxOutputTokens: 700 })
    expect(saved.providers.map((p: any) => p.id)).toEqual(['openai', 'gemini'])
    await db.as(null, `insert into public.platform_secrets(key,value,hint) values ('PLATFORM_AI_OPENAI_API_KEY','test-api-key','••••-key')`)
    await db.as(null, `update public.platform_secrets set value='' where key='PLATFORM_AI_OPENAI_API_KEY'`)
    expect((await call<any>(OWNER, 'my_ai_access')).providersAvailable).toBe(false)
    await db.as(null, `update public.platform_secrets set value='test-api-key' where key='PLATFORM_AI_OPENAI_API_KEY'`)
    const access = await call<any>(OWNER, 'my_ai_access')
    expect(access).toMatchObject({ enabled: false, entitled: false, providersAvailable: true })
    expect(JSON.stringify(access)).not.toContain('test-api-key')
    await db.as(null, `update public.tenants set ai_assistance_override=true where id=$1`, [HOSPITAL])
    const accessEnabled = await call<any>(OWNER, 'my_ai_access')
    expect(accessEnabled.enabled).toBe(true)

    const first = await call<any>('service', 'ai_builder_reserve', [HOSPITAL, OWNER, 'a'.repeat(64)], ['uuid', 'uuid', 'text'])
    expect(first.id).toBeTruthy()
    expect(await call<any>('service', 'ai_builder_finish', [first.id, 'success', 'openai', 'gpt-4o-mini', 90, 120, null],
      ['uuid', 'text', 'text', 'text', 'int', 'int', 'text'])).toBe(true)
    await fails(call('service', 'ai_builder_reserve', [HOSPITAL, OWNER, 'b'.repeat(64)], ['uuid', 'uuid', 'text']), /AI_DAILY_LIMIT/)
    const usage = await call<any>(ADMIN, 'cp_ai_builder_usage')
    expect(usage).toMatchObject({ requests: 1, tokens: 210, failures: 0, providers: { openai: 1 } })
    await fails(call(OWNER, 'cp_ai_builder_settings'), /Hospital Comrade team/)
    await expect(db.as('anon', `select public.ai_builder_reserve($1,$2,$3)`, [HOSPITAL, OWNER, 'c'.repeat(64)])).rejects.toThrow(/permission denied/)
  })
})
