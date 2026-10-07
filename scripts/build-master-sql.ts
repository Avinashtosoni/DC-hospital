/**
 * Builds supabase/master.sql — ONE file containing:
 *   schema (tables, indexes, helper functions, triggers) → RLS policies → demo auth users → demo data
 *   → audit triggers → website CMS → public online-booking API
 *
 * RLS policies are generated from src/auth/permissions.ts so the database always enforces exactly
 * what the UI shows. Demo data comes from scripts/seed/seed.ts with dates expressed relative to
 * current_date, so the dataset always looks "live" whenever you run the script.
 *
 *   npm run sql:build
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PERMISSIONS, ROW_RULES, type Action } from '../src/auth/permissions'
import { buildSeed, DEMO_PASSWORD, DEMO_USERS } from './seed/seed'
import type { Role, TableName } from '../src/types'
import { DEFAULT_FORMS } from '../src/forms/schema'
import { DEFAULT_APP_SETTINGS, type NotifyEvent } from '../src/settings/types'
import { BILLING_DEFAULTS } from '../src/platform/billing'
import { CATALOG } from '../src/notify'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RAW = '__SQL__'

// ------------------------------------------------------------------ RLS
const patientCondition: Partial<Record<TableName, string>> = {
  patients: 'profile_id = auth.uid()',
  appointments: 'patient_id = public.my_patient_id()',
  prescriptions: 'patient_id = public.my_patient_id()',
  lab_tests: 'patient_id = public.my_patient_id()',
  invoices: 'patient_id = public.my_patient_id()',
  payments: 'patient_id = public.my_patient_id()',
  admissions: 'patient_id = public.my_patient_id()',
  departments: 'true',
  doctors: "status = 'active'",
  notices: "audience in ('all', 'patients')",
  holidays: 'true',
  visit_feedback: 'patient_id = public.my_patient_id()',
}
const staffNoticeCondition = "(audience in ('all', 'staff') or (audience = 'doctors' and public.has_role('doctor')))"

const CMD: Record<Action, 'select' | 'insert' | 'update' | 'delete'> = { read: 'select', create: 'insert', update: 'update', delete: 'delete' }

/** the role policies from src/auth/permissions.ts. `upgrade`: drop + recreate them (an existing database picks up
 *  permission changes — e.g. who may read salaries); profiles' hand-written policies are left alone. */
function policies(upgrade = false): string {
  const out: string[] = []
  for (const [table, matrix] of Object.entries(PERMISSIONS) as [TableName, Partial<Record<Role, Action[]>>][]) {
    out.push(`\n-- ${table}`)
    out.push(`alter table public.${table} enable row level security;`)
    if (table === 'profiles') continue // handled manually below
    if (upgrade) for (const cmd of Object.values(CMD)) out.push(`drop policy if exists ${table}_${cmd} on public.${table};`)
    for (const action of ['read', 'create', 'update', 'delete'] as Action[]) {
      const staffRoles = (Object.keys(matrix) as Role[]).filter((r) => r !== 'patient' && matrix[r]!.includes(action))
      const conds: string[] = []
      // roles with an extra row rule (ROW_RULES) get their own "(has_role(x) and <rule>)" branch
      const ruled = staffRoles.filter((r) => ROW_RULES[table]?.[r]?.[action])
      const plain = staffRoles.filter((r) => !ruled.includes(r))
      for (const r of ruled) conds.push(`(public.has_role('${r}') and ${ROW_RULES[table]![r]![action]})`)
      if (plain.length) {
        let c = `public.has_role(${plain.map((r) => `'${r}'`).join(', ')})`
        // non-owner staff only see notices meant for them
        if (table === 'notices' && action === 'read') c = `(public.has_role('owner') or (public.has_role(${plain.filter((r) => r !== 'owner').map((r) => `'${r}'`).join(', ')}) and ${staffNoticeCondition}))`
        conds.unshift(c)
      }
      if (matrix.patient?.includes(action)) {
        const pc = patientCondition[table]
        if (!pc) throw new Error(`No patient condition for ${table}`)
        conds.push(`(public.has_role('patient') and ${pc})`)
      }
      if (!conds.length) continue
      const expr = conds.join('\n      or ')
      const name = `${table}_${CMD[action]}`
      const cmd = CMD[action]
      const clause = cmd === 'insert' ? `with check (${expr})` : cmd === 'update' ? `using (${expr})\n  with check (${expr})` : `using (${expr})`
      out.push(`create policy ${name} on public.${table} for ${cmd} to authenticated\n  ${clause};`)
    }
  }
  if (upgrade) return out.join('\n')
  // profiles: everyone reads their own; staff can read all (to show names); users update themselves; owner manages all
  out.push(`
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_owner on public.profiles for update to authenticated
  using (public.has_role('owner')) with check (public.has_role('owner'));
create policy profiles_delete_owner on public.profiles for delete to authenticated
  using (public.has_role('owner'));`)
  return out.join('\n')
}

