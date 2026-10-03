import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Circle, PartyPopper, Rocket, X } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { Card } from '../../components/ui'
import { useCount } from '../../hooks/useData'
import { cn } from '../../lib/utils'
import { useSiteSettings } from '../../site/cms/content'
import { isPrimaryTenant, siteTenant, tenancyEnabled } from '../../tenancy/state'

/** the steps a new hospital goes through (phase 8.4) — done ones are worked out from its data, a few are ticked by hand */
export interface SetupStep { id: string; title: string; hint: string; to: string; done: boolean; manual?: boolean }

export function setupSteps(x: { details: boolean; doctors: number; team: number; appointments: number; plan: boolean; ticked: Record<string, boolean> }): SetupStep[] {
  return [
    { id: 'details', title: 'Add your hospital’s address and phone', hint: 'Shown on the website, prescriptions, bills and messages.', to: '/settings', done: x.details },
    { id: 'doctors', title: 'Add your doctors', hint: 'With their departments, fees and consultation hours.', to: '/doctors', done: x.doctors > 0 },
    { id: 'team', title: 'Invite your team', hint: 'Reception, accounts and staff get their own sign-in with the right access.', to: '/users', done: x.team > 0 },
    { id: 'appointment', title: 'Book a first appointment', hint: 'Try the flow end to end — the patient gets a confirmation.', to: '/appointments', done: x.appointments > 0 },
    { id: 'website', title: 'Look over your website', hint: 'Edit the text, photos and services patients see.', to: '/cms', done: !!x.ticked.website, manual: true },
    { id: 'domain', title: 'Connect your own domain (optional)', hint: 'e.g. www.yourhospital.in — one DNS record, SSL included.', to: '/settings?tab=domain', done: !!x.ticked.domain, manual: true },
    { id: 'plan', title: 'Choose a plan before the trial ends', hint: 'UPI, cards or net banking with a GST invoice. Nothing is deleted if you wait.', to: '/billing', done: x.plan },
  ]
}

/** owner dashboard card for hospitals on the platform; hides itself when everything is done or when dismissed */
export function SetupChecklist() {
  const { user, context } = useAuth()
  const site = useSiteSettings()
  const show = tenancyEnabled() && !isPrimaryTenant() && user?.role === 'owner'
  const key = `dch:setup:${siteTenant()?.id ?? 'x'}`
  const [state, setState] = useState<{ ticked: Record<string, boolean>; hidden?: boolean }>(() => { try { return JSON.parse(localStorage.getItem(key) ?? '{}') } catch { return { ticked: {} } } })
  const save = (s: typeof state) => { setState(s); try { localStorage.setItem(key, JSON.stringify(s)) } catch { /* private mode */ } }
  const doctors = useCount('doctors', [], { enabled: show })
  const team = useCount('profiles', [['role', 'nin', ['owner', 'patient']]], { enabled: show })
  const invites = useCount('staff_invites', [], { enabled: show })
  const appointments = useCount('appointments', [], { enabled: show })
  if (!show || state.hidden) return null
  if ([doctors, team, invites, appointments].some((c) => c.isLoading)) return null

  const steps = setupSteps({
    details: !!site.address?.trim() && !!site.phone?.trim(), doctors: doctors.count ?? 0, team: (team.count ?? 0) + (invites.count ?? 0),
    appointments: appointments.count ?? 0, plan: context?.license?.status === 'active', ticked: state.ticked ?? {},
  })
  const done = steps.filter((s) => s.done).length
  const all = done === steps.length
  const pct = Math.round((done / steps.length) * 100)

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-[#CCCCFF]/50 to-white px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-900 text-white">{all ? <PartyPopper className="h-5 w-5" /> : <Rocket className="h-5 w-5" />}</span>
          <div>
            <h2 className="font-display text-base font-semibold text-brand-950">{all ? 'Your hospital is all set up' : 'Set up your hospital'}</h2>
            <p className="text-xs text-slate-600">{done} of {steps.length} done — about 15 minutes in all</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-2 w-32 overflow-hidden rounded-full bg-white ring-1 ring-brand-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
            <div className="h-full rounded-full bg-brand-700 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <button type="button" onClick={() => save({ ...state, hidden: true })} className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-slate-800" aria-label="Hide the setup checklist" title="Hide"><X className="h-4 w-4" /></button>
        </div>
      </div>
      <ul className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-y-0">
        {steps.map((s) => (
          <li key={s.id} className="flex items-start gap-3 px-5 py-3 md:border-b md:border-slate-100">
            <button type="button" disabled={!s.manual} onClick={() => save({ ...state, ticked: { ...state.ticked, [s.id]: !s.done } })}
              aria-label={s.manual ? (s.done ? `Mark “${s.title}” as not done` : `Mark “${s.title}” as done`) : undefined} className={cn('mt-0.5 shrink-0', s.manual && 'cursor-pointer')}>
              {s.done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-slate-300" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className={cn('text-sm font-medium', s.done ? 'text-slate-400 line-through' : 'text-brand-950')}>{s.title}</p>
              <p className="text-xs text-slate-500">{s.hint}</p>
            </div>
            {!s.done && <Link to={s.to} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">Open<ArrowRight className="h-3 w-3" /></Link>}
          </li>
        ))}
      </ul>
    </Card>
  )
}
