import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight, ArrowUpRight, BadgeCheck, CalendarCheck, CalendarDays, Check, ChevronDown, Clock, CreditCard,
  FileText, FlaskConical, Globe2, HeartPulse, Languages, Mail, MapPin, Menu, Phone, Pill, Quote, Search,
  ShieldCheck, Siren, Sparkles, Stethoscope, Timer, Users, Wallet, X,
} from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { HOSPITAL, cn } from '../../lib/utils'
import { DOCTORS, FAQS, INSURERS, NAV_LINKS, PACKAGES, SPECIALITIES, STATS, TESTIMONIALS, type LandingDoctor } from './content'
import { useActiveSection, useRevealAll, useScroll, prefersReducedMotion } from './hooks'
import { Counter, LandingLogo, Reveal, SOCIALS, SocialIcon, SpotlightCard, Stars } from './parts'

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`
const TEL = `tel:${HOSPITAL.phone.replace(/\s+/g, '')}`

/** Where "Book" CTAs go: patients book from the portal; guests sign up first. */
function useBookHref() {
  const { user } = useAuth()
  return user ? '/appointments' : '/register'
}

export default function Landing() {
  const root = useRef<HTMLDivElement>(null)
  useRevealAll(root)

  useEffect(() => {
    const prev = document.title
    document.title = 'DC Hospital · Multi-speciality care, 24×7 | Book appointments online'
    return () => { document.title = prev }
  }, [])

  return (
    <div ref={root} className="relative min-h-screen overflow-x-clip bg-[#fbfbff] font-sans text-slate-700 antialiased selection:bg-peri-300 selection:text-peri-950">
      <a href="#main" className="sr-only z-[100] rounded-full bg-peri-800 px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <Navbar />
      <main id="main">
        <Hero />
        <SocialProof />
        <Features />
        <Doctors />
        <Benefits />
        <Testimonials />
        <Packages />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <MobileCtaBar />
    </div>
  )
}

/* ───────────────────────────────── Navbar ───────────────────────────────── */

function Navbar() {
  const { scrolled, progress } = useScroll()
  const ids = useMemo(() => NAV_LINKS.map((l) => l.id), [])
  const active = useActiveSection(ids)
  const [open, setOpen] = useState(false)
  const { user } = useAuth()
  const book = useBookHref()

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      {/* top info strip */}
      <div className={cn('hidden overflow-hidden bg-peri-900 text-peri-200 transition-all duration-500 md:block', scrolled ? 'max-h-0' : 'max-h-10')}>
        <div className="l-container flex h-9 items-center justify-between text-xs">
          <p className="flex items-center gap-2"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>Emergency & ambulance open 24×7</p>
          <div className="flex items-center gap-5">
            <a href={TEL} className="flex items-center gap-1.5 transition hover:text-white"><Phone className="h-3.5 w-3.5" />{HOSPITAL.phone}</a>
            <a href={`mailto:${HOSPITAL.email}`} className="flex items-center gap-1.5 transition hover:text-white"><Mail className="h-3.5 w-3.5" />{HOSPITAL.email}</a>
          </div>
        </div>
      </div>

      <div className={cn('transition-all duration-500', scrolled ? 'py-2' : 'py-3 md:py-4')}>
        <nav
          aria-label="Primary"
          className={cn(
            'l-container relative flex items-center justify-between gap-4 rounded-full transition-all duration-500',
            scrolled && 'max-w-6xl border border-white/70 bg-white/75 py-2 shadow-glass backdrop-blur-xl sm:px-4',
          )}
        >
          <LandingLogo />
          <ul className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map((l) => (
              <li key={l.id}>
                <a
                  href={`#${l.id}`}
                  className={cn(
                    'relative rounded-full px-4 py-2 text-sm font-medium transition-colors',
                    active === l.id ? 'text-peri-900' : 'text-slate-500 hover:text-peri-800',
                  )}
                >
                  {active === l.id && <span className="absolute inset-0 -z-10 animate-fade-in rounded-full bg-peri-200/70" />}
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Link to={user ? '/' : '/login'} className="hidden rounded-full px-4 py-2 text-sm font-semibold text-peri-800 transition hover:bg-peri-100 sm:inline-flex">
              {user ? 'Dashboard' : 'Sign in'}
            </Link>
            <Link to={book} className="btn-peri hidden !px-5 !py-2.5 sm:inline-flex">Book appointment<ArrowRight className="h-4 w-4" /></Link>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="grid h-10 w-10 place-items-center rounded-full border border-peri-200 bg-white/80 text-peri-800 backdrop-blur transition hover:bg-white lg:hidden"
              aria-label="Open menu" aria-expanded={open} aria-controls="mobile-menu"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
          {/* scroll progress */}
          <span aria-hidden="true" className={cn('absolute inset-x-6 -bottom-px h-[2px] origin-left rounded-full bg-gradient-to-r from-peri-400 via-peri-600 to-peri-800 transition-opacity', scrolled ? 'opacity-100' : 'opacity-0')} style={{ transform: `scaleX(${progress})` }} />
        </nav>
      </div>

      {/* mobile drawer */}
      <div id="mobile-menu" className={cn('fixed inset-0 z-50 lg:hidden', open ? 'pointer-events-auto' : 'pointer-events-none')} aria-hidden={!open}>
        <div className={cn('absolute inset-0 bg-peri-950/30 backdrop-blur-sm transition-opacity duration-300', open ? 'opacity-100' : 'opacity-0')} onClick={() => setOpen(false)} />
        <div className={cn('absolute inset-x-3 top-3 rounded-3xl border border-white/80 bg-white/95 p-5 shadow-2xl backdrop-blur-xl transition-all duration-300', open ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0')}>
          <div className="flex items-center justify-between">
            <LandingLogo />
            <button type="button" onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center rounded-full bg-peri-100 text-peri-800" aria-label="Close menu" tabIndex={open ? 0 : -1}><X className="h-5 w-5" /></button>
          </div>
          <ul className="mt-6 space-y-1">
            {NAV_LINKS.map((l, i) => (
              <li key={l.id} className={cn('transition-all duration-500', open ? 'translate-x-0 opacity-100' : '-translate-x-3 opacity-0')} style={{ transitionDelay: open ? `${80 + i * 50}ms` : '0ms' }}>
                <a href={`#${l.id}`} onClick={() => setOpen(false)} tabIndex={open ? 0 : -1} className="flex items-center justify-between rounded-2xl px-4 py-3.5 font-display text-lg font-semibold text-peri-900 transition hover:bg-peri-100">
                  {l.label}<ArrowUpRight className="h-4 w-4 text-peri-400" />
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Link to={user ? '/' : '/login'} tabIndex={open ? 0 : -1} className="btn-ghost">{user ? 'Dashboard' : 'Sign in'}</Link>
            <Link to={book} tabIndex={open ? 0 : -1} className="btn-peri">Book now</Link>
          </div>
          <a href={TEL} tabIndex={open ? 0 : -1} className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-rose-50 py-3 text-sm font-semibold text-rose-600"><Siren className="h-4 w-4" />Emergency: {HOSPITAL.phone}</a>
        </div>
      </div>
    </header>
  )
}

/* ───────────────────────────────── Hero ───────────────────────────────── */

function AmbientBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#f3f3ff_0%,#fbfbff_55%,#fbfbff_100%)]" />
      <div className="absolute inset-0 opacity-[.35] [background-image:linear-gradient(rgba(92,92,153,.09)_1px,transparent_1px),linear-gradient(90deg,rgba(92,92,153,.09)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,#000_20%,transparent_70%)]" />
      <div className="motion-safe-only absolute -left-40 -top-32 h-[520px] w-[520px] animate-drift rounded-full bg-peri-300/60 blur-[110px]" />
      <div className="motion-safe-only absolute -right-32 top-24 h-[460px] w-[460px] animate-drift-slow rounded-full bg-peri-400/40 blur-[120px]" />
      <div className="motion-safe-only absolute bottom-0 left-1/3 h-[300px] w-[300px] animate-drift rounded-full bg-white blur-[80px]" />
    </div>
  )
}

function Hero() {
  const navigate = useNavigate()
  const book = useBookHref()
  const [spec, setSpec] = useState('')
  const [when, setWhen] = useState<'Today' | 'Tomorrow' | 'Later'>('Today')
  const stage = useRef<HTMLDivElement>(null)

  // subtle parallax of the floating cards following the pointer
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion() || e.pointerType !== 'mouse') return
    const el = stage.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', String((e.clientX - r.left) / r.width - 0.5))
    el.style.setProperty('--my', String((e.clientY - r.top) / r.height - 0.5))
  }
  const onLeave = () => { stage.current?.style.setProperty('--mx', '0'); stage.current?.style.setProperty('--my', '0') }
  const depth = (d: number) => ({ transform: `translate3d(calc(var(--mx,0) * ${d}px), calc(var(--my,0) * ${d}px), 0)` })

  const headline = ['Care', 'that', 'feels', 'personal.']
  const headline2 = ['Booking', 'that', 'feels', 'effortless.']

  return (
    <section className="relative isolate pb-16 pt-28 sm:pt-32 md:pt-40 lg:pb-24" aria-labelledby="hero-title">
      <AmbientBackdrop />
      <div className="l-container grid items-center gap-14 lg:grid-cols-[1.08fr_1fr] lg:gap-10">
        {/* copy */}
        <div className="relative text-center lg:text-left">
          <div className="l-rise inline-flex items-center gap-2 rounded-full border border-peri-300/70 bg-white/80 py-1 pl-1 pr-4 text-xs font-medium text-peri-800 shadow-sm backdrop-blur" style={{ animationDelay: '60ms' }}>
            <span className="rounded-full bg-peri-800 px-2.5 py-1 text-[11px] font-semibold text-white">NEW</span>
            Book, consult & get reports — all online
            <Sparkles className="h-3.5 w-3.5 text-peri-500" />
          </div>

          <h1 id="hero-title" className="mt-6 font-display text-[2.35rem] font-extrabold leading-[1.08] tracking-tight text-peri-900 sm:text-6xl lg:text-[3.6rem] xl:text-[4rem]">
            <span className="block">
              {headline.map((w, i) => <span key={i} className="l-rise mr-[.25em] inline-block" style={{ animationDelay: `${150 + i * 70}ms` }}>{w}</span>)}
            </span>
            <span className="block">
              {headline2.map((w, i) => (
                <span key={i} className={cn('l-rise mr-[.25em] inline-block', i === 3 && 'text-gradient')} style={{ animationDelay: `${430 + i * 70}ms` }}>{w}</span>
              ))}
            </span>
          </h1>

          <p className="l-rise mx-auto mt-6 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg lg:mx-0" style={{ animationDelay: '760ms' }}>
            35+ trusted specialists, 12 super-specialities and a 24×7 emergency team — with appointments in 30 seconds,
            digital prescriptions and lab reports right on your phone. That’s healthcare the way it should be.
          </p>

          {/* quick booking widget */}
          <form
            onSubmit={(e) => { e.preventDefault(); navigate(book) }}
            className="l-rise glass mx-auto mt-8 max-w-xl rounded-3xl p-2 text-left lg:mx-0"
            style={{ animationDelay: '880ms' }}
            aria-label="Find a doctor"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-4 py-2.5 transition focus-within:bg-white sm:min-w-[170px]">
                <Search className="h-5 w-5 shrink-0 text-peri-500" aria-hidden="true" />
                <span className="flex-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-peri-500">Speciality</span>
                  <select value={spec} onChange={(e) => setSpec(e.target.value)} className="-ml-1 w-full cursor-pointer appearance-none bg-transparent text-sm font-medium text-peri-900 outline-none" aria-label="Choose speciality">
                    <option value="">All specialities</option>
                    {SPECIALITIES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </span>
                <ChevronDown className="h-4 w-4 text-peri-400" aria-hidden="true" />
              </label>
              <div className="hidden h-10 w-px bg-peri-200 sm:block" />
              <div className="flex items-center gap-1 px-2 sm:px-0" role="radiogroup" aria-label="Preferred day">
                {(['Today', 'Tomorrow', 'Later'] as const).map((w) => (
                  <button key={w} type="button" role="radio" aria-checked={when === w} onClick={() => setWhen(w)}
                    className={cn('flex-1 whitespace-nowrap rounded-full px-3 py-2 text-xs font-semibold transition sm:flex-none', when === w ? 'bg-peri-200 text-peri-900' : 'text-slate-500 hover:bg-peri-100')}>
                    {w}
                  </button>
                ))}
              </div>
              <button type="submit" className="btn-peri shrink-0 whitespace-nowrap !rounded-2xl sm:!px-5">
                <CalendarCheck className="h-4 w-4" /><span>Find a slot</span>
              </button>
            </div>
          </form>

          {/* trust row */}
          <div className="l-rise mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center lg:justify-start" style={{ animationDelay: '1000ms' }}>
            <div className="flex -space-x-3">
              {DOCTORS.map((d) => <img key={d.name} src={d.img} alt="" width={40} height={40} className="h-10 w-10 rounded-full border-2 border-white object-cover shadow-sm" />)}
              <span className="grid h-10 w-10 place-items-center rounded-full border-2 border-white bg-peri-800 text-[11px] font-bold text-white">+31</span>
            </div>
            <div className="text-center sm:text-left">
              <div className="flex items-center justify-center gap-2 sm:justify-start"><Stars value={5} /><span className="text-sm font-bold text-peri-900">4.9/5</span></div>
              <p className="text-xs text-slate-500">Loved by <strong className="text-peri-800">1.2 lakh+</strong> patients & families</p>
            </div>
          </div>
        </div>

        {/* visual */}
        <div ref={stage} onPointerMove={onMove} onPointerLeave={onLeave} className="relative mx-auto w-full max-w-[520px] [--mx:0] [--my:0]">
          <div className="l-rise relative" style={{ animationDelay: '300ms' }}>
            <div aria-hidden="true" className="absolute -inset-4 rounded-[3rem] bg-gradient-to-br from-peri-300 via-peri-200 to-white opacity-80 blur-2xl" />
            <div className="relative overflow-hidden rounded-[2.5rem] border-[6px] border-white bg-peri-300 shadow-[0_40px_80px_-30px_rgba(41,41,102,.45)]">
              <img src="/landing/hero.webp" alt="Smiling DC Hospital doctor holding a tablet" width={900} height={1117} {...{ fetchpriority: 'high' }} className="aspect-[4/5] w-full object-cover transition-transform duration-[1.5s] ease-out hover:scale-[1.03]" style={{ transform: 'translate3d(calc(var(--mx,0) * -8px), calc(var(--my,0) * -8px), 0) scale(1.04)' }} />
              <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-peri-900/40 to-transparent" />
            </div>
          </div>

          {/* floating cards */}
          <div className="absolute -left-3 top-8 sm:-left-10" style={depth(26)}>
            <div className="l-rise" style={{ animationDelay: '900ms' }}><div className="glass w-52 animate-float rounded-2xl p-3.5 motion-safe-only">
              <div className="flex items-center gap-3">
                <img src="/landing/doc-kavita.webp" alt="" width={40} height={40} className="h-10 w-10 rounded-xl object-cover" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-peri-900">Dr. Kavita Rao</p>
                  <p className="text-[11px] text-slate-500">Neurologist</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-xl bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700">
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Next slot</span>Today · 11:30
              </div>
            </div></div>
          </div>

          <div className="absolute -right-2 top-[38%] sm:-right-8" style={depth(-20)}>
            <div className="l-rise" style={{ animationDelay: '1050ms' }}><div className="glass flex animate-float-slow items-center gap-3 rounded-2xl p-3 pr-4 motion-safe-only">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-peri-800 text-white"><FlaskConical className="h-5 w-5" /></span>
              <div>
                <p className="text-xs font-semibold text-peri-900">Lab report ready</p>
                <p className="flex items-center gap-1 text-[11px] text-emerald-600"><BadgeCheck className="h-3.5 w-3.5" />Lipid profile · Normal</p>
              </div>
            </div></div>
          </div>

          <div className="absolute -bottom-6 left-2 sm:-left-6" style={depth(18)}>
            <div className="l-rise glass w-56 rounded-2xl p-3.5" style={{ animationDelay: '1200ms' }}>
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-peri-900"><HeartPulse className="h-4 w-4 text-rose-500" />Heart rate</p>
                <span className="text-[11px] text-slate-500">Live</span>
              </div>
              <div className="mt-1 flex items-end justify-between gap-3">
                <p className="font-display text-2xl font-bold text-peri-900">72<span className="ml-1 text-xs font-medium text-slate-500">bpm</span></p>
                <svg viewBox="0 0 120 36" className="h-9 w-28" aria-hidden="true">
                  <path d="M0 20 H30 L36 8 L44 32 L52 4 L58 20 H80 L86 14 L92 24 L96 20 H120" fill="none" stroke="#5c5c99" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="400" className="motion-safe-only animate-draw" />
                </svg>
              </div>
            </div>
          </div>

          <div className="absolute -bottom-4 right-3 sm:-right-4" style={depth(-14)}>
            <div className="l-rise flex items-center gap-2 rounded-2xl bg-peri-900 px-4 py-3 text-white shadow-glow" style={{ animationDelay: '1350ms' }}>
              <ShieldCheck className="h-5 w-5 text-peri-300" />
              <div className="leading-tight"><p className="text-xs font-semibold">Cashless</p><p className="text-[11px] text-peri-300">30+ insurers</p></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ───────────────────────────────── Social proof ───────────────────────────────── */

function SocialProof() {
  return (
    <section aria-label="DC Hospital in numbers" className="relative py-10 sm:py-14">
      <div className="l-container">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <Reveal key={s.label} delay={i * 90} className="rounded-3xl border border-peri-200/80 bg-white/80 p-5 text-center shadow-soft backdrop-blur transition duration-500 hover:-translate-y-1 sm:p-7">
              <p className="font-display text-3xl font-extrabold tracking-tight text-peri-900 sm:text-4xl">
                <Counter value={s.value} suffix={s.suffix} decimals={s.decimals} format={s.format} />
              </p>
              <p className="mt-1.5 text-xs font-medium text-slate-500 sm:text-sm">{s.label}</p>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-12 text-center" delay={100}>
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-peri-500">Cashless treatment with 30+ insurers & government schemes</p>
        </Reveal>
        <div className="mask-fade-x group mt-6 overflow-hidden" aria-hidden="true">
          <div className="motion-safe-only flex w-max animate-marquee gap-4 group-hover:[animation-play-state:paused]">
            {[...INSURERS, ...INSURERS].map((n, i) => (
              <span key={i} className="flex items-center gap-2 whitespace-nowrap rounded-2xl border border-peri-200/70 bg-white/70 px-6 py-3.5 font-display text-base font-bold text-peri-400 transition hover:text-peri-800">
                <ShieldCheck className="h-4 w-4" />{n}
              </span>
            ))}
          </div>
        </div>
        <p className="sr-only">Insurance partners: {INSURERS.join(', ')}.</p>
      </div>
    </section>
  )
}

/* ───────────────────────────────── Features (bento) ───────────────────────────────── */

function SectionHeader({ eyebrow, title, lead, id, center = true }: { eyebrow: string; title: ReactNode; lead?: string; id: string; center?: boolean }) {
  return (
    <div className={cn('max-w-2xl', center && 'mx-auto text-center')}>
      <Reveal><span className="l-eyebrow">{eyebrow}</span></Reveal>
      <Reveal as="h2" id={id} delay={80} className="l-h2">{title}</Reveal>
      {lead && <Reveal as="p" delay={160} className="l-lead">{lead}</Reveal>}
    </div>
  )
}

function MiniScheduler() {
  const days = useMemo(() => {
    const out: { key: string; dow: string; d: number }[] = []
    const now = new Date()
    for (let i = 0; i < 5; i++) {
      const dt = new Date(now); dt.setDate(now.getDate() + i)
      out.push({ key: dt.toDateString(), dow: i === 0 ? 'Today' : dt.toLocaleDateString('en-IN', { weekday: 'short' }), d: dt.getDate() })
    }
    return out
  }, [])
  const slots = ['09:30', '10:00', '11:30', '12:00', '16:30', '17:00']
  const taken = new Set(['10:00', '16:30'])
  const [day, setDay] = useState(0)
  const [slot, setSlot] = useState('11:30')
  const [done, setDone] = useState(false)

  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 2600); return () => clearTimeout(t) }, [done])

  return (
    <div className="relative mt-6 rounded-2xl border border-peri-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3 border-b border-peri-100 pb-3">
        <img src="/landing/doc-arjun.webp" alt="" width={36} height={36} className="h-9 w-9 rounded-xl object-cover" />
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-peri-900">Dr. Arjun Mehta</p><p className="text-xs text-slate-500">Cardiology · {inr(1200)}</p></div>
        <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">Available</span>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Pick a day">
        {days.map((d, i) => (
          <button key={d.key} type="button" role="radio" aria-checked={day === i} onClick={() => { setDay(i); setDone(false) }}
            className={cn('rounded-xl py-2 text-center transition duration-300', day === i ? 'bg-peri-800 text-white shadow-glow' : 'bg-peri-50 text-peri-800 hover:bg-peri-100')}>
            <span className="block text-[10px] font-medium opacity-80">{d.dow}</span>
            <span className="block text-sm font-bold">{d.d}</span>
          </button>
        ))}
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Pick a time">
        {slots.map((s) => {
          const off = taken.has(s)
          return (
            <button key={s} type="button" role="radio" aria-checked={slot === s} disabled={off} onClick={() => { setSlot(s); setDone(false) }}
              className={cn('rounded-lg border py-1.5 text-xs font-semibold transition',
                off ? 'cursor-not-allowed border-transparent bg-slate-50 text-slate-300 line-through'
                  : slot === s ? 'border-peri-600 bg-peri-100 text-peri-900' : 'border-peri-200 text-peri-700 hover:border-peri-400')}>
              {s}
            </button>
          )
        })}
      </div>
      <button type="button" onClick={() => setDone(true)}
        className={cn('mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all duration-500',
          done ? 'bg-emerald-500 text-white' : 'bg-peri-800 text-white hover:bg-peri-900')} aria-live="polite">
        {done ? <><Check className="h-4 w-4 animate-pop-in" />Booked for {days[day].dow} · {slot}</> : <>Confirm {slot}<ArrowRight className="h-4 w-4" /></>}
      </button>
    </div>
  )
}

