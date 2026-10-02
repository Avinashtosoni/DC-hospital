/**
 * Control panel demo mode (no database): the same rules as scripts/sql/control_panel.sql, kept in this browser.
 * - sign in with the demo Hospital Comrade accounts (admin@ / support@ / finance@hospitalcomrade.demo, Demo@123)
 * - the two demo hospitals use the hospital app's demo billing store (src/billing/demo.ts), so a manual payment
 *   here shows up in that hospital's Settings → Plan & wallet; name / prefix / module locks apply to the demo app
 * - hospitals created here live only in this panel (the demo app has two fixed hospitals)
 */
import { computeLicense } from '../../src/billing/license'
import { demoBilling, demoLicense, demoProviderBilling, saveDemoBilling } from '../../src/billing/demo'
import type { PaymentRow } from '../../src/billing/types'
import { BILLING_DEFAULTS, type BillingConfig } from '../../src/platform/billing'
import { DEMO_PROVIDERS, DEMO_TENANT_EDITS_KEY, DEMO_TENANTS, type DemoProvider, type DemoTenantEdit } from '../../src/tenancy/demo'
import type { CpApi } from './api'
import type { CpAudit, CpHealth, CpHospital, CpHospitalDetail, CpIncident, CpLead, CpMe, CpMember, CpOverview, CpPayment, CpSignup, ModuleMap, ProviderRole, RetentionConfig, SignupSettings } from './types'
import { RETENTION_DEFAULTS, RETENTION_KEYS, RETENTION_MIN, SIGNUP_DEFAULTS } from './types'

const KEY = 'dch:cp:v1'
const SESSION = 'dch:cp:session:v1'
const LEADS = 'dch:platform-leads:v1'
const SIGNUPS = 'dch:platform-signups:v1'   // written by the product page's /signup in demo mode
const PASSWORD = 'Demo@123'
const DEFAULT_MODULES: ModuleMap = { dashboard: 'hospital', forms: 'hospital', notifications: 'hospital', security: 'hospital' }
const MODULE_KEYS = ['general', 'appearance', 'dashboard', 'notifications', 'forms', 'security', 'data', 'cms']

interface Created {
  id: string; slug: string; name: string; code: string; plan: string; created_at: string; modules: ModuleMap; notes: string | null
  owner_email: string; domain: string | null; trial_ends_at: string | null; paid_until: string | null; suspended: boolean
  wallet_paise: number; price: number | null; payments: PaymentRow[]
  closing_at?: string | null; purge_after?: string | null; close_reason?: string | null
}
interface Member { email: string; name: string; role: ProviderRole; active: boolean; hospitals: string[]; since: string }
interface Store {
  hospitals: Created[]
  /** demo hospitals' notes / owner e-mail (name, prefix, modules go to DEMO_TENANT_EDITS_KEY so the demo app sees them) */
  extra: Record<string, { notes?: string | null; owner_email?: string }>
  team: Member[] | null
  audit: CpAudit[]
  settings: Partial<BillingConfig>
  leads: Record<string, { status?: CpLead['status']; notes?: string | null }>
  seq: number
  incidents?: CpIncident[]
  retention?: RetentionConfig
  purged?: { slug: string; name: string; at: string }[]
  signup?: Partial<SignupSettings>
  signupDecisions?: Record<string, Partial<CpSignup>>
}

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
const iso = (ms = Date.now()) => new Date(ms).toISOString()
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms))
function read<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback } catch { return fallback }
}
function write(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } }

function load(): Store {
  return { hospitals: [], extra: {}, team: null, audit: [], settings: {}, leads: {}, seq: 100, ...read<Partial<Store>>(KEY, {}) }
}
const save = (s: Store) => write(KEY, s)

function config(s = load()): BillingConfig {
  const o = s.settings
  return {
    ...BILLING_DEFAULTS, ...o,
    ratesPaise: { ...BILLING_DEFAULTS.ratesPaise, ...o.ratesPaise },
    seller: { ...BILLING_DEFAULTS.seller, ...o.seller },
    plans: Object.fromEntries(Object.entries(BILLING_DEFAULTS.plans).map(([k, v]) => [k, { ...v, ...(o.plans as BillingConfig['plans'] | undefined)?.[k as keyof BillingConfig['plans']] }])) as BillingConfig['plans'],
  }
}

// ------------------------------------------------------------------ session
function team(s = load()): Member[] {
  return s.team ?? DEMO_PROVIDERS.map((p: DemoProvider) => ({
    email: p.email, name: p.full_name, role: p.role, active: true, since: '2026-04-01T09:00:00.000Z',
    hospitals: p.role === 'admin' ? [] : p.tenants ?? [],
  }))
}
function current(): Member | null {
  const email = read<string | null>(SESSION, null)
  return team().find((m) => m.email === email && m.active) ?? null
}
function need(roles: ProviderRole[] = ['admin', 'support', 'finance']): Member {
  const m = current()
  if (!m) throw new Error('Your session has expired — please sign in again.')
  if (!roles.includes(m.role)) throw new Error(`Only the Hospital Comrade team (${roles.join(' / ')}) can do this.`)
  return m
}
const can = (m: Member, id: string) => m.role === 'admin' || m.hospitals.includes(id)
const memberId = (email: string) => DEMO_PROVIDERS.find((p) => p.email === email)?.id ?? `demo-${email}`

