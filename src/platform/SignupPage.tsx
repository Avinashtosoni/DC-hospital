import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, Loader2, ShieldCheck, Sparkles } from 'lucide-react'
import { platformName } from '../lib/supabase'
import { cn } from '../lib/utils'
import { getSignupDraft, saveSignupDraft, signupInfo, signupProblem, trialSignup, type SignupForm, type SignupInfo, type SignupResult, type SignupStep } from './api'
import { LEGAL_VERSION } from './legal'
import { BrandMark, siteHref as platformHref } from './site/ui'
import { usePlans } from './planStore'
import { hospitalUrl } from '../tenancy/urls'
import { PhoneField, type Verified } from './PhoneVerify'

const EMPTY: SignupForm = { organisation: '', name: '', email: '', phone: '', city: '', plan: '', website: '', followup_consent: false }
const DRAFT_KEY = 'dch:signup-draft-id:v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const firstName = (n: string) => n.trim().replace(/^(dr|mr|mrs|ms|shri|smt)\.?\s+/i, '').split(/\s+/)[0]
const STEPS: { id: SignupStep; title: string; hint: string }[] = [
  { id: 'hospital', title: 'Hospital', hint: 'Name, city and plan' },
  { id: 'contact', title: 'Your details', hint: 'Owner contact and mobile verification' },
  { id: 'review', title: 'Review', hint: 'Consent and submit' },
]

function draftIdentity() {
  try {
    const old = localStorage.getItem(DRAFT_KEY)
    if (old && UUID.test(old)) return { id: old, resume: true }
    const id = crypto.randomUUID()
    return { id, resume: false }
  } catch { return { id: crypto.randomUUID(), resume: false } }
}

