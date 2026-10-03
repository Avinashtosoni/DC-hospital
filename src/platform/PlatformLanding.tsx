import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowRight, BarChart3, BedDouble, CalendarCheck, Check, CheckCircle2, FileText, FlaskConical, Globe, Loader2, Menu,
  MessageCircle, Receipt, ShieldCheck, Sparkles, Stethoscope, Users, X,
} from 'lucide-react'
import { platformCompany, platformDomain, platformName } from '../lib/supabase'
import { cn } from '../lib/utils'
import { PLANS, type Plan } from './plans'
import { leadProblem, submitLead, type Lead } from './api'
import LegalPage, { platformHref } from './LegalPage'
import SignupPage from './SignupPage'
import { legalDocs } from './legal'

/**
 * The Hospital Comrade product page — shown on the platform's own domain (PLATFORM_DOMAIN) when no hospital is
 * selected. Hospitals live on their own domains (or ?hospital=<slug>).
 */
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

const FEATURES = [
  { icon: CalendarCheck, title: 'Appointments & online booking', text: 'Doctor calendars, leaves and holidays, walk-ins and a 30-second booking page for patients — with OTP verification.' },
  { icon: FileText, title: 'Patient records & prescriptions', text: 'One record per patient with visits, vitals, prescriptions and reports — and a portal where patients see their own.' },
  { icon: Receipt, title: 'Billing & payments', text: 'Itemised bills, GST-ready invoices, UPI / card / cash payments, dues and daily collection reports.' },
  { icon: FlaskConical, title: 'Lab & inventory', text: 'Lab orders and results, medicine and consumable stock with low-stock alerts, and expense tracking.' },
  { icon: BedDouble, title: 'Wards & admissions', text: 'Live bed board, admissions and discharges — so reception always knows what’s free.' },
  { icon: Globe, title: 'Your own website', text: 'A fast, beautiful hospital website on your domain, edited from the dashboard — doctors, services, packages, forms.' },
  { icon: MessageCircle, title: 'WhatsApp & SMS', text: 'Booking confirmations, reminders and OTPs on WhatsApp or SMS, plus an optional WhatsApp booking bot.' },
  { icon: BarChart3, title: 'Reports & dashboards', text: 'Revenue, footfall, doctor performance and outstanding dues at a glance for the owner.' },
]

const ROLES = [
  { name: 'Owner', text: 'Dashboards, reports, settings' },
  { name: 'Doctor', text: 'Schedule, charts, prescriptions' },
  { name: 'Reception', text: 'Bookings, check-in, beds' },
  { name: 'Accounts', text: 'Bills, payments, expenses' },
  { name: 'Staff', text: 'Lab, inventory, tasks' },
  { name: 'Patient', text: 'Booking, reports, bills' },
]

const FAQS = [
  { q: 'Do I need to install anything?', a: 'No. Everything runs in the browser on any computer, tablet or phone, and can be installed as an app from the browser.' },
  { q: 'Can I use my own domain?', a: 'Yes. Your website and dashboard run on your own domain (for example www.yourhospital.in). We give you one DNS record to add and handle the SSL certificate for you.' },
  { q: 'Is my hospital’s data separate from other hospitals?', a: 'Yes. Every hospital’s data is isolated in the database itself, each staff member only sees what their role allows, and sensitive actions are logged.' },
  { q: 'Can you move my data from my old software?', a: 'Yes — patients, doctors and other masters can be imported. Enterprise plans include assisted migration.' },
]

/** the platform domain's pages: / (product), /signup (free trial), /legal/:slug */
export default function PlatformLanding() {
  const path = typeof location === 'undefined' ? '/' : location.pathname
  const legal = path.match(/^\/legal\/([a-z]+)\/?$/)
  if (legal) return <LegalPage slug={legal[1]} />
  if (/^\/signup\/?$/.test(path)) return <SignupPage />
  return <ProductPage />
}