function log(action: string, tenantId: string | null, target: string | null, detail: Record<string, unknown> | null) {
  const m = current(), s = load()
  s.audit.unshift({ id: uid(), at: iso(), user_name: m?.name ?? null, mode: m?.role ?? null, tenant_id: tenantId,
    hospital: tenantId ? rowsAll(s).find((h) => h.id === tenantId)?.name ?? null : null, action, target, detail })
  s.audit = s.audit.slice(0, 300)
  save(s)
}

// ------------------------------------------------------------------ hospitals
const DEMO_COUNTS: Record<string, { staff: number; patients: number }> = { main: { staff: 6, patients: 52 }, citycare: { staff: 5, patients: 18 } }

function rowsAll(s = load()): CpHospital[] {
  const cfg = config(s)
  const edits = read<Record<string, DemoTenantEdit>>(DEMO_TENANT_EDITS_KEY, {})
  const demo = DEMO_TENANTS.map((t): CpHospital => {
    const b = demoBilling(t.id)!, e = edits[t.id] ?? {}, x = s.extra[t.id] ?? {}
    const plan = b.plan
    return {
      id: t.id, slug: t.slug, name: e.name ?? t.name, code: e.code ?? t.code, plan, is_primary: !!t.is_primary, notes: x.notes ?? null,
      created_at: t.is_primary ? '2025-01-01T00:00:00.000Z' : iso(Date.now() - 5 * 864e5), modules: (e.modules ?? t.modules ?? {}) as ModuleMap,
      license: demoLicense(t.id, true)!, wallet_paise: b.wallet_paise,
      price: b.price ?? cfg.plans[plan as keyof BillingConfig['plans']]?.price ?? null,
      domain: t.domain, ...DEMO_COUNTS[t.slug], owner_joined: true, owner_email: x.owner_email ?? `owner@${t.email}`,
      messages: b.usage.sms + b.usage.whatsapp + b.usage.email,
      closing_at: b.closing_at ?? null, purge_after: b.purge_after ?? null, close_reason: b.close_reason ?? null,
    }
  })
  const made = s.hospitals.map((h): CpHospital => ({
    id: h.id, slug: h.slug, name: h.name, code: h.code, plan: h.plan, is_primary: false, notes: h.notes, created_at: h.created_at, modules: h.modules,
    license: { ...computeLicense({ status: h.suspended ? 'suspended' : 'trial', trial_ends_at: h.trial_ends_at, paid_until: h.paid_until, closing_at: h.closing_at, purge_after: h.purge_after }, cfg.graceDays), wallet_paise: h.wallet_paise },
    closing_at: h.closing_at ?? null, purge_after: h.purge_after ?? null, close_reason: h.close_reason ?? null,
    wallet_paise: h.wallet_paise, price: h.price ?? cfg.plans[h.plan as keyof BillingConfig['plans']]?.price ?? null,
    domain: h.domain, staff: 0, patients: 0, owner_joined: false, owner_email: h.owner_email, messages: 0,
  }))
  return [...demo, ...made]
}
function visible(m: Member) { return rowsAll().filter((h) => can(m, h.id)) }
function find(m: Member, id: string): CpHospital {
  const h = visible(m).find((x) => x.id === id)
  if (!h) throw new Error('Hospital not found or not assigned to you.')
  return h
}

function validModules(mod: unknown) {
  if (!mod || typeof mod !== 'object' || Object.entries(mod).some(([k, v]) => !MODULE_KEYS.includes(k) || (v !== 'hospital' && v !== 'provider'))) throw new Error('Unknown module setting')
}

// billing tools for hospitals created in the panel (the two demo hospitals use src/billing/demo.ts)
function createdBilling(h: Created, action: string, a: Record<string, unknown>, cfg: BillingConfig, s: Store) {
  const now = Date.now()
  if (action === 'manual_payment') {
    const kind = a.kind === 'wallet' ? 'wallet' : 'plan'
    const months = Number(a.months) || 1
    const price = h.price ?? cfg.plans[h.plan as keyof BillingConfig['plans']]?.price
    let base: number
    if (kind === 'plan') {
      if (!price) throw new Error('This plan is priced individually — set a price first (Plan & price).')
      base = Math.round(price * 100 * (months === 12 ? cfg.yearlyMonths : months))
      const start = Math.max(now, h.paid_until ? Date.parse(h.paid_until) : 0, h.trial_ends_at ? Date.parse(h.trial_ends_at) : 0)
      const d = new Date(start); d.setMonth(d.getMonth() + months); h.paid_until = d.toISOString()
    } else {
      const amt = Number(a.amount)
      if (!(amt >= cfg.minTopup && amt <= cfg.maxTopup)) throw new Error(`Top up between ₹${cfg.minTopup} and ₹${cfg.maxTopup.toLocaleString('en-IN')}.`)
      base = Math.round(amt * 100)
      h.wallet_paise += base
    }
    const gst = Math.round((base * cfg.gstPercent) / 100)
    s.seq += 1
    const invoice = `HC/2026-27/${String(s.seq).padStart(6, '0')}`
    h.payments.unshift({ id: uid(), created_at: iso(), kind, plan: kind === 'plan' ? h.plan : null, months: kind === 'plan' ? months : null, base_paise: base, gst_paise: gst,
      total_paise: base + gst, status: 'paid', provider: 'manual', method: String(a.method || 'bank'), paid_at: iso(), invoice_no: invoice, period_from: null, period_to: null })
    return { invoice_no: invoice }
  }
  if (action === 'wallet_adjust') {
    const amt = Number(a.amount)
    if (!amt || Math.abs(amt) > 100000) throw new Error('Enter an amount between -₹1,00,000 and ₹1,00,000.')
    if (!String(a.note ?? '').trim()) throw new Error('Add a note saying why.')
    h.wallet_paise += Math.round(amt * 100)
  } else if (action === 'extend_trial') {
    const days = Number(a.days)
    if (!(days >= 1 && days <= 90)) throw new Error('Extend by 1 to 90 days.')
    h.trial_ends_at = iso(Math.max(now, h.trial_ends_at ? Date.parse(h.trial_ends_at) : now) + days * 864e5)
  } else if (action === 'set_plan') {
    if (typeof a.plan === 'string') h.plan = a.plan
    if ('price' in a) h.price = a.price == null || a.price === '' ? null : Number(a.price)
  } else if (action === 'suspend') h.suspended = true
  else if (action === 'resume') h.suspended = false
  else throw new Error(`Unknown action ${action}`)
  return { ok: true }
}