// ------------------------------------------------------------------ seed
const sqlDates = {
  date: (o: number) => `${RAW}(current_date + ${o})`,
  ts: (o: number, t = '09:00') => `${RAW}((current_date + ${o}) + time '${t}')`,
}
const TEXT_ARRAY_COLS = new Set(['available_days', 'tags', 'channels', 'roles'])

function lit(v: unknown, col: string): string {
  if (v === undefined) return 'default'
  if (v === null) return 'null'
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'string') return v.startsWith(RAW) ? v.slice(RAW.length) : `'${v.replace(/'/g, "''")}'`
  if (Array.isArray(v) && TEXT_ARRAY_COLS.has(col)) return `array[${v.map((x) => lit(x, '')).join(', ')}]::text[]`
  return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
}

function inserts(table: string, rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  const chunks: string[] = []
  for (let i = 0; i < rows.length; i += 50) {
    const values = rows.slice(i, i + 50).map((r) => `  (${cols.map((c) => lit(r[c], c)).join(', ')})`).join(',\n')
    chunks.push(`insert into public.${table} (${cols.join(', ')}) values\n${values};`)
  }
  return `-- ${table} (${rows.length})\n${chunks.join('\n')}`
}

function seedSql(): string {
  const s = buildSeed(sqlDates)
  const ids = DEMO_USERS.map((u) => `'${u.id}'`).join(', ')
  const users = DEMO_USERS.map((u) => `  ('00000000-0000-0000-0000-000000000000', '${u.id}', 'authenticated', 'authenticated', '${u.email}',
   extensions.crypt('${DEMO_PASSWORD}', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,
   '${JSON.stringify({ full_name: u.full_name, phone: u.phone })}'::jsonb, now() - interval '200 days', now(), '', '', '', '')`).join(',\n')
  const identities = DEMO_USERS.map((u) => `  (gen_random_uuid(), '${u.id}', '${u.id}', '${JSON.stringify({ sub: u.id, email: u.email, email_verified: true })}'::jsonb, 'email', now(), now(), now())`).join(',\n')
  const roleUpdates = DEMO_USERS.map((u) => `update public.profiles set role = '${u.role}', phone = '${u.phone}' where id = '${u.id}';`).join('\n')

  const order: TableName[] = ['departments', 'doctors', 'staff', 'patients', 'appointments', 'prescriptions', 'lab_tests', 'wards', 'beds', 'admissions', 'invoices', 'payments', 'expenses', 'inventory', 'notices', 'site_forms', 'site_enquiries', 'doctor_leaves', 'holidays', 'audit_log', 'visit_feedback', 'notification_templates']
  const body = order.map((t) => inserts(t, s[t] as unknown as Record<string, unknown>[])).join('\n\n')

  return `
-- 7a. Demo login accounts (password: ${DEMO_PASSWORD})
delete from auth.users where id in (${ids}) or email in (${DEMO_USERS.map((u) => `'${u.email}'`).join(', ')});

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values
${users};

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
${identities};

-- handle_new_user() created patient profiles; assign the demo roles and drop the auto-created patient rows
${roleUpdates}
delete from public.patients where profile_id in (${ids});

-- 7b. Demo hospital data (bed/patient statuses are already consistent, so skip the admission trigger while loading)
alter table public.admissions disable trigger trg_admissions_sync;

${body}

alter table public.admissions enable trigger trg_admissions_sync;

-- 7c. Backfill profiles for any pre-existing auth users (e.g. if you re-run this script on a live project)
insert into public.profiles (id, full_name, email, role)
select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)), u.email, 'patient'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);
`
}