function ProductPage() {
  useEffect(() => {
    document.title = `${platformName} · Hospital & clinic management software with your own website`
    const m = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (m) m.content = `${platformName} — appointments, patient records, billing, lab, wards, WhatsApp reminders and a hospital website on your own domain. Plans from ₹999/month.`
  }, [])

  return (
    <div className="min-h-screen bg-[#f7f7ff] text-slate-700">
      <Header />
      <main>
        <Hero />
        <Roles />
        <Features />
        <Steps />
        <Pricing />
        <Faq />
        <Contact />
      </main>
      <footer className="border-t border-peri-200/70 py-10">
        <div className="l-container flex flex-col items-center justify-between gap-4 text-sm text-slate-500 sm:flex-row">
          <Logo />
          <nav aria-label="Legal" className="flex flex-wrap justify-center gap-x-5 gap-y-2">
            {legalDocs().map((d) => <a key={d.slug} href={platformHref(`/legal/${d.slug}`)} className="hover:text-peri-700">{d.short === 'DPA' ? 'Data Processing Agreement' : d.short}</a>)}
          </nav>
        </div>
        <p className="l-container mt-6 text-center text-xs text-slate-400 sm:text-left">© {new Date().getFullYear()} {platformCompany.legalName} · {platformName} · {platformDomain}</p>
      </footer>
    </div>
  )
}

function Logo() {
  return (
    <a href="#top" className="flex items-center gap-2.5 font-display text-lg font-extrabold text-peri-900">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-peri-800 text-white shadow-glow"><Stethoscope className="h-5 w-5" /></span>
      {platformName}
    </a>
  )
}

function Header() {
  const [open, setOpen] = useState(false)
  const links = [['Features', '#features'], ['Pricing', '#pricing'], ['FAQ', '#faq'], ['Contact', '#contact']]
  return (
    <header className="sticky top-0 z-40 border-b border-peri-200/60 bg-white/75 backdrop-blur-xl">
      <div className="l-container flex h-16 items-center justify-between gap-4">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-7 text-sm font-medium text-peri-800 md:flex">
          {links.map(([l, h]) => <a key={h} href={h} className="transition hover:text-peri-500">{l}</a>)}
        </nav>
        <div className="flex items-center gap-2">
          <a href="#contact" className="hidden px-2 text-sm font-semibold text-peri-800 hover:text-peri-500 lg:inline">Talk to us</a>
          <a href={platformHref('/signup')} className="btn-peri hidden !px-5 !py-2.5 sm:inline-flex">Start free trial<ArrowRight className="h-4 w-4" /></a>
          <button type="button" className="grid h-10 w-10 place-items-center rounded-xl text-peri-800 hover:bg-peri-100 md:hidden" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav aria-label="Mobile" className="border-t border-peri-200/60 bg-white md:hidden">
          <div className="l-container flex flex-col py-3">
            {links.map(([l, h]) => <a key={h} href={h} onClick={() => setOpen(false)} className="rounded-xl px-3 py-3 font-medium text-peri-900 hover:bg-peri-50">{l}</a>)}
            <a href="#contact" onClick={() => setOpen(false)} className="rounded-xl px-3 py-3 font-medium text-peri-900 hover:bg-peri-50">Talk to us</a>
            <a href={platformHref('/signup')} className="btn-peri mt-2">Start free trial<ArrowRight className="h-4 w-4" /></a>
          </div>
        </nav>
      )}
    </header>
  )
}

function Section({ id, eyebrow, title, lead, children, className }: { id?: string; eyebrow: string; title: string; lead?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id && `${id}-title`} className={cn('scroll-mt-20 py-20 sm:py-24', className)}>
      <div className="l-container">
        <div className="mx-auto max-w-2xl text-center">
          <span className="l-eyebrow">{eyebrow}</span>
          <h2 id={id && `${id}-title`} className="mt-4 font-display text-3xl font-extrabold tracking-tight text-peri-900 sm:text-4xl">{title}</h2>
          {lead && <p className="mt-4 text-base leading-relaxed text-slate-600">{lead}</p>}
        </div>
        {children}
      </div>
    </section>
  )
}

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pb-16 pt-14 sm:pb-24 sm:pt-20">
      <div aria-hidden="true" className="absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-[#CCCCFF] opacity-60 blur-3xl" />
      <div aria-hidden="true" className="absolute -left-40 top-60 h-[420px] w-[420px] rounded-full bg-[#A3A3CC] opacity-30 blur-3xl" />
      <div className="l-container relative grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
        <div className="text-center lg:text-left">
          <span className="l-eyebrow"><Sparkles className="h-3.5 w-3.5" />Made for Indian hospitals & clinics</span>
          <h1 className="mt-5 font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-peri-900 sm:text-5xl lg:text-[3.4rem]">
            Run your hospital <span className="text-gradient">and your website</span> from one place.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-slate-600 lg:mx-0">
            Appointments, patient records, billing, lab, wards and WhatsApp reminders — plus a beautiful hospital website on your own domain. Ready in a day.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <a href={platformHref('/signup')} className="btn-peri w-full sm:w-auto">Start free trial<ArrowRight className="h-4 w-4" /></a>
            <a href="#contact" className="btn-ghost w-full sm:w-auto">Book a guided demo</a>
          </div>
          <p className="mt-5 text-sm text-slate-500">Free trial, no card · Plans from <b className="text-peri-900">{inr(999)}/month</b> · <a href="#contact" className="underline-offset-4 hover:underline">Talk to us</a></p>
        </div>
        <DashboardMock />
      </div>
    </section>
  )
}