function leadsAll(s = load()): CpLead[] {
  const raw = read<Array<Record<string, string>>>(LEADS, [])
  const sample: CpLead[] = [
    { id: 'demo-lead-1', created_at: iso(Date.now() - 2 * 3600e3), name: 'Dr. Priya Verma', organisation: 'Verma Eye Clinic', phone: '9835012345', email: 'priya@vermaeye.in',
      city: 'Gaya', plan: 'clinic', message: 'Need online booking and WhatsApp reminders for 2 doctors.', source: 'hospital.digitalcomrade.in', status: 'new', notes: null },
    { id: 'demo-lead-2', created_at: iso(Date.now() - 3 * 864e5), name: 'Rakesh Jha', organisation: 'Mithila Multispeciality Hospital', phone: '9431098765', email: null,
      city: 'Darbhanga', plan: 'hospital', message: '40 beds, IPD + pharmacy. Want a demo this week.', source: 'hospital.digitalcomrade.in', status: 'contacted', notes: 'Demo fixed for Friday 11 am' },
  ]
  const fromForm: CpLead[] = raw.map((l, i) => ({ id: `demo-form-${l.created_at ?? i}`, created_at: l.created_at ?? iso(), name: l.name, organisation: l.organisation, phone: l.phone,
    email: l.email || null, city: l.city || null, plan: l.plan || null, message: l.message || null, source: 'this browser (demo)', status: 'new', notes: null }))
  return [...fromForm, ...sample].map((l) => ({ ...l, ...s.leads[l.id] }))
}