// ------------------------------------------------------------------ assemble
const header = `-- =====================================================================================================
--  DC HOSPITAL — MASTER SQL FOR SUPABASE
--  Schema · Row Level Security · Triggers · Demo users · Realistic demo data — in a single file.
--
--  HOW TO USE
--    1. Supabase Dashboard → SQL Editor → New query → paste this whole file → Run.
--    2. Put your project URL + anon key in .env (see .env.example) and start the app.
--    3. Sign in with any demo account, password: ${DEMO_PASSWORD}
${DEMO_USERS.map((u) => `--         ${u.role.padEnd(13)} ${u.email}`).join('\n')}
--
--  ⚠ Re-running DROPS and recreates all DC Hospital tables (auth users other than the demo ones are kept).
--    Website CMS content (site_content), its history and uploaded images are preserved.
--  Generated by scripts/build-master-sql.ts — edit the sources and run \`npm run sql:build\`.
-- =====================================================================================================
`
const schema = readFileSync(resolve(root, 'scripts/sql/schema.sql'), 'utf8')
const cmsSql = readFileSync(resolve(root, 'scripts/sql/cms.sql'), 'utf8')
const auditSql = readFileSync(resolve(root, 'scripts/sql/audit.sql'), 'utf8')
const bookingSql = readFileSync(resolve(root, 'scripts/sql/booking.sql'), 'utf8')
const settingsSql = readFileSync(resolve(root, 'scripts/sql/settings.sql'), 'utf8')
const patientSql = readFileSync(resolve(root, 'scripts/sql/patient.sql'), 'utf8')
const scaleSql = readFileSync(resolve(root, 'scripts/sql/scale.sql'), 'utf8')
const authSql = readFileSync(resolve(root, 'scripts/sql/auth.sql'), 'utf8')
// multi-tenancy runs last: it adds tenant_id + the tenant_isolation policy to every table created above
let tenancySql = readFileSync(resolve(root, 'scripts/sql/tenancy.sql'), 'utf8')
// …but current_tenant() and the hospital helpers must exist before any later function uses them
const tenancyCoreSql = readFileSync(resolve(root, 'scripts/sql/tenancy_core.sql'), 'utf8')
// built-in website forms come from src/forms/schema.ts so the app and the database never disagree
const formRows = DEFAULT_FORMS.map((f) => `  (${[f.id, f.slug, f.name, f.description ?? null, f.kind, f.enabled, f.fields, f.settings, f.sort].map((v) => lit(v, '')).join(', ')})`).join(',\n')
// a new hospital gets the same built-in forms (seed_hospital_defaults in tenancy.sql)
tenancySql = tenancySql.replace('@@DEFAULT_FORM_VALUES@@', formRows)
if (tenancySql.includes('@@DEFAULT_FORM_VALUES@@')) throw new Error('default forms placeholder missing')
// a new hospital's settings (phase 3): the app defaults, with SMS / WhatsApp / e-mail on Hospital Comrade messaging
const newHospitalSettings = JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS))
for (const ch of ['sms', 'whatsapp', 'email'] as const) Object.assign(newHospitalSettings.notifications[ch], { source: 'platform', enabled: true })
const newHospitalJson = JSON.stringify(newHospitalSettings)
if (newHospitalJson.includes('$json$') || newHospitalJson.includes('$$')) throw new Error('new hospital settings contain $json$')
tenancySql = tenancySql.replace('@@NEW_HOSPITAL_SETTINGS@@', newHospitalJson)
if (tenancySql.includes('@@NEW_HOSPITAL_SETTINGS@@')) throw new Error('new hospital settings placeholder missing')
// phase 4 — licence, wallet and payments (loaded last); prices / GST / rates default from src/platform/billing.ts
const billingSql = readFileSync(resolve(root, 'scripts/sql/billing.sql'), 'utf8').replace('@@BILLING_DEFAULTS@@', () => JSON.stringify(BILLING_DEFAULTS))
if (billingSql.includes('@@BILLING_DEFAULTS@@')) throw new Error('billing defaults placeholder missing')
// phase 5 — the Hospital Comrade control panel's functions (after billing: they reuse provider_billing)
const controlPanelSql = readFileSync(resolve(root, 'scripts/sql/control_panel.sql'), 'utf8')
// phase 7 — privacy, offboarding, incidents, retention, health (last: uses the panel's cp_require / cp_hospital)
const complianceSql = readFileSync(resolve(root, 'scripts/sql/compliance.sql'), 'utf8')
// phase 8 — self-service free-trial sign-up (after the panel: reuses hospital_create / cp_require)
const signupSql = readFileSync(resolve(root, 'scripts/sql/signup.sql'), 'utf8')
// phase 8.3 — the control panel's launch checklist (last: reads every other part's settings)
const launchSql = readFileSync(resolve(root, 'scripts/sql/launch.sql'), 'utf8')
// data-integrity rules (money, beds, same-hospital references) — last, so they cover every table created before
const integritySql = readFileSync(resolve(root, 'scripts/sql/integrity.sql'), 'utf8')
const controlOpsSql = readFileSync(resolve(root, 'scripts/sql/control_panel_ops.sql'), 'utf8')
// the platform's own website CMS (control panel → Website): pages, legal pages, blog, media
const platformCmsSql = readFileSync(resolve(root, 'scripts/sql/platform_cms.sql'), 'utf8')
// control panel → messaging & alerts, broadcasts, live health checks
const cpNotifySql = readFileSync(resolve(root, 'scripts/sql/cp_notify.sql'), 'utf8')
// OTP on sign-in (hospital + control-panel team) — enforced through current_tenant() / provider_role()
const otpSql = readFileSync(resolve(root, 'scripts/sql/otp_verify.sql'), 'utf8')
// the notification template library (src/notify/catalog.ts) — last of the modules: it replaces the queue functions
const catalogJson = JSON.stringify(Object.fromEntries(CATALOG.map((e) => [e.id, {
  code: e.code, group: e.group, scope: e.scope, audience: e.audience, label: e.label, channels: e.channels,
  defaults: Object.fromEntries(e.channels.map((c) => [c, !!e.defaults[c]])), tokens: e.tokens, waCategory: e.waCategory,
  ...(e.copy ? { copy: e.copy } : {}), ...(e.freeText ? { freeText: true } : {}),
}])))
if (catalogJson.includes('$catalog$')) throw new Error('notification catalog contains $catalog$')
const notifySql = readFileSync(resolve(root, 'scripts/sql/notify_catalog.sql'), 'utf8').replace('@@NOTIFY_CATALOG@@', () => catalogJson)
if (notifySql.includes('@@NOTIFY_CATALOG@@')) throw new Error('notification catalog placeholder missing')
// the plans catalogue (Control Panel → Plans & billing) — after the notification library (it tells owners about changes)
const plansSql = readFileSync(resolve(root, 'scripts/sql/plans.sql'), 'utf8').replace('@@PLAN_DEFAULTS@@', () => JSON.stringify(BILLING_DEFAULTS.plans))
if (plansSql.includes('@@PLAN_DEFAULTS@@')) throw new Error('plan defaults placeholder missing')
if (JSON.stringify(BILLING_DEFAULTS.plans).includes('$json$')) throw new Error('plan defaults contain $json$')
// free-trial sign-up: verify the mobile number (after the platform outbox and the OTP module)
const signupOtpSql = readFileSync(resolve(root, 'scripts/sql/signup_otp.sql'), 'utf8')
const demoSql = readFileSync(resolve(root, 'scripts/sql/demo.sql'), 'utf8')
const formsSql = readFileSync(resolve(root, 'scripts/sql/forms.sql'), 'utf8').replace('-- @@DEFAULT_FORMS@@',
  `insert into public.site_forms (id, slug, name, description, kind, enabled, fields, settings, sort) values\n${formRows}\non conflict do nothing;`)