function Features() {
  return (
    <section id="features" aria-labelledby="features-title" className="relative scroll-mt-24 py-20 sm:py-28">
      <div className="l-container">
        <SectionHeader id="features-title" eyebrow="Care, simplified" title={<>Everything you need, <span className="text-gradient">before, during & after</span> your visit</>}
          lead="From the first booking to your final report, DC Hospital keeps every step clear, quick and connected — so you spend less time waiting and more time healing." />

        <div className="mt-14 grid gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-3">
          <Reveal className="md:col-span-2 lg:col-span-1 lg:row-span-2" delay={0}>
            <SpotlightCard className="h-full p-6 sm:p-7">
              <FeatureIcon icon={CalendarDays} />
              <h3 className="mt-5 font-display text-xl font-bold text-peri-900">Book in 30 seconds</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">See real-time availability for every doctor, pick a slot and you’re done. Try it right here.</p>
              <MiniScheduler />
            </SpotlightCard>
          </Reveal>

          <Reveal delay={90}>
            <SpotlightCard className="h-full p-6 sm:p-7">
              <FeatureIcon icon={Pill} />
              <h3 className="mt-5 font-display text-xl font-bold text-peri-900">Digital prescriptions</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">Clear dosage, timing and duration — always on your phone, easy to share with any pharmacy.</p>
              <ul className="mt-5 space-y-2">
                {[['Atorvastatin 20mg', 'Once daily · night'], ['Metformin 500mg', 'Twice · after meals']].map(([n, f]) => (
                  <li key={n} className="flex items-center justify-between rounded-xl bg-peri-50 px-3 py-2 text-xs transition group-hover:bg-peri-100"><span className="font-semibold text-peri-900">{n}</span><span className="text-slate-500">{f}</span></li>
                ))}
              </ul>
            </SpotlightCard>
          </Reveal>

          <Reveal delay={180}>
            <SpotlightCard className="h-full p-6 sm:p-7">
              <FeatureIcon icon={FlaskConical} />
              <h3 className="mt-5 font-display text-xl font-bold text-peri-900">Reports on your phone</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">NABL-standard lab with results delivered online — most within 6 hours.</p>
              <div className="mt-5 space-y-2.5">
                {[['CBC', 100, 'Ready'], ['Thyroid profile', 70, 'Processing'], ['Vitamin D', 35, 'Sample taken']].map(([n, p, s]) => (
                  <div key={n as string}>
                    <div className="mb-1 flex justify-between text-[11px]"><span className="font-semibold text-peri-900">{n}</span><span className={p === 100 ? 'text-emerald-600' : 'text-slate-500'}>{s}</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-peri-100"><div className={cn('h-full rounded-full transition-all duration-1000 group-hover:brightness-110', p === 100 ? 'bg-emerald-400' : 'bg-peri-500')} style={{ width: `${p}%` }} /></div>
                  </div>
                ))}
              </div>
            </SpotlightCard>
          </Reveal>

          <Reveal delay={90}>
            <SpotlightCard className="h-full p-6 sm:p-7">
              <div className="relative inline-grid">
                <span className="motion-safe-only absolute inset-0 animate-pulse-ring rounded-2xl bg-rose-300" aria-hidden="true" />
                <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-rose-500 text-white shadow-lg shadow-rose-500/30"><Siren className="h-6 w-6" /></span>
              </div>
              <h3 className="mt-5 font-display text-xl font-bold text-peri-900">24×7 emergency & ICU</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">Trauma, cardiac and stroke-ready team with ambulance dispatch in minutes.</p>
              <a href={TEL} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-rose-600 transition hover:gap-3">Call {HOSPITAL.phone}<ArrowRight className="h-4 w-4" /></a>
            </SpotlightCard>
          </Reveal>

          <Reveal delay={180}>
            <SpotlightCard className="h-full p-6 sm:p-7">
              <FeatureIcon icon={Wallet} />
              <h3 className="mt-5 font-display text-xl font-bold text-peri-900">Honest, itemised billing</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">Every charge explained upfront. Pay by UPI, card or insurance — no surprises at discharge.</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {['UPI', 'Cards', 'Cashless', 'EMI'].map((m) => <span key={m} className="rounded-full border border-peri-200 bg-white px-3 py-1 text-xs font-semibold text-peri-700 transition group-hover:border-peri-300">{m}</span>)}
              </div>
            </SpotlightCard>
          </Reveal>
        </div>

        {/* speciality chips */}
        <Reveal className="mt-10 flex flex-wrap justify-center gap-2" delay={120}>
          {SPECIALITIES.map((s) => (
            <span key={s} className="cursor-default rounded-full border border-peri-200 bg-white/80 px-4 py-2 text-sm font-medium text-peri-700 transition duration-300 hover:-translate-y-0.5 hover:border-peri-400 hover:bg-peri-800 hover:text-white">{s}</span>
          ))}
        </Reveal>
      </div>
    </section>
  )
}

