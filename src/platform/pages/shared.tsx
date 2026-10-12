import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Check, CheckCircle2, Globe, Loader2, MessageCircle } from 'lucide-react'
import { platformName } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import type { Plan } from '../plans'
import { usePlans } from '../planStore'
import { leadProblem, submitLead, type Lead } from '../api'
import { A } from '../site/ui'

export const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

/** a lightweight, illustrative dashboard (pure CSS — no screenshots to keep up to date) */
export function DashboardMock() {
  const bars = [38, 52, 44, 66, 58, 74, 62, 81, 70, 88, 76, 92]
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[560px]">
      <div className="rounded-[2rem] border border-white bg-white/80 p-4 shadow-[0_40px_80px_-30px_rgba(41,41,102,.45)] backdrop-blur sm:p-5">
        <div className="flex items-center gap-1.5 pb-3"><span className="h-2.5 w-2.5 rounded-full bg-rose-300" /><span className="h-2.5 w-2.5 rounded-full bg-amber-300" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-300" /></div>
        <div className="grid grid-cols-[88px_1fr] gap-3">
          <div className="space-y-2 rounded-2xl bg-[#292966] p-3">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={cn('h-2.5 rounded-full', i === 1 ? 'bg-[#CCCCFF]' : 'bg-white/25')} />)}
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[['Today’s OPD', '48'], ['Revenue', '₹1.8L'], ['Beds free', '12']].map(([l, v]) => (
                <div key={l} className="rounded-xl border border-peri-100 bg-white p-2.5"><p className="text-[10px] text-slate-500">{l}</p><p className="font-display text-lg font-extrabold text-peri-900">{v}</p></div>
              ))}
            </div>
            <div className="flex h-28 items-end gap-1.5 rounded-xl border border-peri-100 bg-white p-3">
              {bars.map((h, i) => <span key={i} className="flex-1 rounded-t bg-gradient-to-t from-[#5C5C99] to-[#A3A3CC]" style={{ height: `${h}%` }} />)}
            </div>
            <div className="space-y-1.5 rounded-xl border border-peri-100 bg-white p-3">
              {['10:00 · Rohan D. · Cardiology', '10:15 · Priya S. · Paediatrics', '10:30 · Amit K. · Orthopaedics'].map((t) => (
                <div key={t} className="flex items-center justify-between text-[11px]"><span className="text-slate-600">{t}</span><span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">Checked in</span></div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="glass absolute -bottom-6 -left-4 flex items-center gap-3 rounded-2xl p-3 pr-4 sm:-left-8">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500 text-white"><MessageCircle className="h-5 w-5" /></span>
        <div><p className="text-xs font-semibold text-peri-900">Reminder sent on WhatsApp</p><p className="text-[11px] text-slate-500">Tomorrow 10:00 AM · Dr. Rao</p></div>
      </div>
      <div className="glass absolute -right-3 -top-5 flex items-center gap-2 rounded-2xl px-3.5 py-2.5 sm:-right-6">
        <Globe className="h-4 w-4 text-peri-700" /><span className="text-xs font-semibold text-peri-900">www.yourhospital.in</span>
      </div>
    </div>
  )
}

function PlanPrice({ p }: { p: Plan }) {
  if (p.price === null) return <p className="mt-5 font-display text-3xl font-extrabold text-peri-900">Let’s talk</p>
  return (
    <p className="mt-5 flex items-baseline gap-1">
      <span className="font-display text-4xl font-extrabold tracking-tight text-peri-900">{inr(p.price)}{p.suffix}</span>
      <span className="text-sm text-slate-500">/month</span>
    </p>
  )
}

/** the pricing cards — live from the Control Panel's Plans & billing page */
export function PlanCards() {
  const { offered } = usePlans()
  return (
    <div className={cn('grid gap-5 md:grid-cols-2', offered.length >= 4 ? 'xl:grid-cols-4' : offered.length === 3 ? 'lg:grid-cols-3' : 'mx-auto max-w-4xl')}>
      {offered.map((p) => <PlanCard key={p.id} p={p} />)}
    </div>
  )
}

/** one pricing card (also the live preview in the Control Panel) */
export function PlanCard({ p, preview }: { p: Plan; preview?: boolean }) {
  return (
    <div className={cn('relative flex flex-col rounded-[1.75rem] border bg-white p-6 shadow-soft', p.highlight ? 'border-peri-700 ring-4 ring-[#CCCCFF]' : 'border-peri-200/80')}>
      {p.highlight && <span className="absolute -top-3 left-6 rounded-full bg-peri-800 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">Most popular</span>}
      <h3 className="font-display text-xl font-bold text-peri-900">{p.name}</h3>
      <p className="mt-1 text-sm text-slate-500">{p.tagline}</p>
      <PlanPrice p={p} />
      <ul className="mt-6 flex-1 space-y-2.5 text-sm">
        {p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-peri-600" />{f}</li>)}
      </ul>
      {preview
        ? <span className={cn('mt-7 w-full', p.highlight ? 'btn-peri' : 'btn-ghost')}>{p.cta}</span>
        : <A to={p.signup && p.price !== null ? `/signup?plan=${p.id}` : `/contact?plan=${p.id}`} className={cn('mt-7 w-full', p.highlight ? 'btn-peri' : 'btn-ghost')}>{p.cta}</A>}
    </div>
  )
}

const EMPTY: Lead = { name: '', organisation: '', phone: '', email: '', city: '', plan: 'hospital', message: '' }

export function ContactForm({ plan, title, thanks }: { plan?: string | null; title?: string; thanks?: string }) {
  const { offered, plans } = usePlans()
  const [f, setF] = useState<Lead>({ ...EMPTY, plan: plan && (plan === 'unsure' || plans.some((p) => p.id === plan)) ? plan : EMPTY.plan })
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState('')
  const set = (k: keyof Lead) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const p = leadProblem(f)
    if (p) { setError(p); return }
    setError(''); setState('sending')
    try { await submitLead(f); setState('done') } catch (err) { setError(err instanceof Error ? err.message : 'Could not send. Please try again.'); setState('idle') }
  }

  return (
    <div className="rounded-[2rem] border border-peri-200/80 bg-white p-6 shadow-soft sm:p-8">
      {state === 'done' ? (
        <div className="py-10 text-center" role="status">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <p className="mt-4 font-display text-xl font-bold text-peri-900">Thank you, {f.name.trim().replace(/^(dr|mr|mrs|ms|shri|smt)\.?\s+/i, '').split(/\s+/)[0]}!</p>
          <p className="mt-2 text-sm text-slate-600">{thanks || 'We’ve received your details and will call you soon.'} ({f.phone})</p>
          <A to="/signup" className="btn-peri mt-6">Or start a free trial now<ArrowRight className="h-4 w-4" /></A>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          {title && <h2 className="font-display text-xl font-bold text-peri-900 sm:col-span-2">{title}</h2>}
          <Field label="Your name *"><input className="input" value={f.name} onChange={set('name')} autoComplete="name" maxLength={100} required /></Field>
          <Field label="Hospital / clinic name *"><input className="input" value={f.organisation} onChange={set('organisation')} autoComplete="organization" maxLength={150} required /></Field>
          <Field label="Mobile number *"><input className="input" value={f.phone} onChange={set('phone')} type="tel" inputMode="tel" autoComplete="tel" maxLength={20} required /></Field>
          <Field label="Email"><input className="input" value={f.email} onChange={set('email')} type="email" autoComplete="email" maxLength={150} /></Field>
          <Field label="City"><input className="input" value={f.city} onChange={set('city')} autoComplete="address-level2" maxLength={80} /></Field>
          <Field label="Plan you’re interested in">
            <select className="input" value={f.plan} onChange={set('plan')}>
              {offered.map((p) => <option key={p.id} value={p.id}>{p.name}{p.price ? ` — ${inr(p.price)}${p.suffix ?? ''}/month` : ''}</option>)}
              {f.plan !== 'unsure' && !offered.some((p) => p.id === f.plan) && <option value={f.plan}>{plans.find((p) => p.id === f.plan)?.name ?? f.plan}</option>}
              <option value="unsure">Not sure yet</option>
            </select>
          </Field>
          <Field label="Anything we should know?" className="sm:col-span-2"><textarea className="input min-h-[110px]" value={f.message} onChange={set('message')} maxLength={2000} placeholder="Number of doctors, beds, software you use today…" /></Field>
          {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:col-span-2">{error}</p>}
          <div className="flex flex-col items-center gap-3 sm:col-span-2 sm:flex-row sm:justify-between">
            <p className="text-xs text-slate-500">We only use these details to contact you about {platformName} — see our <A to="/legal/privacy" className="underline underline-offset-2 hover:text-peri-700">Privacy Policy</A>.</p>
            <button type="submit" className="btn-peri w-full shrink-0 whitespace-nowrap sm:w-auto" disabled={state === 'sending'}>
              {state === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Request a call back
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <label className={cn('block text-sm font-medium text-peri-900', className)}><span className="mb-1.5 block">{label}</span>{children}</label>
}
