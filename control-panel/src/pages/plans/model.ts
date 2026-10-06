/**
 * Plans & billing page — pure helpers (tested in tests/cpPlans.test.ts): per-plan numbers from the hospital list,
 * the slug for a new plan, what changed between two versions of a plan, and the history lines.
 */
import type { Plan } from '../../../../src/platform/plans'
import type { CpHospital, PlanFields, PlanHistoryRow } from '../../types'

export interface PlanStats { hospitals: number; paying: number; trial: number; ownPrice: number; mrr: number }
export const EMPTY_STATS: PlanStats = { hospitals: 0, paying: 0, trial: 0, ownPrice: 0, mrr: 0 }

/** hospitals per plan (the platform's own / demo hospital doesn't count); MRR = monthly price of active hospitals, before GST */
export function planStats(hospitals: Pick<CpHospital, 'plan' | 'is_primary' | 'is_demo' | 'license' | 'price' | 'billing'>[]): Record<string, PlanStats> {
  const out: Record<string, PlanStats> = {}
  for (const h of hospitals) {
    if (h.is_primary || h.is_demo) continue
    const s = (out[h.plan] ??= { ...EMPTY_STATS })
    s.hospitals += 1
    if (h.license?.status === 'active') { s.paying += 1; s.mrr += Number(h.price ?? 0) }
    if (h.license?.status === 'trial') s.trial += 1
    if (h.billing && (h.billing as Record<string, unknown>).price != null) s.ownPrice += 1
  }
  return out
}

export function totals(stats: Record<string, PlanStats>): PlanStats {
  return Object.values(stats).reduce((a, s) => ({ hospitals: a.hospitals + s.hospitals, paying: a.paying + s.paying, trial: a.trial + s.trial, ownPrice: a.ownPrice + s.ownPrice, mrr: a.mrr + s.mrr }), { ...EMPTY_STATS })
}

/** "Multi-branch Plus" → "multi-branch-plus" (2–32 characters, starts with a letter, not taken) */
export function slugFor(name: string, taken: string[]): string {
  let base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 28).replace(/-+$/, '')
  if (base.length < 2) base = 'plan'
  if (base === 'unsure') base = 'plan-unsure'
  let id = base, i = 2
  while (taken.includes(id)) id = `${base}-${i++}`
  return id
}
export const validId = (id: string) => /^[a-z][a-z0-9-]{1,31}$/.test(id) && id !== 'unsure'

/** the fields of a plan the editor sends */
export function fieldsOf(p: Plan): PlanFields {
  return { name: p.name, price: p.price, suffix: p.suffix ?? '', tagline: p.tagline, features: [...p.features], highlight: !!p.highlight, cta: p.cta,
    included: { ...p.included }, public: p.public !== false, archived: !!p.archived, signup: !!p.signup, order: p.order ?? 0 }
}

/** problems with an edited plan (empty = fine) */
export function planProblems(f: PlanFields, id: string, isNew: boolean, taken: string[]): string[] {
  const out: string[] = []
  if (!f.name.trim() || f.name.trim().length > 40) out.push('Name: 1 to 40 characters.')
  if (isNew && !validId(id)) out.push('Plan ID: 2–32 lower-case letters, digits or dashes, starting with a letter.')
  if (isNew && taken.includes(id)) out.push('That plan ID is already used.')
  if (f.price != null && (!Number.isFinite(f.price) || f.price < 0 || f.price > 10_000_000)) out.push('Price: ₹0 to ₹1,00,00,000 a month.')
  if ((f.suffix ?? '').length > 3) out.push('Price suffix: up to 3 characters.')
  if (f.tagline.length > 160) out.push('Tagline: up to 160 characters.')
  if (!f.cta.trim() || f.cta.trim().length > 40) out.push('Button text: 1 to 40 characters.')
  const feats = f.features.map((x) => x.trim()).filter(Boolean)
  if (feats.length > 25) out.push('Up to 25 features.')
  if (feats.some((x) => x.length > 140)) out.push('Each feature: up to 140 characters.')
  for (const [k, v] of Object.entries(f.included)) if (!Number.isInteger(v) || v < 0 || v > 10_000_000) out.push(`Included ${k}: a whole number from 0.`)
  return out
}

