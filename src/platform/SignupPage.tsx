import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, Loader2, ShieldCheck, Sparkles } from 'lucide-react'
import { platformName } from '../lib/supabase'
import { cn } from '../lib/utils'
import { signupInfo, signupProblem, trialSignup, type SignupForm, type SignupInfo, type SignupResult } from './api'
import { LEGAL_VERSION } from './legal'
import { platformHref } from './LegalPage'
import { PLANS } from './plans'

const EMPTY: SignupForm = { organisation: '', name: '', email: '', phone: '', city: '', plan: '', website: '' }
const firstName = (n: string) => n.trim().replace(/^(dr|mr|mrs|ms|shri|smt)\.?\s+/i, '').split(/\s+/)[0]

/** /signup on the platform domain — start a free trial without talking to sales (phase 8.2) */
export default function SignupPage() {
  const [info, setInfo] = useState<SignupInfo | null>(null)
  const [loadError, setLoadError] = useState('')
  const [f, setF] = useState<SignupForm>(EMPTY)
  const [agreed, setAgreed] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<SignupResult | null>(null)

  useEffect(() => { document.title = `Start your free trial · ${platformName}` }, [])
  useEffect(() => {
    signupInfo().then((i) => {
      setInfo(i)
      const wanted = new URLSearchParams(location.search).get('plan')
      setF((x) => ({ ...x, plan: wanted && i.plans.includes(wanted) ? wanted : i.plan }))
    }).catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))
  }, [])
  const set = (k: keyof SignupForm) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const p = signupProblem(f, agreed)
    if (p) { setError(p); return }
    setError(''); setSending(true)
    try { setDone(await trialSignup(f, LEGAL_VERSION)) } catch (err) { setError(err instanceof Error ? err.message : 'Could not sign up. Please try again.') } finally { setSending(false) }
  }

  const link = 'underline underline-offset-2 hover:text-peri-500'
  return (
    <div className="min-h-screen bg-[#f7f7ff] text-slate-700">
      <header className="border-b border-peri-200/60 bg-white/80 backdrop-blur">
        <div className="l-container flex h-16 items-center justify-between gap-4">
          <a href={platformHref('/')} className="inline-flex items-center gap-2 text-sm font-semibold text-peri-800 hover:text-peri-500"><ArrowLeft className="h-4 w-4" />{platformName}</a>
        </div>
      </header>
      <main className="l-container grid gap-10 py-12 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        <div className="lg:pt-6">
          <span className="l-eyebrow"><Sparkles className="h-3.5 w-3.5" />Free trial</span>
          <h1 className="mt-4 font-display text-4xl font-extrabold tracking-tight text-peri-900">Start using {platformName} today</h1>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            {info ? `${info.trialDays} days free` : 'Free trial'} with every feature of your plan. No card, no setup fee — pay only if you decide to continue.
          </p>
          <ul className="mt-8 space-y-4 text-sm">
            <Point icon={<CheckCircle2 className="h-5 w-5" />} title="Your hospital, ready in minutes">Appointments, patient records, billing, lab, wards and your website — with sensible defaults you can change later.</Point>
            <Point icon={<ShieldCheck className="h-5 w-5" />} title="Your data stays yours">Separate from every other hospital, export it any time, delete it when you leave.</Point>
            <Point icon={<Clock className="h-5 w-5" />} title="Nothing happens automatically at the end">After the trial the app becomes read-only until you choose a plan — nothing is deleted.</Point>
          </ul>
        </div>

        <div className="rounded-[2rem] border border-peri-200/80 bg-white p-6 shadow-soft sm:p-8">
          {loadError ? <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">Could not load the sign-up form: {loadError}</p>
            : !info ? <div className="grid h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-peri-500" /></div>
            : done ? <Done r={done} name={firstName(f.name)} />
            : !info.enabled ? (
              <div className="py-8 text-center">
                <p className="font-display text-xl font-bold text-peri-900">Online sign-up is paused</p>
                <p className="mt-2 text-sm text-slate-600">Leave your details and we will set up your hospital for you — usually within one working day.</p>
                <a href={platformHref('/#contact')} className="btn-peri mt-6">Talk to us<ArrowRight className="h-4 w-4" /></a>
              </div>
            ) : (
              <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
                <h2 className="font-display text-xl font-bold text-peri-900 sm:col-span-2">Create your hospital</h2>
                <Field label="Hospital / clinic name *" className="sm:col-span-2"><input className="input" value={f.organisation} onChange={set('organisation')} autoComplete="organization" maxLength={120} required /></Field>
                <Field label="Your name *"><input className="input" value={f.name} onChange={set('name')} autoComplete="name" maxLength={100} required /></Field>
                <Field label="Mobile number *"><input className="input" value={f.phone} onChange={set('phone')} type="tel" inputMode="tel" autoComplete="tel" maxLength={16} placeholder="98765 43210" required /></Field>
                <Field label="E-mail (you’ll sign in with it) *" className="sm:col-span-2"><input className="input" value={f.email} onChange={set('email')} type="email" autoComplete="email" maxLength={150} required /></Field>
                <Field label="City"><input className="input" value={f.city} onChange={set('city')} autoComplete="address-level2" maxLength={80} /></Field>
                <Field label="Plan to try">
                  <select className="input" value={f.plan} onChange={set('plan')}>
                    {info.plans.map((id) => { const p = PLANS.find((x) => x.id === id); return <option key={id} value={id}>{p?.name ?? id}{p?.price ? ` — ₹${p.price.toLocaleString('en-IN')}${p.suffix ?? ''}/month` : ''}</option> })}
                  </select>
                </Field>
                {/* honeypot: people never see it, bots fill it */}
                <input type="text" name="website" value={f.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
                <label className="flex items-start gap-3 rounded-xl bg-peri-50/70 p-3 text-sm text-slate-700 sm:col-span-2">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#5C5C99]" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span>I agree to the <a href={platformHref('/legal/terms')} target="_blank" rel="noreferrer" className={link}>Terms of Service</a> and the <a href={platformHref('/legal/dpa')} target="_blank" rel="noreferrer" className={link}>Data Processing Agreement</a> on behalf of my hospital, and have read the <a href={platformHref('/legal/privacy')} target="_blank" rel="noreferrer" className={link}>Privacy Policy</a>.</span>
                </label>
                {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:col-span-2">{error}</p>}
                <button type="submit" className="btn-peri sm:col-span-2" disabled={sending}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{info.mode === 'instant' ? 'Create my hospital' : 'Request my free trial'}<ArrowRight className="h-4 w-4" />
                </button>
                <p className="text-center text-xs text-slate-500 sm:col-span-2">
                  {info.mode === 'instant' ? 'Your hospital is created right away.' : 'We check every request (usually within one working day) and e-mail you the link.'}
                </p>
              </form>
            )}
        </div>
      </main>
    </div>
  )
}

function Done({ r, name }: { r: SignupResult; name: string }) {
  if (r.status === 'pending') return (
    <div className="py-8 text-center" role="status">
      <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
      <p className="mt-4 font-display text-xl font-bold text-peri-900">Thank you{name ? `, ${name}` : ''}!</p>
      <p className="mt-2 text-sm text-slate-600">We’ve received your request. Once it’s approved — usually within one working day — we’ll e-mail <b>{r.email}</b> with the link to create your owner account.</p>
    </div>
  )
  const register = `/register?hospital=${encodeURIComponent(r.slug)}&email=${encodeURIComponent(r.email)}`
  return (
    <div className="py-4" role="status">
      <CheckCircle2 className="h-12 w-12 text-emerald-500" />
      <p className="mt-4 font-display text-2xl font-bold text-peri-900">Your hospital is ready{name ? `, ${name}` : ''}!</p>
      <p className="mt-2 text-sm text-slate-600">Free for {r.trial_days} days. Two quick steps:</p>
      <ol className="mt-5 space-y-3 text-sm">
        <li className="flex gap-3"><Step n={1} /><span><b>Create your owner account</b> with <b>{r.email}</b> — that e-mail becomes the hospital’s owner.</span></li>
        <li className="flex gap-3"><Step n={2} /><span><b>Follow the setup checklist</b> on the dashboard: hospital details, doctors, then invite your team.</span></li>
      </ol>
      <a href={register} className="btn-peri mt-6 w-full">Create owner account<ArrowRight className="h-4 w-4" /></a>
      <p className="mt-4 text-xs text-slate-500">Bookmark your hospital’s address: <a className="font-mono text-peri-700 underline" href={`/?hospital=${encodeURIComponent(r.slug)}`}>{location.host}/?hospital={r.slug}</a> — you can connect your own domain later in Settings.</p>
    </div>
  )
}

const Step = ({ n }: { n: number }) => <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-peri-800 text-xs font-bold text-white">{n}</span>

function Point({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <li className="flex gap-3"><span className="mt-0.5 text-peri-600">{icon}</span><span><b className="block text-peri-900">{title}</b><span className="text-slate-600">{children}</span></span></li>
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <label className={cn('block text-sm font-medium text-peri-900', className)}><span className="mb-1.5 block">{label}</span>{children}</label>
}