/** a lightweight, illustrative dashboard (pure CSS — no screenshots to keep up to date) */
function DashboardMock() {
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

function Roles() {
  return (
    <section aria-label="Who uses it" className="pb-6">
      <div className="l-container">
        <p className="text-center text-xs font-semibold uppercase tracking-[.2em] text-peri-500">One login for every role in your hospital</p>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {ROLES.map((r) => (
            <li key={r.name} className="rounded-2xl border border-peri-200/80 bg-white/80 p-4 text-center shadow-soft">
              <Users className="mx-auto h-5 w-5 text-peri-600" />
              <p className="mt-2 font-display font-bold text-peri-900">{r.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">{r.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Features() {
  return (
    <Section id="features" eyebrow="Features" title="Everything a hospital runs on" lead="No more registers, spreadsheets and five different apps. Every department works on the same live data.">
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-3xl border border-peri-200/80 bg-white p-6 shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-glow">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#CCCCFF] text-peri-900"><Icon className="h-5 w-5" /></span>
            <h3 className="mt-4 font-display text-base font-bold text-peri-900">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-10 flex max-w-3xl items-start gap-3 rounded-2xl border border-peri-200 bg-white/70 p-4 text-sm text-slate-600">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-peri-700" />
        <p><b className="text-peri-900">Private by design.</b> Each hospital’s data is isolated in the database, access is role-based, and sensitive actions are recorded in an audit log.</p>
      </div>
    </Section>
  )
}

function Steps() {
  const steps = [
    { title: 'Pick a plan', text: 'Start with the modules you need — upgrade any time.' },
    { title: 'We set you up', text: 'Your hospital, staff logins and website, on your own domain with SSL.' },
    { title: 'Go live', text: 'Import your patients, invite your team and start booking.' },
  ]
  return (
    <section className="py-8" aria-label="How it works">
      <div className="l-container">
        <ol className="grid gap-4 rounded-[2rem] bg-[#292966] p-6 text-white sm:grid-cols-3 sm:p-10">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#CCCCFF] font-display font-extrabold text-[#292966]">{i + 1}</span>
              <div><p className="font-display text-lg font-bold">{s.title}</p><p className="mt-1 text-sm text-[#CCCCFF]">{s.text}</p></div>
            </li>
          ))}
        </ol>
      </div>
    </section>
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

function Pricing() {
  return (
    <Section id="pricing" eyebrow="Pricing" title="Simple, honest pricing" lead="Per hospital, per month. Prices exclude GST. Every plan includes your website, SSL certificate, backups and updates.">
      <div className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((p) => (
          <div key={p.id} className={cn('relative flex flex-col rounded-[1.75rem] border bg-white p-6 shadow-soft', p.highlight ? 'border-peri-700 ring-4 ring-[#CCCCFF]' : 'border-peri-200/80')}>
            {p.highlight && <span className="absolute -top-3 left-6 rounded-full bg-peri-800 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">Most popular</span>}
            <h3 className="font-display text-xl font-bold text-peri-900">{p.name}</h3>
            <p className="mt-1 text-sm text-slate-500">{p.tagline}</p>
            <PlanPrice p={p} />
            <ul className="mt-6 flex-1 space-y-2.5 text-sm">
              {p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-peri-600" />{f}</li>)}
            </ul>
            {p.id === 'clinic' || p.id === 'hospital'
              ? <a href={platformHref(`/signup?plan=${p.id}`)} className={cn('mt-7 w-full', p.highlight ? 'btn-peri' : 'btn-ghost')}>Start free trial</a>
              : <a href={`#contact`} data-plan={p.id} onClick={() => window.dispatchEvent(new CustomEvent('hc:plan', { detail: p.id }))}
                  className={cn('mt-7 w-full', p.highlight ? 'btn-peri' : 'btn-ghost')}>{p.cta}</a>}
          </div>
        ))}
      </div>
    </Section>
  )
}

function Faq() {
  return (
    <Section id="faq" eyebrow="FAQ" title="Questions, answered">
      <div className="mx-auto mt-12 max-w-3xl space-y-3">
        {FAQS.map((f) => (
          <details key={f.q} className="group rounded-2xl border border-peri-200/80 bg-white p-5 shadow-soft">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-peri-900">
              {f.q}<span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-peri-100 text-peri-700 transition group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">{f.a}</p>
          </details>
        ))}
      </div>
    </Section>
  )
}

const EMPTY: Lead = { name: '', organisation: '', phone: '', email: '', city: '', plan: 'hospital', message: '' }

function Contact() {
  const [f, setF] = useState<Lead>(EMPTY)
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState('')
  useEffect(() => {
    const on = (e: Event) => setF((x) => ({ ...x, plan: String((e as CustomEvent).detail) }))
    window.addEventListener('hc:plan', on)
    return () => window.removeEventListener('hc:plan', on)
  }, [])
  const set = (k: keyof Lead) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const p = leadProblem(f)
    if (p) { setError(p); return }
    setError(''); setState('sending')
    try { await submitLead(f); setState('done') } catch (err) { setError(err instanceof Error ? err.message : 'Could not send. Please try again.'); setState('idle') }
  }

  return (
    <Section id="contact" eyebrow="Contact" title="Let’s set up your hospital" lead="Tell us a little about your hospital or clinic — we’ll call you back within one working day with a demo and a quote.">
      <div className="mx-auto mt-12 max-w-3xl rounded-[2rem] border border-peri-200/80 bg-white p-6 shadow-soft sm:p-8">
        {state === 'done' ? (
          <div className="py-10 text-center" role="status">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <p className="mt-4 font-display text-xl font-bold text-peri-900">Thank you, {f.name.trim().replace(/^(dr|mr|mrs|ms|shri|smt)\.?\s+/i, '').split(/\s+/)[0]}!</p>
            <p className="mt-2 text-sm text-slate-600">We’ve received your details and will call you on {f.phone} soon.</p>
            <a href={platformHref('/signup')} className="btn-peri mt-6">Or start a free trial now<ArrowRight className="h-4 w-4" /></a>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name *"><input className="input" value={f.name} onChange={set('name')} autoComplete="name" maxLength={100} required /></Field>
            <Field label="Hospital / clinic name *"><input className="input" value={f.organisation} onChange={set('organisation')} autoComplete="organization" maxLength={150} required /></Field>
            <Field label="Mobile number *"><input className="input" value={f.phone} onChange={set('phone')} type="tel" inputMode="tel" autoComplete="tel" maxLength={20} required /></Field>
            <Field label="Email"><input className="input" value={f.email} onChange={set('email')} type="email" autoComplete="email" maxLength={150} /></Field>
            <Field label="City"><input className="input" value={f.city} onChange={set('city')} autoComplete="address-level2" maxLength={80} /></Field>
            <Field label="Plan you’re interested in">
              <select className="input" value={f.plan} onChange={set('plan')}>
                {PLANS.map((p) => <option key={p.id} value={p.id}>{p.name}{p.price ? ` — ${inr(p.price)}${p.suffix ?? ''}/month` : ''}</option>)}
                <option value="unsure">Not sure yet</option>
              </select>
            </Field>
            <Field label="Anything we should know?" className="sm:col-span-2"><textarea className="input min-h-[110px]" value={f.message} onChange={set('message')} maxLength={2000} placeholder="Number of doctors, beds, software you use today…" /></Field>
            {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:col-span-2">{error}</p>}
            <div className="flex flex-col items-center gap-3 sm:col-span-2 sm:flex-row sm:justify-between">
              <p className="text-xs text-slate-500">We only use these details to contact you about {platformName} — see our <a href={platformHref('/legal/privacy')} className="underline underline-offset-2 hover:text-peri-700">Privacy Policy</a>.</p>
              <button type="submit" className="btn-peri w-full sm:w-auto" disabled={state === 'sending'}>
                {state === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Request a call back
              </button>
            </div>
          </form>
        )}
      </div>
    </Section>
  )
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <label className={cn('block text-sm font-medium text-peri-900', className)}><span className="mb-1.5 block">{label}</span>{children}</label>
}