const CH: Record<string, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'E-mail' }
const money = (n: number | null | undefined) => (n == null ? 'custom pricing' : `₹${Number(n).toLocaleString('en-IN')}`)

/** what an owner would be told (and what the history shows) — mirrors cp_save_plan */
export function changeLines(before: Partial<PlanFields> | null | undefined, after: Partial<PlanFields>): { price: string | null; other: string[] } {
  if (!before) return { price: null, other: [] }
  const price = (before.price ?? null) !== (after.price ?? null)
    ? `Price: ${money(before.price)} → ${money(after.price)}${after.price == null ? '' : ' a month + GST'}, from your next renewal.` : null
  const other: string[] = []
  for (const ch of ['whatsapp', 'sms', 'email'] as const) {
    const a = before.included?.[ch] ?? 0, b = after.included?.[ch] ?? 0
    if (a !== b) other.push(`${CH[ch]} messages included each month: ${a.toLocaleString('en-IN')} → ${b.toLocaleString('en-IN')}.`)
  }
  if (before.name !== undefined && after.name !== undefined && before.name !== after.name) other.push(`The plan is now called ${after.name}.`)
  if (after.archived && !before.archived) other.push('It is no longer offered to new hospitals — you can stay on it.')
  return { price, other }
}

/** one line per history entry */
export function historyLine(r: PlanHistoryRow): string {
  const d = (r.detail ?? {}) as { before?: Partial<PlanFields> | null; after?: Partial<PlanFields>; existing?: string | null; kept?: number; notified?: number }
  const name = d.after?.name ?? d.before?.name ?? r.target ?? 'plan'
  switch (r.action) {
    case 'plan:create': return `Added the ${name} plan${d.after?.price != null ? ` at ${money(d.after.price)}/month` : ''}.`
    case 'plan:delete': return `Deleted the ${name} plan.`
    case 'plan:reorder': return `Changed the order of the plans${Array.isArray(r.detail) ? `: ${(r.detail as string[]).join(', ')}` : ''}.`
    case 'plan:update': {
      const parts: string[] = []
      const { price, other } = changeLines(d.before, d.after ?? {})
      if (price) parts.push(price.replace(', from your next renewal.', '') + (d.existing === 'keep' ? ` (${d.kept ?? 0} existing hospital(s) kept the old price)` : ' (for everyone from their next renewal)'))
      parts.push(...other.map((x) => x.replace(/\.$/, '')))
      const flags: [keyof PlanFields, string, string][] = [['public', 'shown on the website', 'hidden from the website'], ['highlight', 'marked most popular', 'no longer most popular'], ['signup', 'self sign-up on', 'self sign-up off']]
      for (const [k, on, off] of flags) if (d.before && d.after && !!d.before[k] !== !!d.after[k]) parts.push(d.after[k] ? on : off)
      if (d.before && d.after && !d.after.archived && d.before.archived) parts.push('restored (offered again)')
      for (const k of ['tagline', 'cta', 'suffix'] as const) if (d.before && d.after && (d.before[k] ?? '') !== (d.after[k] ?? '')) parts.push(`${k === 'cta' ? 'button text' : k} changed`)
      if (d.before && d.after && JSON.stringify(d.before.features ?? []) !== JSON.stringify(d.after.features ?? [])) parts.push('features edited')
      const tail = d.notified ? ` · ${d.notified} owner(s) told` : ''
      return `${name}: ${parts.join(' · ') || 'saved without changes'}${tail}`
    }
    case 'settings:billing': return `Billing rules changed: ${Object.keys(r.detail ?? {}).filter((k) => k !== 'plans').join(', ') || 'plans'}.`
    default: return r.action
  }
}
