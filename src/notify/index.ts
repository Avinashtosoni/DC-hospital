/**
 * The full template library (catalog.ts + the 17 original events from src/settings/types.ts), used by the control
 * panel's Template manager, the hospital's Settings → Notifications and scripts/build-master-sql.ts (notify_catalog()).
 */
import { DEFAULT_APP_SETTINGS, DEFAULT_TEMPLATES, EVENTS, type OriginalEvent } from '../settings/types'
import { NEW_HOSPITAL_EVENTS, ORIGINAL_META, PLATFORM_ALERT_EVENTS, PLATFORM_OWNER_EVENTS, type CatalogCopy, type CatalogEntry, type EvChannel } from './catalog'

export * from './catalog'

const original = (id: OriginalEvent): CatalogEntry => {
  const e = EVENTS.find((x) => x.id === id)!
  const m = ORIGINAL_META[id]
  const t = DEFAULT_TEMPLATES[id]
  const channels: EvChannel[] = [...e.channels, ...(m.inapp ? (['inapp'] as const) : [])]
  const saved = DEFAULT_APP_SETTINGS.notifications.events[id] ?? {}
  return {
    id, code: m.code, group: m.group, scope: 'hospital', audience: m.audience, label: e.label, hint: e.hint, channels,
    defaults: Object.fromEntries(channels.map((c) => [c, !!saved[c]])), tokens: e.tokens, waCategory: m.waCategory,
    copy: { subject: t.subject, text: t.text, waText: t.waText ?? '', pushText: t.pushText ?? '', waParams: t.waParams ?? '' },
  }
}

/** every template, in display order (by ID) */
export const CATALOG: CatalogEntry[] = [
  ...(Object.keys(ORIGINAL_META) as OriginalEvent[]).map(original),
  ...NEW_HOSPITAL_EVENTS,
  ...PLATFORM_OWNER_EVENTS,
  ...PLATFORM_ALERT_EVENTS,
].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))

export const catalogEntry = (id: string) => CATALOG.find((e) => e.id === id)

/** the control panel's saved version of one template (public.platform_templates) */
export interface PlatformTemplate {
  key: string
  /** false = never sent, for every hospital */
  enabled: boolean
  /** true = hospitals cannot reword it (their saved wording is ignored) */
  locked: boolean
  /** per channel: false = switched off for every hospital; true = on by default for platform messages */
  channels: Partial<Record<EvChannel, boolean>>
  /** wording + WhatsApp / DLT registration on the shared accounts; empty fields fall back to the catalog */
  tpl: Partial<CatalogCopy> & { waTemplate?: string; waCategory?: string; smsTemplateId?: string; waStatus?: 'draft' | 'submitted' | 'approved' | 'rejected' }
  /** custom templates only (added in the control panel, used by Broadcasts) */
  custom?: boolean
  meta?: { label?: string; group?: string; audience?: string; hint?: string; channels?: EvChannel[] }
  updated_at?: string | null
}

/** the wording that will go out: catalog default ⊕ the control panel's edits (empty = default) */
export function effectiveCopy(e: CatalogEntry | undefined, p?: PlatformTemplate | null): CatalogCopy {
  const base: CatalogCopy = { subject: '', text: '', waText: '', pushText: '', waParams: '', ...(e?.copy ?? {}) }
  if (!p) return base
  const out = { ...base }
  for (const k of ['subject', 'text', 'waText', 'pushText', 'waParams'] as const) {
    const v = p.tpl?.[k]
    if (typeof v === 'string' && v.trim() !== '') out[k] = v
  }
  return out
}

/** fill {tokens} for a preview */
export const renderTokens = (s: string, vars: Record<string, string>) => s.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))