// default wording for the messaging events added in section 18 — merged into a saved Settings row (saved values win)
const NEW_EVENTS: NotifyEvent[] = ['account_created', 'account_updated', 'account_deleted', 'password_changed', 'notice_published', 'login_otp']
const nd = DEFAULT_APP_SETTINGS.notifications
const notifyDefaults = JSON.stringify({
  events: Object.fromEntries(NEW_EVENTS.map((e) => [e, nd.events[e]])),
  templates: Object.fromEntries(NEW_EVENTS.map((e) => [e, nd.templates[e]])),
  push: nd.push, rates: nd.rates,
})
if (notifyDefaults.includes('$json$')) throw new Error('notification defaults contain $json$')
const messagingSql = readFileSync(resolve(root, 'scripts/sql/messaging.sql'), 'utf8').replace('-- @@NOTIFY_DEFAULTS@@', `with d as (select $json$${notifyDefaults}$json$::jsonb as j)
update public.app_settings a set data = jsonb_set(a.data, '{notifications}', coalesce(a.data -> 'notifications', '{}'::jsonb) || jsonb_build_object(
    'events', (d.j -> 'events') || coalesce(a.data -> 'notifications' -> 'events', '{}'::jsonb),
    'templates', (d.j -> 'templates') || coalesce(a.data -> 'notifications' -> 'templates', '{}'::jsonb),
    'push', (d.j -> 'push') || coalesce(a.data -> 'notifications' -> 'push', '{}'::jsonb),
    'rates', (d.j -> 'rates') || coalesce(a.data -> 'notifications' -> 'rates', '{}'::jsonb)))
  from d
 where a.key = 'app' and jsonb_typeof(a.data -> 'notifications') = 'object';`)
