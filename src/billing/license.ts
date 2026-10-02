/**
 * Hospital Comrade licence (phase 4) — the browser side of public.tenant_license() / tenant_license_dates().
 * The database decides (and enforces read-only); this only explains it: the banner, Settings → Plan & wallet,
 * and the demo, which has no database and uses computeLicense() with the same rules.
 */
import type { TenantStatus } from '../tenancy/state'

export interface LicenseInfo {
  status: TenantStatus
  trial_ends_at: string | null
  paid_until: string | null
  /** when the hospital turns read-only (end of the grace period); null = no end date */
  read_only_from: string | null
  /** owner / accountant / platform team only */
  wallet_paise?: number
}

export interface LicenseRow { is_primary?: boolean; status: TenantStatus; trial_ends_at: string | null; paid_until: string | null }

/** same rules as public.tenant_license() */
export function computeLicense(t: LicenseRow, graceDays = 7, now = Date.now()): LicenseInfo {
  const trial = t.trial_ends_at ? Date.parse(t.trial_ends_at) : null
  const paid = t.paid_until ? Date.parse(t.paid_until) : null
  const end = Math.max(trial ?? -Infinity, paid ?? -Infinity)
  const readOnlyFrom = t.is_primary || !Number.isFinite(end) ? null : new Date(end + graceDays * 864e5).toISOString()
  const base = { trial_ends_at: t.trial_ends_at, paid_until: t.paid_until, read_only_from: readOnlyFrom }
  if (t.is_primary) return { ...base, status: 'active' }
  if (t.status === 'suspended') return { ...base, status: 'suspended' }
  if (paid == null && trial == null) return { ...base, status: t.status }
  if (paid != null && paid > now) return { ...base, status: 'active' }
  if (trial != null && trial > now) return { ...base, status: 'trial' }
  return { ...base, status: end + graceDays * 864e5 > now ? 'grace' : 'read_only' }
}

/** whole days from now until `iso` (rounded up; 0 = today / past) */
export const daysUntil = (iso: string | null | undefined, now = Date.now()) => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - now) / 864e5)) : 0)

export interface LicenseBanner { tone: 'info' | 'warning' | 'danger'; title: string; text: string; cta: boolean }

/**
 * What the dashboard banner says, or null when nothing needs saying (active with > 14 days left).
 * `canPay`: owner / platform team — they get the "Renew" button and the details.
 */
export function licenseBanner(l: LicenseInfo | null | undefined, canPay: boolean, now = Date.now()): LicenseBanner | null {
  if (!l) return null
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
  const ask = canPay ? '' : ' Please ask the hospital owner to renew.'
  switch (l.status) {
    case 'trial': {
      const d = daysUntil(l.trial_ends_at, now)
      if (!l.trial_ends_at) return null
      return { tone: d <= 3 ? 'warning' : 'info', title: d <= 0 ? 'Free trial ends today' : `Free trial · ${d} day${d === 1 ? '' : 's'} left`,
        text: canPay ? `Choose a plan before ${date(l.trial_ends_at)} to keep everything running without a break.` : `The trial ends on ${date(l.trial_ends_at)}.`, cta: canPay }
    }
    case 'active': {
      const d = daysUntil(l.paid_until, now)
      if (!l.paid_until || d > 14 || !canPay) return null
      return { tone: d <= 3 ? 'warning' : 'info', title: `Plan renews in ${d} day${d === 1 ? '' : 's'}`, text: `Paid until ${date(l.paid_until)}. Renew now and the new period starts after it.`, cta: true }
    }
    case 'grace': {
      const d = daysUntil(l.read_only_from, now)
      return { tone: 'warning', title: `Plan ended · read-only in ${d} day${d === 1 ? '' : 's'}`,
        text: `Everything still works until ${date(l.read_only_from)}; after that nothing can be added or changed until the plan is renewed.${ask}`, cta: canPay }
    }
    case 'read_only':
      return { tone: 'danger', title: 'Read-only — the plan has ended',
        text: `You can still sign in and see every record, but nothing can be added or changed and online booking is paused.${canPay ? ' Renew to switch everything back on instantly.' : ask}`, cta: canPay }
    case 'suspended':
      return { tone: 'danger', title: 'Account suspended', text: 'Please contact Hospital Comrade support.', cta: false }
  }
  return null
}

// ------------------------------------------------------------------ errors from the database's licence guard
export const isLicenseError = (m: string | null | undefined) => !!m && m.includes('LICENSE_READ_ONLY')
/** for staff: the database's own sentence without the code */
export const licenseStaffMessage = (m: string) => m.replace(/^.*?LICENSE_READ_ONLY:\s*/, '')
/** for visitors (booking, forms): no talk of plans */
export const LICENSE_PUBLIC_MESSAGE = 'Online requests are paused for this hospital at the moment — please call or visit the hospital.'