function FeatureIcon({ icon: Icon }: { icon: typeof CalendarDays }) {
  return (
    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-peri-200 to-peri-300 text-peri-800 ring-1 ring-inset ring-white/60 transition duration-500 group-hover:scale-110 group-hover:from-peri-600 group-hover:to-peri-800 group-hover:text-white">
      <Icon className="h-6 w-6" />
    </span>
  )
}

/* ───────────────────────────────── Doctors ───────────────────────────────── */

function Doctors() {
  const depts = useMemo(() => ['All', ...DOCTORS.map((d) => d.dept)], [])
  const [filter, setFilter] = useState('All')
  const list = filter === 'All' ? DOCTORS : DOCTORS.filter((d) => d.dept === filter)

  return (
    <section id="doctors" aria-labelledby="doctors-title" className="relative scroll-mt-24 overflow-hidden py-20 sm:py-28">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-full bg-gradient-to-b from-peri-100/70 via-peri-50/40 to-transparent" />
      <div className="l-container">
        <div className="flex flex-col items-center justify-between gap-8 lg:flex-row lg:items-end">
          <SectionHeader id="doctors-title" center={false} eyebrow="Meet our specialists" title={<>Doctors who listen <span className="text-gradient">first</span></>}
            lead="Senior consultants from AIIMS, PGI and CMC Vellore — who take time to explain, not just prescribe." />
          <Reveal delay={200} className="w-full lg:w-auto">
            <div className="mask-fade-x -mx-5 overflow-x-auto px-5 pb-1 sm:mx-0 sm:px-0 lg:[mask-image:none]">
              <div className="flex w-max gap-1 rounded-full border border-peri-200 bg-white/80 p-1 shadow-sm backdrop-blur" role="tablist" aria-label="Filter doctors by department">
                {depts.map((d) => (
                  <button key={d} type="button" role="tab" aria-selected={filter === d} onClick={() => setFilter(d)}
                    className={cn('rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300', filter === d ? 'bg-peri-800 text-white shadow-glow' : 'text-slate-500 hover:text-peri-800')}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </Reveal>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" role="tabpanel">
          {list.map((d, i) => <DoctorCard key={d.name + filter} d={d} delay={i * 90} />)}
        </div>

        <Reveal className="mt-12 flex justify-center" delay={100}>
          <Link to={useBookHref()} className="btn-ghost group">View all 35+ specialists<ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></Link>
        </Reveal>
      </div>
    </section>
  )
}

function DoctorCard({ d, delay }: { d: LandingDoctor; delay: number }) {
  const book = useBookHref()
  return (
    <article className="group relative animate-pop-in overflow-hidden rounded-[1.75rem] border border-peri-200/80 bg-white shadow-soft transition duration-500 hover:-translate-y-1.5 hover:shadow-[0_30px_60px_-25px_rgba(41,41,102,.35)] focus-within:ring-4 focus-within:ring-peri-300" style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}>
      <div className="relative aspect-[4/4.2] overflow-hidden bg-peri-300">
        <img src={d.img} alt={`Portrait of ${d.name}, ${d.role}`} width={560} height={560} loading="lazy" className="h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.07]" />
        <span className="absolute left-3 top-3 rounded-full bg-white/85 px-3 py-1 text-[11px] font-semibold text-peri-800 backdrop-blur">{d.dept}</span>
        <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-peri-900/80 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
          <svg viewBox="0 0 20 20" className="h-3 w-3 text-amber-300" fill="currentColor" aria-hidden="true"><path d="M10 1.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.8L10 1.5z" /></svg>{d.rating.toFixed(1)}
        </span>
        {/* hover detail sheet */}
        <div className="absolute inset-x-3 bottom-3 translate-y-[calc(100%+12px)] rounded-2xl border border-white/60 bg-white/85 p-3 text-xs text-slate-600 opacity-0 backdrop-blur-xl transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
          <p className="flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5 text-peri-600" />{d.days}</p>
          <p className="mt-1.5 flex items-center gap-2"><Languages className="h-3.5 w-3.5 text-peri-600" />{d.langs}</p>
          <p className="mt-1.5 flex items-center gap-2 font-semibold text-emerald-700"><Clock className="h-3.5 w-3.5" />Next: {d.next}</p>
        </div>
      </div>
      <div className="p-5">
        <h3 className="font-display text-lg font-bold text-peri-900">{d.name}</h3>
        <p className="text-sm text-slate-500">{d.role}</p>
        <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1"><Stethoscope className="h-3.5 w-3.5 text-peri-500" />{d.exp} yrs</span>
          <span className="h-3 w-px bg-peri-200" />
          <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5 text-peri-500" />{d.reviews.toLocaleString('en-IN')} reviews</span>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-peri-100 pt-4">
          <p className="text-sm"><span className="font-display text-lg font-bold text-peri-900">{inr(d.fee)}</span><span className="text-xs text-slate-500"> / visit</span></p>
          <Link to={book} className="inline-flex items-center gap-1.5 rounded-full bg-peri-100 px-4 py-2 text-xs font-semibold text-peri-800 transition duration-300 hover:bg-peri-800 hover:text-white" aria-label={`Book appointment with ${d.name}`}>
            Book<ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </article>
  )
}

/* ───────────────────────────────── Benefits + how it works ───────────────────────────────── */

function Benefits() {
  const benefits = [
    { icon: Timer, title: 'Wait less, heal more', text: 'Timed OPD slots and live queue updates cut average waiting to under 10 minutes.' },
    { icon: FileText, title: 'One record for life', text: 'Visits, prescriptions, scans and bills — your complete history in one secure place.' },
    { icon: CreditCard, title: 'Know the cost upfront', text: 'Transparent package pricing and itemised bills. Cashless with 30+ insurers.' },
    { icon: Users, title: 'Care for the whole family', text: 'Manage appointments and reports for parents and kids from a single account.' },
  ]
  const steps = [
    { n: '01', title: 'Create your free account', text: 'Sign up in seconds with your phone or email.' },
    { n: '02', title: 'Choose doctor & time', text: 'Filter by speciality, language or earliest slot.' },
    { n: '03', title: 'Visit & get everything online', text: 'Prescriptions, reports and bills land in your portal.' },
  ]
  return (
    <section id="why-us" aria-labelledby="why-title" className="relative scroll-mt-24 py-20 sm:py-28">
      <div className="l-container grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <Reveal variant="left" className="relative order-last lg:order-first">
          <div aria-hidden="true" className="absolute -inset-6 rounded-[3rem] bg-gradient-to-tr from-peri-300/70 via-peri-200/50 to-transparent blur-2xl" />
          <div className="relative overflow-hidden rounded-[2.25rem] border-[6px] border-white shadow-[0_40px_80px_-30px_rgba(41,41,102,.4)]">
            <img src="/landing/care.webp" alt="Bright, calm private patient room at DC Hospital" width={1100} height={821} loading="lazy" className="aspect-[4/3.4] w-full object-cover transition duration-1000 hover:scale-105" />
          </div>
          <div className="glass absolute -bottom-6 -right-2 w-48 animate-float rounded-2xl p-4 motion-safe-only sm:-right-6">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-peri-500">Avg. OPD wait</p>
            <p className="mt-1 font-display text-3xl font-extrabold text-peri-900">8 <span className="text-base font-semibold text-slate-500">min</span></p>
            <p className="mt-1 text-[11px] text-emerald-600">↓ 64% vs city average</p>
          </div>
          <div className="glass absolute -left-2 -top-5 flex items-center gap-2.5 rounded-2xl px-4 py-3 sm:-left-6">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-peri-800 text-white"><Globe2 className="h-4 w-4" /></span>
            <div className="leading-tight"><p className="text-xs font-semibold text-peri-900">NABH-grade protocols</p><p className="text-[11px] text-slate-500">Infection-safe care</p></div>
          </div>
        </Reveal>

        <div>
          <SectionHeader id="why-title" center={false} eyebrow="Why patients choose DC" title={<>Hospital-grade care. <span className="text-gradient">Hotel-grade comfort.</span></>} />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2">
            {benefits.map((b, i) => (
              <Reveal as="li" key={b.title} delay={i * 90} className="group rounded-2xl border border-transparent p-4 transition duration-300 hover:border-peri-200 hover:bg-white hover:shadow-soft">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-peri-100 text-peri-700 transition duration-300 group-hover:rotate-[-6deg] group-hover:bg-peri-800 group-hover:text-white"><b.icon className="h-5 w-5" /></span>
                <h3 className="mt-4 font-display text-base font-bold text-peri-900">{b.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{b.text}</p>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>

      {/* how it works */}
      <div className="l-container mt-24">
        <Reveal className="relative overflow-hidden rounded-[2rem] border border-peri-200 bg-white/80 p-6 shadow-soft backdrop-blur sm:p-10">
          <div aria-hidden="true" className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-peri-200/60 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <span className="l-eyebrow">How it works</span>
              <h3 className="mt-3 font-display text-2xl font-bold text-peri-900 sm:text-3xl">Your first visit in 3 simple steps</h3>
            </div>
            <Link to={useBookHref()} className="btn-peri self-start sm:self-auto">Get started free<ArrowRight className="h-4 w-4" /></Link>
          </div>
          <ol className="relative mt-10 grid gap-8 md:grid-cols-3 md:gap-6">
            <span aria-hidden="true" className="absolute left-6 right-6 top-6 hidden h-px bg-gradient-to-r from-peri-300 via-peri-400 to-peri-300 md:block" />
            {steps.map((s, i) => (
              <Reveal as="li" key={s.n} delay={i * 140} className="relative flex gap-4 md:block">
                <span className="relative z-10 grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-peri-800 font-display text-sm font-bold text-white shadow-glow ring-8 ring-white">{s.n}</span>
                <div className="md:mt-5">
                  <h4 className="font-display text-base font-bold text-peri-900">{s.title}</h4>
                  <p className="mt-1 text-sm text-slate-600">{s.text}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  )
}

/* ───────────────────────────────── Testimonials ───────────────────────────────── */

function TestimonialCard({ t }: { t: typeof TESTIMONIALS[number] }) {
  const initials = t.name.split(' ').map((p) => p[0]).join('').slice(0, 2)
  return (
    <figure className="w-[300px] shrink-0 rounded-3xl border border-peri-200/80 bg-white p-6 shadow-soft transition duration-300 hover:-translate-y-1 hover:border-peri-300 sm:w-[360px]">
      <div className="flex items-center justify-between">
        <Stars value={5} />
        <Quote className="h-6 w-6 text-peri-300" aria-hidden="true" />
      </div>
      <blockquote className="mt-4 text-[15px] leading-relaxed text-slate-700">“{t.text}”</blockquote>
      <figcaption className="mt-5 flex items-center gap-3 border-t border-peri-100 pt-4">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-peri-300 to-peri-500 text-sm font-bold text-white" aria-hidden="true">{initials}</span>
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-peri-900">{t.name}</p><p className="text-xs text-slate-500">{t.place}</p></div>
        <span className="rounded-full bg-peri-50 px-2.5 py-1 text-[11px] font-medium text-peri-700">{t.tag}</span>
      </figcaption>
    </figure>
  )
}

function Testimonials() {
  const half = Math.ceil(TESTIMONIALS.length / 2)
  const rows = [TESTIMONIALS.slice(0, half), TESTIMONIALS.slice(half)]
  return (
    <section id="testimonials" aria-labelledby="testimonials-title" className="relative scroll-mt-24 overflow-hidden py-20 sm:py-28">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-peri-100/60 to-transparent" />
      <div className="l-container">
        <SectionHeader id="testimonials-title" eyebrow="Patient stories" title={<>Trusted by <span className="text-gradient">1.2 lakh+</span> families</>}
          lead="Real words from people we’ve had the privilege to care for." />
        <Reveal delay={200} className="mt-6 flex items-center justify-center gap-3 text-sm text-slate-600">
          <Stars value={5} /><span><strong className="text-peri-900">4.9</strong> from 8,400+ Google reviews</span>
        </Reveal>
      </div>
      <div className="mt-12 space-y-5">
        {rows.map((row, r) => (
          <div key={r} className="mask-fade-x group overflow-hidden">
            <ul className={cn('motion-safe-only flex w-max gap-5 px-2 group-hover:[animation-play-state:paused]', r === 0 ? 'animate-marquee' : 'animate-marquee-rev')}>
              {[...row, ...row].map((t, i) => <li key={i} aria-hidden={i >= row.length}><TestimonialCard t={t} /></li>)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ───────────────────────────────── Packages / pricing ───────────────────────────────── */

function Packages() {
  const [couple, setCouple] = useState(false)
  const book = useBookHref()
  return (
    <section id="packages" aria-labelledby="packages-title" className="relative scroll-mt-24 py-20 sm:py-28">
      <div className="l-container">
        <SectionHeader id="packages-title" eyebrow="Health check-up packages" title={<>Prevention that <span className="text-gradient">pays for itself</span></>}
          lead="Doctor-designed screenings with same-day reports and a consultation to walk you through every result." />

        <Reveal delay={200} className="mt-8 flex justify-center">
          <div className="relative grid grid-cols-2 rounded-full border border-peri-200 bg-white p-1 shadow-sm" role="radiogroup" aria-label="Package type">
            <span aria-hidden="true" className={cn('absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-peri-800 shadow-glow transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)]', couple && 'translate-x-full')} />
            {[['Individual', false], ['Couple', true]].map(([label, val]) => (
              <button key={label as string} type="button" role="radio" aria-checked={couple === val} onClick={() => setCouple(val as boolean)}
                className={cn('relative z-10 rounded-full px-6 py-2 text-sm font-semibold transition-colors duration-300', couple === val ? 'text-white' : 'text-slate-500 hover:text-peri-800')}>
                {label as string}{val ? <span className={cn('ml-1.5 rounded-full px-1.5 py-0.5 text-[10px]', couple ? 'bg-white/20' : 'bg-emerald-100 text-emerald-700')}>-10%</span> : null}
              </button>
            ))}
          </div>
        </Reveal>

        <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-3">
          {PACKAGES.map((p, i) => {
            const price = couple ? p.couple : p.price
            return (
              <Reveal key={p.name} delay={i * 110} variant="scale" className={cn('relative', p.popular && 'lg:-my-4')}>
                <div className={cn(
                  'group relative flex h-full flex-col overflow-hidden rounded-[2rem] p-7 transition duration-500 hover:-translate-y-1.5 sm:p-8',
                  p.popular
                    ? 'bg-gradient-to-br from-peri-800 via-peri-800 to-peri-700 text-white shadow-[0_40px_80px_-30px_rgba(41,41,102,.7)]'
                    : 'border border-peri-200 bg-white shadow-soft hover:shadow-[0_30px_60px_-25px_rgba(41,41,102,.3)]',
                )}>
                  {p.popular && <>
                    <div aria-hidden="true" className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-peri-400/40 blur-3xl" />
                    <div aria-hidden="true" className="absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-peri-300/20 blur-3xl" />
                  </>}
                  <div className="relative flex items-center justify-between">
                    <h3 className={cn('font-display text-xl font-bold', p.popular ? 'text-white' : 'text-peri-900')}>{p.name}</h3>
                    {p.popular && <span className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white backdrop-blur"><Sparkles className="h-3.5 w-3.5" />Most popular</span>}
                  </div>
                  <p className={cn('relative mt-2 text-sm', p.popular ? 'text-peri-200' : 'text-slate-500')}>{p.blurb}</p>
                  <div className="relative mt-6 flex items-end gap-2">
                    <span key={price} className={cn('animate-pop-in font-display text-5xl font-extrabold tracking-tight', p.popular ? 'text-white' : 'text-peri-900')}>{inr(price)}</span>
                    <span className={cn('mb-2 text-sm', p.popular ? 'text-peri-300' : 'text-slate-500')}>/ {couple ? 'couple' : 'person'}</span>
                  </div>
                  <p className={cn('relative mt-1 text-xs font-semibold', p.popular ? 'text-peri-300' : 'text-peri-600')}>{p.tests} tests · reports in 24h</p>
                  <ul className="relative mt-7 flex-1 space-y-3">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-3 text-sm">
                        <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full', p.popular ? 'bg-white/15 text-white' : 'bg-peri-100 text-peri-700')}><Check className="h-3 w-3" strokeWidth={3} /></span>
                        <span className={p.popular ? 'text-peri-100' : 'text-slate-600'}>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link to={book} className={cn('relative mt-8 inline-flex items-center justify-center gap-2 rounded-full py-3.5 text-sm font-semibold transition duration-300',
                    p.popular ? 'bg-white text-peri-900 hover:bg-peri-100' : 'bg-peri-100 text-peri-800 hover:bg-peri-800 hover:text-white')}>
                    Book {p.name}<ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                  </Link>
                </div>
              </Reveal>
            )
          })}
        </div>
        <Reveal as="p" delay={150} className="mt-8 text-center text-xs text-slate-500">Home sample collection available across Delhi NCR · Prices inclusive of GST</Reveal>
      </div>
    </section>
  )
}

/* ───────────────────────────────── FAQ ───────────────────────────────── */

function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section id="faq" aria-labelledby="faq-title" className="relative scroll-mt-24 py-20 sm:py-28">
      <div className="l-container grid gap-12 lg:grid-cols-[.8fr_1.2fr] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeader id="faq-title" center={false} eyebrow="FAQ" title={<>Questions? <span className="text-gradient">We’ve got answers.</span></>}
            lead="Can’t find what you’re looking for? Our patient care team is available round the clock." />
          <Reveal delay={220} className="mt-8 flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
            <a href={TEL} className="btn-peri"><Phone className="h-4 w-4" />Call patient care</a>
            <a href={`mailto:${HOSPITAL.email}`} className="btn-ghost"><Mail className="h-4 w-4" />Email us</a>
          </Reveal>
        </div>
        <div className="space-y-3">
          {FAQS.map((f, i) => {
            const isOpen = open === i
            return (
              <Reveal key={f.q} delay={i * 60} className={cn('overflow-hidden rounded-2xl border bg-white transition-all duration-300', isOpen ? 'border-peri-300 shadow-soft' : 'border-peri-200/80 hover:border-peri-300')}>
                <h3>
                  <button type="button" id={`faq-q-${i}`} aria-expanded={isOpen} aria-controls={`faq-a-${i}`} onClick={() => setOpen(isOpen ? null : i)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left font-display text-base font-semibold text-peri-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-peri-200 sm:px-6">
                    {f.q}
                    <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full transition-all duration-300', isOpen ? 'rotate-180 bg-peri-800 text-white' : 'bg-peri-100 text-peri-700')}><ChevronDown className="h-4 w-4" /></span>
                  </button>
                </h3>
                <div id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`} className={cn('grid transition-all duration-500 ease-[cubic-bezier(.2,.8,.2,1)]', isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
                  <div className="overflow-hidden"><p className="px-5 pb-5 text-sm leading-relaxed text-slate-600 sm:px-6">{f.a}</p></div>
                </div>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ───────────────────────────────── Final CTA ───────────────────────────────── */

function FinalCta() {
  const book = useBookHref()
  return (
    <section aria-labelledby="cta-title" className="relative py-16 sm:py-24">
      <div className="l-container">
        <Reveal variant="scale" className="relative isolate overflow-hidden rounded-[2.5rem] bg-peri-900 px-6 py-14 text-center sm:px-12 sm:py-20">
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_left,rgba(163,163,204,.45),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(92,92,153,.7),transparent_55%)]" />
          <div aria-hidden="true" className="absolute inset-0 -z-10 opacity-[.08] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:48px_48px]" />
          <div aria-hidden="true" className="motion-safe-only absolute -left-10 top-10 -z-10 h-40 w-40 animate-drift rounded-full bg-peri-300/30 blur-3xl" />
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-semibold text-peri-200 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />23 specialists available today
          </span>
          <h2 id="cta-title" className="mx-auto mt-6 max-w-3xl font-display text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
            Your health can’t wait in a queue. <span className="text-peri-300">Neither should you.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base text-peri-200 sm:text-lg">Book your consultation in 30 seconds — or talk to our care team right now.</p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to={book} className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-4 text-sm font-semibold text-peri-900 shadow-xl transition duration-300 hover:-translate-y-0.5 hover:bg-peri-100">
              <CalendarCheck className="h-4 w-4" />Book appointment
            </Link>
            <a href={TEL} className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/5 px-7 py-4 text-sm font-semibold text-white backdrop-blur transition duration-300 hover:-translate-y-0.5 hover:bg-white/10">
              <Phone className="h-4 w-4" />{HOSPITAL.phone}
            </a>
          </div>
          <p className="mt-6 text-xs text-peri-300">Free account · No booking fee · Cancel anytime</p>
        </Reveal>
      </div>
    </section>
  )
}

/* ───────────────────────────────── Footer ───────────────────────────────── */

function Footer() {
  const cols = [
    { title: 'Patients', links: [['Book appointment', '/register'], ['Patient portal', '/login'], ['Health packages', '#packages'], ['Find a doctor', '#doctors']] },
    { title: 'Specialities', links: SPECIALITIES.slice(0, 5).map((s) => [s, '#features']) },
    { title: 'Hospital', links: [['About us', '#why-us'], ['Patient stories', '#testimonials'], ['FAQ', '#faq'], ['Staff login', '/login']] },
  ]
  return (
    <footer className="relative border-t border-peri-200/70 bg-white pb-28 pt-16 sm:pb-10">
      <div className="l-container">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <LandingLogo />
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-slate-500">Multi-speciality hospital delivering compassionate, technology-first care to families across Delhi NCR since 2009.</p>
            <ul className="mt-6 space-y-3 text-sm text-slate-600">
              <li className="flex gap-3"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-peri-500" />{HOSPITAL.address}</li>
              <li><a href={TEL} className="flex gap-3 transition hover:text-peri-800"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-peri-500" />{HOSPITAL.phone}</a></li>
              <li><a href={`mailto:${HOSPITAL.email}`} className="flex gap-3 transition hover:text-peri-800"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-peri-500" />{HOSPITAL.email}</a></li>
            </ul>
            <div className="mt-6 flex gap-2">
              {SOCIALS.map((s) => (
                <a key={s} href="#" aria-label={`DC Hospital on ${s}`} className="grid h-10 w-10 place-items-center rounded-full border border-peri-200 text-peri-600 transition duration-300 hover:-translate-y-0.5 hover:border-peri-800 hover:bg-peri-800 hover:text-white" onClick={(e) => e.preventDefault()}>
                  <SocialIcon name={s} />
                </a>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {cols.map((c) => (
              <nav key={c.title} aria-label={c.title}>
                <h3 className="font-display text-sm font-bold text-peri-900">{c.title}</h3>
                <ul className="mt-4 space-y-3">
                  {c.links.map(([label, href]) => (
                    <li key={label}>
                      {href.startsWith('#')
                        ? <a href={href} className="text-sm text-slate-500 transition hover:text-peri-800">{label}</a>
                        : <Link to={href} className="text-sm text-slate-500 transition hover:text-peri-800">{label}</Link>}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
            <div className="col-span-2 rounded-2xl bg-gradient-to-br from-peri-100 to-peri-200/60 p-5 sm:col-span-3">
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <p className="flex items-center gap-2 font-display text-sm font-bold text-peri-900"><Siren className="h-4 w-4 text-rose-500" />24×7 Emergency & Ambulance</p>
                  <p className="mt-1 text-xs text-slate-600">Walk in any time or call — we’re always open.</p>
                </div>
                <a href={TEL} className="btn-peri !py-2.5">Call now</a>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-peri-100 pt-6 text-xs text-slate-500 sm:flex-row">
          <p>© {new Date().getFullYear()} {HOSPITAL.name}. All rights reserved.</p>
          <div className="flex gap-5"><a href="#" className="hover:text-peri-800">Privacy</a><a href="#" className="hover:text-peri-800">Terms</a><a href="#" className="hover:text-peri-800">Patient rights</a></div>
        </div>
      </div>
    </footer>
  )
}

/* ───────────────────────────────── Mobile sticky CTA ───────────────────────────────── */

function MobileCtaBar() {
  const { y } = useScroll()
  const book = useBookHref()
  const show = y > 640
  return (
    <div className={cn('fixed inset-x-3 bottom-3 z-40 transition-all duration-500 sm:hidden', show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-24 opacity-0')} aria-hidden={!show}>
      <div className="glass flex items-center gap-2 rounded-full p-1.5">
        <a href={TEL} tabIndex={show ? 0 : -1} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600" aria-label="Call emergency"><Phone className="h-5 w-5" /></a>
        <Link to={book} tabIndex={show ? 0 : -1} className="btn-peri flex-1 !py-3.5">Book appointment<ArrowRight className="h-4 w-4" /></Link>
      </div>
    </div>
  )
}