// ------------------------------------------------------------------ API
export const demoCp: CpApi = {
  async signIn(email, password) {
    await wait(350)
    const m = team().find((x) => x.email === email.trim().toLowerCase())
    if (!m || password !== PASSWORD) throw new Error('Wrong e-mail or password.')
    if (!m.active) throw new Error('This account is not on the Hospital Comrade team. Hospital staff sign in on their hospital’s website.')
    write(SESSION, m.email)
    return (await this.me())!
  },
  async signOut() { try { localStorage.removeItem(SESSION) } catch { /* ignore */ } },
  async me(): Promise<CpMe | null> {
    const m = current()
    return m ? { user_id: memberId(m.email), role: m.role, email: m.email, full_name: m.name } : null
  },

  async overview(): Promise<CpOverview> {
    await wait()
    const m = need()
    const h = visible(m), paying = h.filter((x) => !x.is_primary)
    const count = (f: (x: CpHospital) => string) => paying.reduce<Record<string, number>>((a, x) => ({ ...a, [f(x)]: (a[f(x)] ?? 0) + 1 }), {})
    const soon = Date.now() + 7 * 864e5
    const pays = m.role === 'support' ? null : (await this.payments()).filter((p) => p.status === 'paid' && Date.parse(p.paid_at ?? p.created_at) > Date.now() - 30 * 864e5)
    const msgs = { sms: 0, whatsapp: 0, email: 0 }
    for (const t of DEMO_TENANTS) if (can(m, t.id)) { const u = demoBilling(t.id)!.usage; msgs.sms += u.sms; msgs.whatsapp += u.whatsapp; msgs.email += u.email }
    return {
      hospitals: h.length, by_status: count((x) => x.license.status), by_plan: count((x) => x.plan),
      mrr: paying.filter((x) => x.license.status === 'active' && x.license.paid_until).reduce((a, x) => a + (x.price ?? 0), 0),
      wallet_paise: paying.reduce((a, x) => a + x.wallet_paise, 0),
      attention: paying.filter((x) => ['grace', 'read_only'].includes(x.license.status)
          || (['trial', 'active'].includes(x.license.status) && Date.parse(x.license.paid_until ?? x.license.trial_ends_at ?? '9999') < soon))
        .map((x) => ({ id: x.id, name: x.name, status: x.license.status, until: x.license.paid_until ?? x.license.trial_ends_at, read_only_from: x.license.read_only_from })),
      payments_30d_paise: pays ? pays.reduce((a, p) => a + p.total_paise, 0) : null,
      messages: msgs,
      leads_new: m.role === 'admin' ? leadsAll().filter((l) => l.status === 'new').length : null,
    }
  },

  async hospitals() { await wait(); return visible(need()) },

  async hospital(id): Promise<CpHospitalDetail> {
    await wait()
    const m = need(), h = find(m, id), s = load()
    const created = s.hospitals.find((x) => x.id === id)
    const b = created ? null : demoBilling(id)
    return {
      ...h,
      domains: h.domain ? [{ domain: h.domain, is_primary: true, method: 'demo', status: 'active', ssl_status: 'active', verified_at: h.created_at }] : [],
      team: team(s).filter((x) => x.active && (x.role === 'admin' || x.hospitals.includes(id))).map((x) => ({ user_id: memberId(x.email), role: x.role, name: x.name })),
      usage: b ? { 'sms:platform': b.usage.sms, 'whatsapp:platform': b.usage.whatsapp, 'email:platform': b.usage.email } : {},
      payments: m.role === 'support' ? [] : (created ? created.payments : b!.payments).filter((p) => p.status !== 'created'),
    }
  },

  async createHospital(p) {
    await wait(450)
    need(['admin'])
    const s = load(), cfg = config(s)
    const slug = p.slug.trim().toLowerCase(), code = p.code.trim().toUpperCase(), owner = p.owner_email.trim().toLowerCase()
    const domain = p.domain.trim().toLowerCase().replace(/^https?:\/\/|\/.*$/g, '')
    if (!/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) throw new Error('Short name: 2–40 characters, a-z, 0-9 and -, e.g. citycare')
    if (p.name.trim().length < 2) throw new Error('Enter the hospital’s name.')
    if (!/^[A-Z]{2,6}$/.test(code)) throw new Error('Record prefix: 2–6 capital letters, e.g. CCC')
    if (!(p.plan in cfg.plans)) throw new Error(`Unknown plan ${p.plan}`)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner)) throw new Error('Enter the owner’s e-mail.')
    if (!(p.trial_days >= 1 && p.trial_days <= 90)) throw new Error('Trial: 1 to 90 days.')
    if (domain && !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) throw new Error('That address does not look like a domain (e.g. citycareclinic.in).')
    const all = rowsAll(s)
    if (all.some((h) => h.slug === slug)) throw new Error(`The short name ${slug} is taken.`)
    if (domain && all.some((h) => h.domain === domain)) throw new Error(`${domain} already belongs to a hospital.`)
    if (all.some((h) => h.owner_email === owner) || team(s).some((m) => m.email === owner)) throw new Error(`${owner} is already used by another hospital or the platform team — one account = one hospital, please use another e-mail.`)
    validModules(p.modules)
    const now = Date.now()
    const h: Created = {
      id: uid(), slug, name: p.name.trim(), code, plan: p.plan, created_at: iso(now), modules: p.modules ?? DEFAULT_MODULES, notes: p.notes.trim() || null,
      owner_email: owner, domain: domain || null, suspended: false, wallet_paise: 0, price: null, payments: [],
      trial_ends_at: p.status === 'trial' ? iso(now + p.trial_days * 864e5) : null,
      paid_until: p.status === 'active' ? (() => { const d = new Date(now); d.setMonth(d.getMonth() + Math.max(1, Math.min(36, p.months || 12))); return d.toISOString() })() : null,
    }
    s.hospitals.push(h); save(s)
    log('hospital:create', h.id, slug, { plan: p.plan, status: p.status, owner, domain: domain || null })
    return { id: h.id, slug, domain: domain || null, owner_email: owner }
  },

  async updateHospital(id, p) {
    await wait()
    const m = need(['admin'])
    const h = find(m, id), s = load()
    if (p.name !== undefined && p.name.trim().length < 2) throw new Error('Enter the hospital’s name.')
    if (p.code !== undefined && !/^[A-Z]{2,6}$/.test(p.code.trim().toUpperCase())) throw new Error('Record prefix: 2–6 capital letters')
    if (p.modules !== undefined) validModules(p.modules)
    if (p.owner_email !== undefined) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.owner_email.trim())) throw new Error('Enter the owner’s e-mail.')
      if (h.owner_joined) throw new Error('The owner has already signed up — change owners in the hospital’s Users & accounts.')
    }
    const created = s.hospitals.find((x) => x.id === id)
    if (created) {
      if (p.name !== undefined) created.name = p.name.trim()
      if (p.code !== undefined) created.code = p.code.trim().toUpperCase()
      if (p.notes !== undefined) created.notes = p.notes.trim() || null
      if (p.modules !== undefined) created.modules = p.modules
      if (p.owner_email !== undefined) created.owner_email = p.owner_email.trim().toLowerCase()
    } else {
      const edits = read<Record<string, DemoTenantEdit>>(DEMO_TENANT_EDITS_KEY, {})
      const e = { ...edits[id] }
      if (p.name !== undefined) e.name = p.name.trim()
      if (p.code !== undefined) e.code = p.code.trim().toUpperCase()
      if (p.modules !== undefined) e.modules = p.modules
      write(DEMO_TENANT_EDITS_KEY, { ...edits, [id]: e })
      if (p.notes !== undefined) s.extra[id] = { ...s.extra[id], notes: p.notes.trim() || null }
    }
    save(s)
    log('hospital:update', id, h.slug, p as Record<string, unknown>)
    return rowsAll().find((x) => x.id === id)!
  },

  async billing(id, action, args) {
    await wait()
    const m = need(['admin', 'finance'])
    const h = find(m, id)
    if (m.role === 'finance' && !['manual_payment', 'wallet_adjust'].includes(action)) throw new Error('Only a Hospital Comrade admin can do this.')
    const s = load()
    const created = s.hospitals.find((x) => x.id === id)
    let r: unknown
    if (created) { r = createdBilling(created, action, args, config(s), s); save(s) } else {
      demoProviderBilling(id, action, args)
      r = action === 'manual_payment' ? { invoice_no: demoBilling(id)!.payments[0]?.invoice_no } : { ok: true }
    }
    log(`billing:${action}`, id, h.slug, args)
    return r
  },

  async team(): Promise<CpMember[]> {
    await wait()
    need(['admin'])
    const s = load(), names = Object.fromEntries(rowsAll(s).map((h) => [h.id, h.name]))
    return team(s).map((m) => ({
      user_id: memberId(m.email), email: m.email, name: m.name, role: m.role, active: m.active, since: m.since,
      hospitals: m.role === 'admin' ? [] : m.hospitals.filter((id) => names[id]).map((id) => ({ id, name: names[id] })),
      last_action: s.audit.find((a) => a.user_name === m.name)?.at ?? null,
    }))
  },

  async saveMember(p) {
    await wait()
    const me = need(['admin'])
    const s = load(), list = team(s), email = p.email.trim().toLowerCase()
    const existing = list.find((m) => m.email === email)
    if (email === me.email && (p.role !== 'admin' || !p.active)) throw new Error('You can’t remove your own admin access — ask another admin.')
    if (!existing) {
      // demo: only …@hospitalcomrade.demo addresses "have an account"
      if (!email.endsWith('@hospitalcomrade.demo')) throw new Error(`No account with ${email} yet — ask them to create one first (Sign up on the platform site), then add them here. (Demo: use an …@hospitalcomrade.demo address.)`)
      if (rowsAll(s).some((h) => h.owner_email === email)) throw new Error(`${email} is a staff account at a hospital — one account = one hospital, please use another e-mail.`)
      const name = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      list.push({ email, name, role: p.role, active: p.active, hospitals: [], since: iso() })
    }
    const m = list.find((x) => x.email === email)!
    m.role = p.role; m.active = p.active; m.hospitals = p.role === 'admin' ? [] : p.hospitals
    s.team = list; save(s)
    log('team:save', null, email, { role: p.role, active: p.active, hospitals: p.hospitals })
  },

  async leads() { await wait(); need(['admin']); return leadsAll() },
  async updateLead(id, patch) {
    await wait(150)
    need(['admin'])
    const s = load()
    s.leads[id] = { ...s.leads[id], ...patch }
    save(s)
  },

  async payments(tenantId) {
    await wait(150)
    const m = need(['admin', 'finance'])
    const s = load()
    const out: CpPayment[] = []
    for (const h of visible(m)) {
      if (tenantId && h.id !== tenantId) continue
      const created = s.hospitals.find((x) => x.id === h.id)
      const list = created ? created.payments : demoBilling(h.id)?.payments ?? []
      for (const p of list) if (p.status !== 'created') out.push({ ...p, tenant_id: h.id, hospital: h.name })
    }
    return out.sort((a, b) => b.created_at.localeCompare(a.created_at))
  },

  async audit(tenantId) {
    await wait(150)
    need(['admin'])
    return load().audit.filter((a) => !tenantId || a.tenant_id === tenantId)
  },

  async settings() { await wait(); need(['admin']); return { billing: config() } },

  async saveBillingSettings(p) {
    await wait()
    need(['admin'])
    const allowed = ['gstPercent', 'trialDays', 'graceDays', 'yearlyMonths', 'minTopup', 'maxTopup', 'ratesPaise', 'plans', 'seller']
    for (const k of Object.keys(p)) if (!allowed.includes(k)) throw new Error(`Unknown setting ${k}`)
    const n = (k: keyof BillingConfig) => (p[k] === undefined ? null : Number(p[k]))
    const bad = (k: keyof BillingConfig, lo: number, hi: number) => { const v = n(k); return v !== null && (!Number.isFinite(v) || v < lo || v > hi) }
    for (const [k, lo, hi] of [['gstPercent', 0, 40], ['trialDays', 0, 90], ['graceDays', 0, 90], ['yearlyMonths', 1, 12], ['minTopup', 0, 1e7], ['maxTopup', 0, 1e7]] as const) {
      if (bad(k, lo, hi)) throw new Error(`The value for ${k} is out of range.`)
    }
    const s = load(), cur = config(s)
    if ((p.minTopup ?? cur.minTopup) > (p.maxTopup ?? cur.maxTopup)) throw new Error('The minimum top-up is above the maximum.')
    if (p.ratesPaise && Object.values(p.ratesPaise).some((v) => !(Number(v) >= 0 && Number(v) <= 1000))) throw new Error('Message rates: paise per message, 0–1000.')
    s.settings = {
      ...s.settings, ...p,
      ratesPaise: { ...cur.ratesPaise, ...p.ratesPaise },
      seller: { ...cur.seller, ...p.seller },
      plans: Object.fromEntries(Object.entries(cur.plans).map(([k, v]) => [k, { ...v, ...p.plans?.[k as keyof BillingConfig['plans']] }])) as BillingConfig['plans'],
    }
    save(s)
    log('settings:billing', null, null, p as Record<string, unknown>)
    return config(s)
  },

  // ------------------------------------------------------------------ phase 7 (same rules as scripts/sql/compliance.sql)
  async closeHospital(id, reason, days) {
    await wait()
    const m = need(['admin']), h = find(m, id)
    if (h.is_primary) throw new Error('The platform’s own hospital cannot be closed.')
    if (reason.trim().length < 3) throw new Error('Write the reason for closing (the owner is told).')
    if (!(days >= 7 && days <= 90)) throw new Error('Notice period: 7 to 90 days.')
    if (h.closing_at) throw new Error('This hospital is already closing.')
    const at = iso(), purge = iso(Date.now() + days * 864e5)
    setClosing(id, { closing_at: at, purge_after: purge, close_reason: reason.trim() })
    log('hospital:close', id, h.slug, { reason: reason.trim(), days })
    return { closing_at: at, purge_after: purge }
  },

  async reopenHospital(id) {
    await wait()
    const m = need(['admin']), h = find(m, id)
    if (!h.closing_at) throw new Error('This hospital is not closing.')
    setClosing(id, { closing_at: null, purge_after: null, close_reason: null })
    log('hospital:reopen', id, h.slug, null)
    return { ok: true }
  },

  async demoEndNotice(id) {
    await wait(150)
    const m = need(['admin']), h = find(m, id)
    if (!h.closing_at) throw new Error('Close the hospital first.')
    setClosing(id, { closing_at: h.closing_at, purge_after: iso(Date.now() - 60_000), close_reason: h.close_reason ?? null })
  },

  async purgeHospital(id, confirmSlug, password) {
    await wait(500)
    const m = need(['admin'])
    if (password !== PASSWORD) throw new Error('Wrong password.')
    const h = find(m, id)
    if (h.is_primary) throw new Error('The platform’s own hospital cannot be deleted.')
    if (!h.closing_at) throw new Error('Close the hospital first — the owner gets a notice period to download their data.')
    if (h.purge_after && Date.parse(h.purge_after) > Date.now()) throw new Error(`The hospital can export its data until ${new Date(h.purge_after).toLocaleDateString('en-IN')} — delete after that.`)
    if (confirmSlug.trim().toLowerCase() !== h.slug) throw new Error(`Type the short name (${h.slug}) to confirm.`)
    const s = load()
    if (!s.hospitals.some((x) => x.id === id)) throw new Error('The two demo hospitals can’t be deleted in the demo — try it with a hospital you created here.')
    s.hospitals = s.hospitals.filter((x) => x.id !== id)
    s.purged = [{ slug: h.slug, name: h.name, at: iso() }, ...(s.purged ?? [])]
    save(s)
    const counts = { patients: h.patients, staff: h.staff }
    log('hospital:purge', id, h.slug, { name: h.name, counts })
    return { purged: h.slug, counts }
  },

  async health(): Promise<CpHealth> {
    await wait()
    const m = need(['admin', 'support'])
    const rows = visible(m), s = load(), now = Date.now()
    const ago = (min: number) => iso(now - min * 60_000)
    return {
      at: iso(),
      extensions: { pg_cron: true, pg_net: true },
      jobs: [
        { name: 'dch-notify-flush', schedule: '* * * * *', active: true, last_run: ago(0.4), last_status: 'succeeded', last_message: null },
        { name: 'dch-scheduled-messages', schedule: '*/5 * * * *', active: true, last_run: ago(3), last_status: 'succeeded', last_message: null },
        { name: 'dch-appointment-reminders', schedule: '30 12 * * *', active: true, last_run: ago(60 * 5), last_status: 'succeeded', last_message: null },
        { name: 'dch-billing-reminders', schedule: '0 4 * * *', active: true, last_run: ago(60 * 14), last_status: 'succeeded', last_message: null },
        { name: 'dch-retention', schedule: '30 21 * * *', active: true, last_run: retention(s).last_run?.at ?? ago(60 * 20), last_status: 'succeeded', last_message: null },
      ],
      messages: rows.filter((h) => h.messages > 0).map((h) => ({ id: h.id, name: h.name, sent: Math.round(h.messages / 20), failed: h.slug === 'citycare' ? 2 : 0, waiting: 0, stuck: 0 })),
      recent_failures: rows.some((h) => h.slug === 'citycare') ? [
        { at: ago(95), hospital: rows.find((h) => h.slug === 'citycare')!.name, event: 'appointment_booked', channel: 'sms', error: 'DLT template not approved for this sender id' },
        { at: ago(60 * 7), hospital: rows.find((h) => h.slug === 'citycare')!.name, event: 'appointment_reminder', channel: 'whatsapp', error: 'Recipient is not on WhatsApp' },
      ] : [],
      payments: { abandoned_7d: 1, failed_7d: 0, paid_7d: rows.reduce((n, h) => n + (demoBilling(h.id)?.payments.filter((p) => p.status === 'paid' && p.paid_at && Date.parse(p.paid_at) > now - 7 * 864e5).length ?? 0), 0) },
      database: { size_bytes: 48_234_496, largest_tables: m.role === 'admin' ? [
        { table: 'audit_log', bytes: 14_680_064 }, { table: 'notification_outbox', bytes: 9_437_184 }, { table: 'appointments', bytes: 4_194_304 }, { table: 'patients', bytes: 2_621_440 },
      ] : [] },
      hospitals: rows.map((h) => ({ id: h.id, name: h.name, closing_at: h.closing_at ?? null, purge_after: h.purge_after ?? null, patients: h.patients, appointments: h.patients * 3, invoices: h.patients * 2, audit_log: h.patients * 11 })),
      retention: retention(s).last_run ?? null,
      privacy_open: 0,
      privacy_overdue: 0,
      incidents_open: (s.incidents ?? []).filter((i) => i.status !== 'resolved').length,
    }
  },

  async incidents() {
    await wait()
    need(['admin', 'support'])
    const names = Object.fromEntries(rowsAll().map((h) => [h.id, h]))
    return [...(load().incidents ?? [])]
      .map((i) => ({ ...i, hospitals: i.affected_tenants.filter((t) => names[t]).map((t) => ({ id: t, name: names[t].name, slug: names[t].slug })) }))
      .sort((a, b) => Number(a.status === 'resolved') - Number(b.status === 'resolved') || b.detected_at.localeCompare(a.detected_at))
  },

  async saveIncident(p) {
    await wait()
    const m = need(['admin'])
    const s = load(), list = s.incidents ?? [], now = iso()
    let i: CpIncident
    if (!p.id) {
      const title = (p.title ?? '').trim()
      if (title.length < 3) throw new Error('Give the incident a short title.')
      const detected = p.detected_at ?? now
      i = { id: uid(), created_at: now, updated_at: now, detected_at: detected, title, description: p.description ?? null, severity: p.severity ?? 'medium', status: 'open',
        personal_data: !!p.personal_data, affected_tenants: p.affected_tenants ?? [], affected_people: p.affected_people ?? null, board_reported_at: null,
        hospitals_notified_at: null, resolved_at: null, timeline: [{ at: now, by: m.name, note: p.note || 'Incident recorded' }], created_by_name: m.name,
        deadline: iso(Date.parse(detected) + 72 * 3600_000), hospitals: [] }
      list.unshift(i)
    } else {
      const found = list.find((x) => x.id === p.id)
      if (!found) throw new Error('Incident not found')
      i = found
      const statusChanged = p.status && p.status !== i.status
      const note = [statusChanged ? `Status: ${p.status}` : '', p.note ?? ''].filter(Boolean).join(' — ')
      Object.assign(i, {
        ...(p.title?.trim() ? { title: p.title.trim() } : {}),
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.severity ? { severity: p.severity } : {}),
        ...(p.status ? { status: p.status, resolved_at: p.status === 'resolved' ? i.resolved_at ?? now : null } : {}),
        ...(p.personal_data !== undefined ? { personal_data: p.personal_data } : {}),
        ...(p.affected_tenants ? { affected_tenants: p.affected_tenants } : {}),
        ...(p.affected_people !== undefined ? { affected_people: p.affected_people } : {}),
        ...(p.board_reported ? { board_reported_at: i.board_reported_at ?? now } : {}),
        updated_at: now,
      })
      if (note) i.timeline = [...i.timeline, { at: now, by: m.name, note }]
    }
    s.incidents = list
    save(s)
    log('incident:save', null, i.id, { title: i.title, status: i.status })
    return i
  },

  async notifyIncident(id, message) {
    await wait(400)
    const m = need(['admin'])
    const s = load(), i = (s.incidents ?? []).find((x) => x.id === id)
    if (!i) throw new Error('Incident not found')
    if (!message.trim()) throw new Error('Write the notice: what happened, what data, what you are doing, what they should do.')
    if (!i.affected_tenants.length) throw new Error('Add the affected hospitals first.')
    const rows = rowsAll(s).filter((h) => i.affected_tenants.includes(h.id))
    const r = rows.map((h) => ({ id: h.id, name: h.name, owner_email: h.owner_email, queued: h.owner_email ? 1 : 0 }))
    i.hospitals_notified_at = iso()
    i.timeline = [...i.timeline, { at: iso(), by: m.name, note: `Hospitals notified (${r.length})` }]
    save(s)
    log('incident:notify', null, id, { hospitals: r })
    return r
  },

  async retention() { await wait(); need(['admin']); return retention() },

  async saveRetention(p) {
    await wait()
    need(['admin'])
    for (const [k, v] of Object.entries(p)) {
      if (!(RETENTION_KEYS as readonly string[]).includes(k)) throw new Error(`Unknown setting ${k}`)
      const min = RETENTION_MIN[k as keyof typeof RETENTION_MIN]
      if (!(Number.isInteger(v) && (v as number) >= min && (v as number) <= 3650)) throw new Error(`${k}: keep at least ${min} days (at most 3650).`)
    }
    const s = load()
    s.retention = { ...retention(s), ...p }
    save(s)
    log('settings:retention', null, null, p as Record<string, unknown>)
    return retention(s)
  },

  async runRetention() {
    await wait(600)
    need(['admin'])
    const s = load()
    const deleted = { audit_log: 0, provider_audit: Math.max(0, s.audit.length - 250), notification_outbox: 0, booking_otps: 3, password_reset_otps: 1, site_enquiries: 0, platform_leads: 0, privacy_requests: 0, wa_sessions: 2 }
    s.audit = s.audit.slice(0, 250)
    s.retention = { ...retention(s), last_run: { at: iso(), deleted } }
    save(s)
    return deleted
  },

  async signups() { await wait(); need(['admin']); return signupsAll() },

  async decideSignup(id, action, reason) {
    await wait(400)
    const m = need(['admin'])
    const row = signupsAll().find((x) => x.id === id)
    if (!row) throw new Error('Sign-up not found')
    if (row.status !== 'pending') throw new Error('This sign-up was already handled.')
    let patch: Partial<CpSignup>
    if (action === 'approve') {
      const taken = new Set(rowsAll().map((h) => h.slug))
      let slug = row.slug, i = 1
      while (taken.has(slug)) slug = `${row.slug}-${++i}`
      const h = await demoCp.createHospital({ slug, name: row.organisation, code: row.code, plan: row.plan, owner_email: row.email, domain: '', status: 'trial',
        trial_days: row.trial_days, months: 12, modules: DEFAULT_MODULES, notes: `Self-service sign-up · ${row.contact_name} · ${row.phone}${row.city ? ` · ${row.city}` : ''} · Terms ${row.terms_version}` })
      patch = { status: 'created', hospital_id: h.id, hospital_slug: h.slug, slug: h.slug, owner_joined: false }
    } else {
      patch = { status: 'rejected', reason: reason?.trim().slice(0, 300) || null }
    }
    const s = load()
    s.signupDecisions = { ...s.signupDecisions, [id]: { ...patch, decided_at: iso(), decided_by_name: m.name } }
    save(s)
    log(`signup:${action}`, patch.hospital_id ?? null, row.organisation, { email: row.email, reason: reason ?? null })
    return { ...row, ...s.signupDecisions[id] }
  },

  async signupSettings() { await wait(); need(['admin']); return { ...signupSettings(), pending: signupsAll().filter((x) => x.status === 'pending').length } },

  async saveSignupSettings(p) {
    await wait()
    need(['admin'])
    if (p.mode !== undefined && !['instant', 'approve'].includes(p.mode)) throw new Error('Mode: instant or approve.')
    if (p.trialDays !== undefined && !(Number.isInteger(p.trialDays) && p.trialDays >= 1 && p.trialDays <= 90)) throw new Error('Trial: 1 to 90 days.')
    if (p.plan !== undefined && !(p.plan in config().plans)) throw new Error(`Unknown plan ${p.plan}`)
    if (p.maxPerDay !== undefined && !(Number.isInteger(p.maxPerDay) && p.maxPerDay >= 1 && p.maxPerDay <= 1000)) throw new Error('Sign-ups per day: 1 to 1000.')
    if (p.unclaimedDays !== undefined && !(Number.isInteger(p.unclaimedDays) && p.unclaimedDays >= 3 && p.unclaimedDays <= 90)) throw new Error('Unclaimed trials: close after 3 to 90 days.')
    if (p.platformUrl !== undefined && !/^(https:\/\/[a-z0-9.-]+(:[0-9]+)?\/?)?$/.test(p.platformUrl)) throw new Error('Website: https://your-domain (or leave empty).')
    const s = load()
    const { pending: _p, ...clean } = p
    s.signup = { ...s.signup, ...clean }
    save(s)
    log('settings:signup', null, null, clean as Record<string, unknown>)
    return demoCp.signupSettings()
  },
}