/** sample values for previews */
export const SAMPLE_VARS: Record<string, string> = {
  name: 'Priya', patient: 'Priya Sharma', doctor: 'Dr. Arjun Mehta', date: 'Mon, 12 Oct 2026', time: '10:30 AM', ref: 'BK7Q2M', hospital: 'City Care Hospital',
  hospital_phone: '+91 98765 43210', address: 'Station Road, Gaya', site_url: 'https://citycare.example.in', link: 'https://citycare.example.in/portal',
  code: '482913', role: 'Receptionist', email: 'priya@example.in', changes: 'mobile: +91 98765 11111', title: 'OPD timings change', notice: 'OPD closes at 6 pm on Sunday.',
  priority: 'urgent', invoice: 'INV-2026-0142', amount: '₹1,850.00', due_date: '20 Oct 2026', method: 'UPI', test: 'CBC', device: 'Chrome on Windows',
  member: 'Rahul Verma', kind: 'leave', from: '14 Oct 2026', to: '16 Oct 2026', reason: 'Family function', mrn: 'CCH-100245', type: 'consultation', source: 'website',
  count: '9', first_time: '09:30 AM', list: '09:30 AM — Priya Sharma\n10:00 AM — Amit Kumar', ward: 'General Ward A', bed: 'GA-12', diagnosis: 'Viral fever',
  follow_up: '19 Oct 2026', paid: '₹1,000.00', balance: '₹850.00', days: '7', status: 'completed', resolution: 'Your phone number has been corrected.',
  appointments: '42', completed: '35', cancelled: '4', no_show: '3', new_patients: '11', admissions: '2', discharges: '3', collected: '₹48,250', outstanding: '₹12,400',
  plan: 'Hospital', old_plan: 'Clinic', what: 'the Hospital plan (12 months)', invoice_no: 'HC/2026-27/0042', until: 'Your plan now runs until 06 Oct 2027.',
  platform: 'Hospital Comrade', support: 'support@hospital.digitalcomrade.in', domain: 'citycarehospital.in', channel: 'WhatsApp', used: '4,000', limit: '5,000',
  read_only: '20 Oct 2026', milestone: 'd7', severity: 'warning', body: 'Disk is 91% full on the main server.',
}

// ------------------------------------------------------------------ WhatsApp template submission sheet
export interface WaSubmissionRow {
  code: string; name: string; category: string; language: string; body: string; params: string; samples: string; status: string; label: string
}

/** Meta's template-name rules: lower-case letters, digits and _ (max 512) */
export const waTemplateName = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 512) || 'template'

/**
 * One row of the sheet you submit to Meta / your BSP: the WhatsApp wording with {token}s turned into {{1}}, {{2}}…
 * in the parameter order (saved order → suggested order → order of appearance) and a sample value for each.
 */
export function waSubmission(e: CatalogEntry | undefined, p?: PlatformTemplate | null, key = e?.id ?? p?.key ?? ''): WaSubmissionRow {
  const copy = e ? effectiveCopy(e, p) : { subject: p?.tpl?.subject ?? '', text: p?.tpl?.text ?? '', waText: p?.tpl?.waText ?? '', waParams: p?.tpl?.waParams ?? '' }
  const wording = (copy.waText || copy.text || '').trim()
  const seen = Array.from(wording.matchAll(/\{([a-z_]+)\}/g)).map((m) => m[1]).filter((k, i, a) => a.indexOf(k) === i)
  const listed = (p?.tpl?.waParams || copy.waParams || '').split(',').map((s) => s.trim()).filter(Boolean)
  const order = [...listed.filter((k) => seen.includes(k)), ...seen.filter((k) => !listed.includes(k))]
  const body = wording.replace(/\{([a-z_]+)\}/g, (m, k: string) => (order.includes(k) ? `{{${order.indexOf(k) + 1}}}` : m))
  return {
    code: e?.code ?? 'CUSTOM', name: waTemplateName(p?.tpl?.waTemplate || key), category: p?.tpl?.waCategory || e?.waCategory || 'UTILITY', language: 'en',
    body, params: order.join(','), samples: order.map((k) => SAMPLE_VARS[k] ?? k).join(' | '), status: p?.tpl?.waStatus ?? 'draft',
    label: e?.label ?? p?.meta?.label ?? key,
  }
}

/** RFC 4180 CSV (quotes doubled, every field quoted; line breaks inside a field are kept) */
export function toCsv(rows: Record<string, string>[], columns: string[]): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [columns.map(q).join(','), ...rows.map((r) => columns.map((c) => q(r[c])).join(','))].join('\r\n') + '\r\n'
}