if (messagingSql.includes('@@NOTIFY_DEFAULTS@@')) throw new Error('messaging defaults placeholder missing')

const rls = `-- =====================================================================================================
--  6. ROW LEVEL SECURITY (generated from src/auth/permissions.ts)
-- =====================================================================================================
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
grant execute on all functions in schema public to authenticated;
${policies()}`

const sql = `${header}
begin;

${schema}

${tenancyCoreSql}

${rls}

-- =====================================================================================================
--  7. DEMO DATA
-- =====================================================================================================
${seedSql()}

${auditSql}

${cmsSql}

${bookingSql}

${settingsSql}

${patientSql}

${scaleSql}

${authSql}

${formsSql}

${messagingSql}

${tenancySql}

${billingSql}

${controlPanelSql}

${complianceSql}

${signupSql}

${launchSql}

${integritySql}

${controlOpsSql}

${platformCmsSql}

${cpNotifySql}

${otpSql}

${notifySql}

${plansSql}

${signupOtpSql}

${demoSql}
commit;

-- Done ✔  —  Sign in at your app with owner@dchospital.com / ${DEMO_PASSWORD}
`

// ------------------------------------------------------------------ production (no demo users, no demo data)
const OWNER_PLACEHOLDER = 'owner@your-hospital.in'
const demoIds = DEMO_USERS.map((u) => `'${u.id}'`).join(', ')
const production = `-- =====================================================================================================
--  DC HOSPITAL — PRODUCTION SQL FOR SUPABASE  (no demo accounts, no demo data)
--
--  HOW TO USE
--    1. Change the e-mail on the line marked ✏️ below to the hospital owner's real e-mail.
--    2. Supabase Dashboard → SQL Editor → New query → paste this whole file → Run.
--    3. Open the app → Create account with that e-mail → you are the Owner.
--       Invite the rest of the team from Users & Roles → Invite staff (they get the right role automatically).
--
--  ⚠ Run it ONCE on a fresh project. Re-running DROPS and recreates all hospital tables (like master.sql).
--    Demo logins (…@dchospital.com) are deleted if they exist; the sign-in page hides demo buttons and the
--    booking page never shows the OTP on screen.
--  Generated by scripts/build-master-sql.ts — edit the sources and run \`npm run sql:build\`.
-- =====================================================================================================
begin;

${schema}

${tenancyCoreSql}

${rls}

-- =====================================================================================================
--  7. NO DEMO DATA — remove demo logins if this project ever ran master.sql
-- =====================================================================================================
delete from auth.users where id in (${demoIds}) or email in (${DEMO_USERS.map((u) => `'${u.email}'`).join(', ')});

-- profiles for anyone who already signed up (e.g. re-running on a live project)
insert into public.profiles (id, full_name, email, role)
select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)), u.email, 'patient'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

${auditSql}

${cmsSql}

${bookingSql}

${settingsSql}

${patientSql}

${scaleSql}

${authSql}

${formsSql}

${messagingSql}

${tenancySql}

${billingSql}

${controlPanelSql}

${complianceSql}

${signupSql}

${launchSql}

${integritySql}

${controlOpsSql}

${platformCmsSql}

${cpNotifySql}

${otpSql}

${notifySql}

${plansSql}

${signupOtpSql}

${demoSql}

-- =====================================================================================================
--  14. GO-LIVE DEFAULTS
-- =====================================================================================================
-- ✏️  The first account created with this e-mail becomes the hospital Owner:
insert into public.app_settings (key, data) values ('bootstrap', jsonb_build_object('owner_email', '${OWNER_PLACEHOLDER}'))
on conflict (tenant_id, key) do update set data = excluded.data;

-- an existing account with that e-mail (created before running this file) is promoted right away
update public.profiles set role = 'owner'
where lower(email) = lower((select data ->> 'owner_email' from public.app_settings where key = 'bootstrap'))
  and not exists (select 1 from public.profiles where role = 'owner');

commit;

-- Done ✔  —  Now create your account with the e-mail you set above.
`