function signupSettings(s = load()): SignupSettings { return { ...SIGNUP_DEFAULTS, ...s.signup } }
const slugify = (n: string) => { const b = n.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30); return b.length >= 3 ? b : 'hospital' }
const initials = (n: string) => {
  const w = n.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((x) => x && !['THE', 'AND', 'OF', 'PVT', 'LTD'].includes(x))
  const v = (w.length >= 2 ? w.map((x) => x[0]).join('') : (w[0] ?? '').slice(0, 3)).slice(0, 6)
  return v.length >= 2 ? v : 'HC'
}
/** sample requests + the ones made on this browser's product page (/signup), with the decisions taken here */
function signupsAll(s = load()): CpSignup[] {
  const days = signupSettings(s).trialDays
  const base = (o: Partial<CpSignup> & Pick<CpSignup, 'id' | 'organisation' | 'contact_name' | 'email' | 'phone'>): CpSignup => ({
    created_at: iso(), city: null, plan: 'clinic', trial_days: days, slug: slugify(o.organisation), code: initials(o.organisation), status: 'pending',
    hospital_id: null, terms_version: '2026-10-02', decided_at: null, decided_by_name: null, reason: null, ...o })
  const raw = read<{ organisation: string; name: string; email: string; phone: string; city?: string; plan?: string; terms_version?: string; created_at?: string }[]>(SIGNUPS, [])
  const fromForm = raw.map((r, i) => base({ id: `demo-signup-${r.created_at ?? i}`, created_at: r.created_at ?? iso(), organisation: r.organisation.trim(), contact_name: r.name.trim(),
    email: r.email.trim().toLowerCase(), phone: r.phone.replace(/\D/g, '').slice(-10), city: r.city?.trim() || null, plan: r.plan || 'clinic', terms_version: r.terms_version ?? '2026-10-02' }))
  const sample = [
    base({ id: 'demo-signup-1', created_at: iso(Date.now() - 3 * 36e5), organisation: 'Sunrise Care Clinic', contact_name: 'Dr. Meera Jha', email: 'meera@sunriseclinic.in', phone: '9876543210', city: 'Purnia' }),
    base({ id: 'demo-signup-2', created_at: iso(Date.now() - 26 * 36e5), organisation: 'Kosi Multispeciality Hospital', contact_name: 'Rakesh Singh', email: 'admin@kosihospital.in', phone: '9431012345', city: 'Saharsa', plan: 'hospital' }),
    base({ id: 'demo-signup-3', created_at: iso(Date.now() - 5 * 864e5), organisation: 'Test', contact_name: 'asdf', email: 'asdf@mailinator.com', phone: '9000000000', status: 'rejected', reason: 'Not a real hospital', decided_at: iso(Date.now() - 4 * 864e5), decided_by_name: 'Aman Sinha' }),
  ]
  const hospitals = new Map(rowsAll(s).map((h) => [h.id, h]))
  return [...fromForm, ...sample].map((r) => {
    const x = { ...r, ...s.signupDecisions?.[r.id] }
    return x.hospital_id ? { ...x, owner_joined: hospitals.get(x.hospital_id)?.owner_joined ?? false } : x
  }).sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.created_at.localeCompare(a.created_at))
}

/** demo hospitals keep it in their billing store (so the hospital app shows the closing banner); created ones here */
function setClosing(id: string, v: { closing_at: string | null; purge_after: string | null; close_reason: string | null }) {
  const s = load(), created = s.hospitals.find((x) => x.id === id)
  if (created) { Object.assign(created, v); save(s); return }
  const b = demoBilling(id)
  if (b) saveDemoBilling(id, { ...b, ...v })
}
function retention(s = load()): RetentionConfig { return { ...RETENTION_DEFAULTS, ...s.retention } }