/** /signup — a guided, server-persisted self-service setup flow. */
export default function SignupPage() {
  const { plans } = usePlans()
  const [info, setInfo] = useState<SignupInfo | null>(null)
  const [loadError, setLoadError] = useState('')
  const [f, setF] = useState<SignupForm>(EMPTY)
  const [stage, setStage] = useState<SignupStep>('hospital')
  const [reached, setReached] = useState<SignupStep[]>(['hospital'])
  const [draft, setDraft] = useState(draftIdentity)
  const [draftReady, setDraftReady] = useState(!draft.resume)
  const [agreed, setAgreed] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<SignupResult | null>(null)
  const [verified, setVerified] = useState<Verified | null>(null)
  const [needVerify, setNeedVerify] = useState(false)
  const otp = info?.otp?.required ? info.otp : null
  const phoneOk = !otp || (!!verified && verified.phone === f.phone.replace(/\D/g, '').slice(-10))

  useEffect(() => { document.title = `Start your free trial · ${platformName}` }, [])
  useEffect(() => {
    let live = true
    signupInfo().then((i) => {
      if (!live) return
      setInfo(i)
      const wanted = new URLSearchParams(location.search).get('plan')
      setF((x) => ({ ...x, plan: x.plan && i.plans.includes(x.plan) ? x.plan : wanted && i.plans.includes(wanted) ? wanted : i.plan }))
    }).catch((e) => { if (live) setLoadError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [])
  useEffect(() => {
    if (!draft.resume) return
    let live = true
    getSignupDraft(draft.id).then((saved) => {
      if (!live) return
      if (saved) {
        setF((x) => ({ ...x, ...saved.data, followup_consent: saved.followup_consent }))
        setStage(saved.current_step)
        setReached(saved.reached_steps)
      } else {
        try { localStorage.removeItem(DRAFT_KEY) } catch { /* private mode */ }
        setDraft({ id: draft.id, resume: false })
      }
      setDraftReady(true)
    }).catch(() => { if (live) setDraftReady(true) })
    return () => { live = false }
  }, [draft.id, draft.resume])

  // Persist the current step and reached steps after a short pause; the browser holds only the random draft ID.
  useEffect(() => {
    if (!draftReady || !info?.enabled || done) return
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, draft.id) } catch { /* private mode */ }
      void saveSignupDraft(draft.id, f, stage, reached).catch(() => { /* a transient save failure must not block sign-up */ })
    }, 700)
    return () => window.clearTimeout(timer)
  }, [draft.id, draftReady, f, stage, reached, info?.enabled, done])

  const set = (k: keyof SignupForm) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const move = (next: SignupStep) => {
    setError('')
    setStage(next)
    setReached((old) => old.includes(next) ? old : [...old, next])
  }
  const continueStep = () => {
    const problem = signupProblem(f, agreed, stage)
    if (problem) { setError(problem); return }
    if (stage === 'contact' && !phoneOk) { setNeedVerify(true); setError('Please verify your mobile number first.'); return }
    move(stage === 'hospital' ? 'contact' : 'review')
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (stage !== 'review') { continueStep(); return }
    const problem = signupProblem(f, agreed, 'review')
    if (problem) { setError(problem); return }
    if (!phoneOk) { setNeedVerify(true); setStage('contact'); setError('Please verify your mobile number first.'); return }
    setError(''); setSending(true)
    try {
      const result = await trialSignup(f, LEGAL_VERSION, phoneOk && otp ? verified?.token : null, { draftId: draft.id, reached: ['hospital', 'contact', 'review'], termsAccepted: agreed })
      setDone(result)
      try { localStorage.removeItem(DRAFT_KEY) } catch { /* private mode */ }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not sign up. Please try again.'
      if (/verify your mobile/i.test(msg)) { setVerified(null); setNeedVerify(true); setStage('contact') }
      setError(msg)
    } finally { setSending(false) }
  }

  const link = 'underline underline-offset-2 hover:text-peri-500'
  return (
    <div className="min-h-screen bg-[#f7f7ff] text-slate-700">
      <header className="border-b border-peri-200/60 bg-white/80 backdrop-blur">
        <div className="l-container flex h-16 items-center justify-between gap-4">
          <a href={platformHref('/')} className="flex items-center gap-2.5 font-display text-lg font-extrabold text-peri-900"><BrandMark />{platformName}</a>
          <a href={platformHref('/')} className="inline-flex items-center gap-1.5 text-sm font-semibold text-peri-700 hover:text-peri-500"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Back to site</span><span className="sm:hidden">Back</span></a>
        </div>
      </header>
      <main className="l-container grid gap-10 py-12 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        <div className="lg:pt-6">
          <span className="l-eyebrow"><Sparkles className="h-3.5 w-3.5" />Free trial</span>
          <h1 className="mt-4 font-display text-4xl font-extrabold tracking-tight text-peri-900">Start using {platformName} today</h1>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">{info ? `${info.trialDays} days free` : 'Free trial'} with every feature of your plan. No card, no setup fee — pay only if you decide to continue.</p>
          <ul className="mt-8 space-y-4 text-sm">
            <Point icon={<CheckCircle2 className="h-5 w-5" />} title="Your hospital, ready in minutes">Appointments, patient records, billing, lab, wards and your website — with sensible defaults you can change later.</Point>
            <Point icon={<ShieldCheck className="h-5 w-5" />} title="Your data stays yours">Separate from every other hospital, export it any time, delete it when you leave.</Point>
            <Point icon={<Clock className="h-5 w-5" />} title="Nothing happens automatically at the end">After the trial the app becomes read-only until you choose a plan — nothing is deleted.</Point>
          </ul>
        </div>

        <div className="rounded-[2rem] border border-peri-200/80 bg-white p-6 shadow-soft sm:p-8">
          {loadError ? <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">Could not load the sign-up form: {loadError}</p>
            : !info || !draftReady ? <div className="grid h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-peri-500" /></div>
            : done ? <Done r={done} name={firstName(f.name)} />
            : !info.enabled ? (
              <div className="py-8 text-center">
                <p className="font-display text-xl font-bold text-peri-900">Online sign-up is paused</p>
                <p className="mt-2 text-sm text-slate-600">Leave your details and we will set up your hospital for you — usually within one working day.</p>
                <a href={platformHref('/contact')} className="btn-peri mt-6">Talk to us<ArrowRight className="h-4 w-4" /></a>
              </div>
            ) : (
              <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    {STEPS.map((s, i) => {
                      const active = s.id === stage, wasReached = reached.includes(s.id)
                      return <button key={s.id} type="button" disabled={!wasReached} onClick={() => { if (wasReached) move(s.id) }}
                        className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-2 text-left transition sm:px-3', active ? 'bg-peri-50 ring-1 ring-peri-200' : wasReached ? 'hover:bg-slate-50' : 'opacity-45')}>
                        <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold', active ? 'bg-peri-800 text-white' : wasReached ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500')}>{wasReached && !active ? <CheckCircle2 className="h-4 w-4" /> : i + 1}</span>
                        <span className="min-w-0"><span className="block truncate text-xs font-semibold text-peri-900 sm:text-sm">{s.title}</span><span className="hidden truncate text-[10px] text-slate-500 sm:block">{s.hint}</span></span>
                      </button>
                    })}
                  </div>
                  <h2 className="font-display text-xl font-bold text-peri-900">{stage === 'hospital' ? 'Tell us about your hospital' : stage === 'contact' ? 'How can we reach you?' : 'Review your free-trial request'}</h2>
                </div>

                {stage === 'hospital' && <>
                  <Field label="Hospital / clinic name *" className="sm:col-span-2"><input className="input" value={f.organisation} onChange={set('organisation')} autoComplete="organization" maxLength={120} required /></Field>
                  <Field label="City"><input className="input" value={f.city} onChange={set('city')} autoComplete="address-level2" maxLength={80} /></Field>
                  <Field label="Plan to try">
                    <select className="input" value={f.plan} onChange={set('plan')}>
                      {info.plans.map((id) => { const p = plans.find((x) => x.id === id); return <option key={id} value={id}>{p?.name ?? id}{p?.price ? ` — ₹${p.price.toLocaleString('en-IN')}${p.suffix ?? ''}/month` : ''}</option> })}
                    </select>
                  </Field>
                </>}

                {stage === 'contact' && <>
                  <Field label="Your name *"><input className="input" value={f.name} onChange={set('name')} autoComplete="name" maxLength={100} required /></Field>
                  {otp ? <div className="sm:col-span-1"><PhoneField phone={f.phone} onPhone={(v) => setF((x) => ({ ...x, phone: v }))} channels={otp.channels} verified={verified} highlight={needVerify && !phoneOk}
                    onVerified={(v) => { setVerified(v); if (v) { setNeedVerify(false); setError((e) => (/verify your mobile/i.test(e) ? '' : e)) } }} /></div>
                    : <Field label="Mobile number *"><input className="input" value={f.phone} onChange={set('phone')} type="tel" inputMode="tel" autoComplete="tel" maxLength={16} placeholder="98765 43210" required /></Field>}
                  <Field label="E-mail (you’ll sign in with it) *" className="sm:col-span-2"><input className="input" value={f.email} onChange={set('email')} type="email" autoComplete="email" maxLength={150} required /></Field>
                </>}

                {stage === 'review' && <>
                  <div className="sm:col-span-2 rounded-2xl bg-peri-50/70 p-4 text-sm">
                    <div className="flex justify-between gap-3"><div><p className="font-semibold text-peri-900">{f.organisation}</p><p className="text-slate-600">{f.city || 'City not added'} · {plans.find((p) => p.id === f.plan)?.name ?? f.plan} plan</p></div><button type="button" className="text-xs font-semibold text-peri-700 underline" onClick={() => move('hospital')}>Edit</button></div>
                    <div className="mt-3 flex justify-between gap-3 border-t border-peri-100 pt-3"><div><p className="font-medium text-peri-900">{f.name}</p><p className="text-slate-600">{f.email} · {f.phone}</p><p className="text-xs text-slate-500">Mobile {phoneOk ? 'verified' : 'not verified'}</p></div><button type="button" className="text-xs font-semibold text-peri-700 underline" onClick={() => move('contact')}>Edit</button></div>
                  </div>
                  <label className="flex items-start gap-3 rounded-xl bg-peri-50/70 p-3 text-sm text-slate-700 sm:col-span-2">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#5C5C99]" checked={f.followup_consent} onChange={(e) => setF((x) => ({ ...x, followup_consent: e.target.checked }))} />
                    <span><b className="block text-peri-900">Optional setup help and reminders</b>I agree that Hospital Comrade may send setup-related follow-ups via WhatsApp, e-mail, browser push or in-app notifications, only where that channel is available. I can change this later or ask for help without opting in.</span>
                  </label>
                  <label className="flex items-start gap-3 rounded-xl border border-slate-100 p-3 text-sm text-slate-700 sm:col-span-2">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#5C5C99]" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                    <span>I agree to the <a href={platformHref('/legal/terms')} target="_blank" rel="noreferrer" className={link}>Terms of Service</a> and the <a href={platformHref('/legal/dpa')} target="_blank" rel="noreferrer" className={link}>Data Processing Agreement</a> on behalf of my hospital, and have read the <a href={platformHref('/legal/privacy')} target="_blank" rel="noreferrer" className={link}>Privacy Policy</a>.</span>
                  </label>
                </>}

                {/* honeypot: people never see it, bots fill it */}
                <input type="text" name="website" value={f.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
                {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:col-span-2">{error}</p>}
                <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
                  {stage !== 'hospital' ? <button type="button" className="rounded-lg px-3 py-2 text-sm font-semibold text-peri-700 hover:bg-peri-50" onClick={() => move(stage === 'review' ? 'contact' : 'hospital')}>Back</button> : <span />}
                  <button type="submit" className="btn-peri" disabled={sending}>
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {stage === 'review' ? info.mode === 'instant' ? 'Create my hospital' : 'Request my free trial' : 'Continue'}
                    {!sending && <ArrowRight className="h-4 w-4" />}
                  </button>
                </div>
                {stage === 'review' && <p className="text-center text-xs text-slate-500 sm:col-span-2">{info.mode === 'instant' ? 'Your hospital is created right away.' : 'We check every request (usually within one working day) and e-mail you the link.'}</p>}
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
  const register = hospitalUrl({ slug: r.slug }, `/register?email=${encodeURIComponent(r.email)}`)
  const home = hospitalUrl({ slug: r.slug })
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
      <p className="mt-4 text-xs text-slate-500">Bookmark your hospital’s address: <a className="font-mono text-peri-700 underline" href={home}>{home.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a> — you can connect your own domain later in Settings.</p>
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
