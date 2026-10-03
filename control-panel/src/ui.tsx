import { createContext, useContext, type ReactNode } from 'react'
import { Badge, Card, type Tone } from '../../src/components/ui'
import { PLAN_LABEL } from '../../src/platform/plans'
import type { CpMe, ProviderRole } from './types'

export const MeContext = createContext<{ me: CpMe; signOut: () => void } | null>(null)
export function useMe() {
  const v = useContext(MeContext)
  if (!v) throw new Error('useMe outside the panel')
  return v
}
export const isAdmin = (r: ProviderRole) => r === 'admin'
export const canBill = (r: ProviderRole) => r === 'admin' || r === 'finance'

export const STATUS: Record<string, { label: string; tone: Tone }> = {
  trial: { label: 'Trial', tone: 'blue' },
  active: { label: 'Active', tone: 'green' },
  grace: { label: 'Grace period', tone: 'amber' },
  read_only: { label: 'Read-only', tone: 'red' },
  suspended: { label: 'Suspended', tone: 'slate' },
}
export function LicenseBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: 'slate' as Tone }
  return <Badge tone={s.tone} dot>{s.label}</Badge>
}
export const planLabel = (p: string | null | undefined) => (p ? PLAN_LABEL[p as keyof typeof PLAN_LABEL] ?? p : '—')
export const ROLE_LABEL: Record<ProviderRole, string> = { admin: 'Admin', support: 'Support', finance: 'Finance' }
export const ROLE_TONE: Record<ProviderRole, Tone> = { admin: 'violet', support: 'blue', finance: 'teal' }

const dfmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const dtfmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
export const date = (v?: string | null) => (v ? dfmt.format(new Date(v)) : '—')
export const dateTime = (v?: string | null) => (v ? dtfmt.format(new Date(v)) : '—')
export const inr = (rupees: number | null | undefined) => {
  if (rupees == null) return '—'
  const n = Number(rupees), whole = Number.isInteger(n)
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`
}
export const paise = (p: number | null | undefined) => (p == null ? '—' : inr(p / 100))

/** "in 3 days" / "2 days ago" */
export function relDays(v?: string | null) {
  if (!v) return ''
  const d = Math.round((Date.parse(v) - Date.now()) / 864e5)
  if (d === 0) return 'today'
  return d > 0 ? `in ${d} day${d === 1 ? '' : 's'}` : `${-d} day${d === -1 ? '' : 's'} ago`
}

/** the licence line under a hospital's name */
export function licenseLine(l: { status: string; trial_ends_at: string | null; paid_until: string | null; read_only_from: string | null; closing_at?: string | null; purge_after?: string | null }) {
  if (l.closing_at) return `Closing since ${date(l.closing_at)} · data deleted after ${date(l.purge_after)}`
  if (l.status === 'trial') return `Trial ends ${date(l.trial_ends_at)} (${relDays(l.trial_ends_at)})`
  if (l.status === 'active') return l.paid_until ? `Paid until ${date(l.paid_until)}` : 'Always active'
  if (l.status === 'grace') return `Read-only from ${date(l.read_only_from)} (${relDays(l.read_only_from)})`
  if (l.status === 'read_only') return `Read-only since ${date(l.read_only_from)}`
  return 'Suspended by Hospital Comrade'
}

export function Section({ title, subtitle, action, children, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-display text-[15px] font-semibold text-brand-950">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </Card>
  )
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      {error instanceof Error ? error.message : String(error)}
      {onRetry && <button type="button" onClick={onRetry} className="ml-3 font-semibold underline">Try again</button>}
    </div>
  )
}

/** the hospital app's address for a hospital (custom domain, else ?hospital=) */
export function appUrl(h: { slug: string; domain: string | null }) {
  if (h.domain) return `https://${h.domain}/`
  return `${location.origin}/?hospital=${encodeURIComponent(h.slug)}`
}