mkdirSync(resolve(root, 'supabase'), { recursive: true })
writeFileSync(resolve(root, 'supabase/master.sql'), sql)
console.log(`✔ supabase/master.sql written (${(sql.length / 1024).toFixed(0)} KB)`)
writeFileSync(resolve(root, 'supabase/production.sql'), production)
console.log(`✔ supabase/production.sql written (${(production.length / 1024).toFixed(0)} KB)`)

// the in-place upgrade carries the same forms / messaging sections (between markers) — regenerated so they never drift
const upgradePath = resolve(root, 'supabase/upgrade-2026-10.sql')
const upgrade = readFileSync(upgradePath, 'utf8')
let nextUpgrade = upgrade
// Every source file that defines functions is carried (same order as master.sql): an upgraded database must end up with
// exactly the functions, policies and grants of a fresh install — tests/sql/upgrade.test.ts compares the two.
const CORE_SECTIONS = ['audit', 'cms', 'booking', 'settings', 'patient']
for (const [name, file, body] of [['tenant-core', 'tenancy_core.sql', tenancyCoreSql],
  ['audit', 'audit.sql', auditSql], ['cms', 'cms.sql', cmsSql], ['booking', 'booking.sql', bookingSql], ['settings', 'settings.sql', settingsSql], ['patient', 'patient.sql', patientSql],
  ['scale', 'scale.sql', scaleSql], ['auth', 'auth.sql', authSql], ['forms', 'forms.sql', formsSql], ['messaging', 'messaging.sql', messagingSql], ['tenancy', 'tenancy.sql', tenancySql], ['billing', 'billing.sql', billingSql], ['control-panel', 'control_panel.sql', controlPanelSql], ['compliance', 'compliance.sql', complianceSql], ['signup', 'signup.sql', signupSql], ['launch', 'launch.sql', launchSql], ['integrity', 'integrity.sql', integritySql], ['control-ops', 'control_panel_ops.sql', controlOpsSql], ['platform-cms', 'platform_cms.sql', platformCmsSql], ['cp-notify', 'cp_notify.sql', cpNotifySql], ['otp-verify', 'otp_verify.sql', otpSql],
  ['notify-catalog', 'notify_catalog.sql', notifySql],
  ['plans', 'plans.sql', plansSql],
  ['signup-otp', 'signup_otp.sql', signupOtpSql],
  ['demo', 'demo.sql', demoSql],
  ['rbac', 'permissions.ts → policies', `-- role policies from src/auth/permissions.ts${policies(true)}`]] as const) {
  const block = `-- >>> ${name} (generated from ${file.endsWith('.sql') ? `scripts/sql/${file}` : file} — do not edit here)\n${body.trim()}\n-- <<< ${name}`
  const re = new RegExp(`-- >>> ${name}[\\s\\S]*?-- <<< ${name}`)
  // the tenancy core goes first (every later section may call current_tenant())
  nextUpgrade = re.test(nextUpgrade) ? nextUpgrade.replace(re, () => block)
    : name === 'tenant-core' ? nextUpgrade.replace(/\nbegin;\n/, () => `\nbegin;\n\n${block}\n`)
    // after the hand-written sections (which carry older versions of some functions), before the scale section
    : (CORE_SECTIONS as readonly string[]).includes(name) ? nextUpgrade.replace(/\n-- >>> scale /, () => `\n${block}\n\n-- >>> scale `)
    : nextUpgrade.replace(/\ncommit;\s*$/, () => `\n${block}\n\ncommit;\n`)
  if (!nextUpgrade.includes(`-- <<< ${name}`)) throw new Error(`could not place the ${name} section in upgrade-2026-10.sql`)
}
if (nextUpgrade !== upgrade) { writeFileSync(upgradePath, nextUpgrade); console.log('✔ supabase/upgrade-2026-10.sql generated sections updated') }

// ------------------------------------------------------------------ demo hospital (scripts/sql/demo.sql)
// Run once on a live project: makes the primary hospital (DC Hospital) the public demo, installs its demo data as a
// function (so the nightly / control-panel reset can load it again) and runs the first reset.
// the same seed as master.sql, but loaded after every module: the admissions integrity guard (integrity.sql) would
// refuse the demo's already-occupied beds, so every trigger on admissions is off while it loads
function demoSeedBody(): string {
  const body = seedSql()
  const off = 'alter table public.admissions disable trigger trg_admissions_sync;'
  const on = 'alter table public.admissions enable trigger trg_admissions_sync;'
  if (!body.includes(off) || !body.includes(on)) throw new Error('seedSql() changed: update demoSeedBody()')
  return body.replace(off, () => 'alter table public.admissions disable trigger user;').replace(on, () => 'alter table public.admissions enable trigger user;')
}
const demoLogins = JSON.stringify({ password: DEMO_PASSWORD, logins: DEMO_USERS.map((u) => ({ role: u.role, email: u.email, name: u.full_name })) }).replace(/'/g, "''")
const demoHospital = `-- =====================================================================================================
--  HOSPITAL COMRADE — DEMO HOSPITAL (generated by scripts/build-master-sql.ts — do not edit here)
--
--  Run this ONCE in the Supabase SQL editor, after master.sql / upgrade-2026-10.sql.
--  ⚠ It turns the PRIMARY hospital (DC Hospital, slug "main") into the public demo hospital:
--    ALL of its current patients, appointments, bills, sign-ups and messages are DELETED now and every night
--    at 03:00 IST, and replaced with the demo data. Do not run it if the primary hospital holds real data.
--  Every other hospital is untouched. Settings: control panel → Platform settings → Demo hospital.
--  Demo sign-in password: ${DEMO_PASSWORD}
-- =====================================================================================================
begin;

-- the demo data, with dates relative to the day it is loaded
create or replace function public.demo_seed_data()
returns void language plpgsql volatile security definer set search_path = public as $demo$
begin
${demoSeedBody()}
end $demo$;
revoke all on function public.demo_seed_data() from public, anon, authenticated;

-- the one-click sign-ins the demo login page offers
create or replace function public.demo_logins()
returns jsonb language sql immutable as $demo$ select '${demoLogins}'::jsonb $demo$;
revoke all on function public.demo_logins() from public, anon, authenticated;

update public.tenants set is_demo = true
 where is_primary and not exists (select 1 from public.tenants where is_demo and not is_primary);

select public.demo_reset();

commit;

-- Done ✔  —  Open the hospital site and use the demo sign-in buttons (password ${DEMO_PASSWORD}).
`
if (demoHospital.split('$demo$').length !== 5) throw new Error('the demo seed must not contain $demo$')
writeFileSync(resolve(root, 'supabase/demo-hospital.sql'), demoHospital)
console.log(`✔ supabase/demo-hospital.sql written (${(demoHospital.length / 1024).toFixed(0)} KB)`)
