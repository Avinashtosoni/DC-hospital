import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight, BadgeCheck, CalendarCheck, CalendarDays, Check, ChevronDown, FlaskConical, Globe2,
  HeartPulse, Mail, Pill, Quote, Search, ShieldCheck, Siren, Sparkles, Wallet,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { Rich, useContact, useSite } from '../cms/content'
import { iconFor } from '../cms/icons'
import type { Testimonial } from '../cms/types'
import { prefersReducedMotion, useSeo } from '../hooks'
import { Counter, Reveal, SpotlightCard, Stars } from '../parts'
import { Accordion, AmbientBackdrop, CtaBand, DoctorCard, FeatureIcon, PackagesGrid, SectionHeader, inr, useBookHref } from '../ui'

const useFeatured = () => { const { doctors } = useSite(); const f = doctors.filter((d) => d.featured); return f.length ? f : doctors.slice(0, 4) }

export default function Home() {
  const { home } = useSite()
  const on = home.sections
  useSeo(home.seo.title, home.seo.description)
  return (
    <>
      <Hero />
      {on.stats && <SocialProof />}
      {on.features && <Features />}
      {on.doctors && <Doctors />}
      {on.why && <Benefits />}
      {on.testimonials && <Testimonials />}
      {on.packages && <Packages />}
      {on.faq && <Faq />}
      {on.cta && <CtaBand />}
    </>
  )
}

/** Splits a rich line into animated words, keeping *highlighted* words highlighted. */
function Words({ text, delay }: { text: string; delay: number }) {
  const words: { w: string; hl: boolean }[] = []
  text.split(/(\*[^*]+\*)/g).filter(Boolean).forEach((chunk) => {
    const hl = chunk.startsWith('*') && chunk.endsWith('*')
    chunk.replace(/\*/g, '').split(/\s+/).filter(Boolean).forEach((w) => words.push({ w, hl }))
  })
  return <>{words.map(({ w, hl }, i) => <span key={i} className={cn('l-rise mr-[.25em] inline-block', hl && 'text-gradient')} style={{ animationDelay: `${delay + i * 70}ms` }}>{w}</span>)}</>
}

/* ───────────────────────────────── Hero ───────────────────────────────── */

function Hero() {
  const navigate = useNavigate()
  const { home: { hero, insurers }, services, doctors } = useSite()
  const FEATURED = useFeatured()
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

  const float = doctors.find((d) => d.slug === 'kavita-rao') ?? FEATURED[0]

  return (
    <section className="relative isolate pb-16 pt-28 sm:pt-32 md:pt-40 lg:pb-24" aria-labelledby="hero-title">
      <AmbientBackdrop />
      <div className="l-container grid grid-cols-1 items-center gap-14 lg:grid-cols-[1.08fr_1fr] lg:gap-10">
        {/* copy */}
        <div className="relative text-center lg:text-left">
          <div className="l-rise inline-flex items-center gap-2 rounded-full border border-peri-300/70 bg-white/80 py-1 pl-1 pr-4 text-xs font-medium text-peri-800 shadow-sm backdrop-blur" style={{ animationDelay: '60ms' }}>
            <span className="rounded-full bg-peri-800 px-2.5 py-1 text-[11px] font-semibold text-white">NEW</span>
            {hero.badge}
            <Sparkles className="h-3.5 w-3.5 text-peri-500" />
          </div>

          <h1 id="hero-title" className="mt-6 font-display text-[2.35rem] font-extrabold leading-[1.08] tracking-tight text-peri-900 sm:text-6xl lg:text-[3.6rem] xl:text-[4rem]">
            <span className="block"><Words text={hero.line1} delay={150} /></span>
            {hero.line2 && <span className="block"><Words text={hero.line2} delay={430} /></span>}
          </h1>

          <p className="l-rise mx-auto mt-6 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg lg:mx-0" style={{ animationDelay: '760ms' }}>
            {hero.subtitle}
          </p>

          {/* quick booking widget */}
          <form
            onSubmit={(e) => { e.preventDefault(); const dept = services.find((x) => x.slug === spec)?.slug; navigate(dept ? `/services/${dept}` : '/find-a-doctor') }}
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
                    {services.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
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
          {(FEATURED.length > 0 || hero.rating || hero.trust) && <div className="l-rise mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center lg:justify-start" style={{ animationDelay: '1000ms' }}>
            <div className="flex -space-x-3">
              {FEATURED.slice(0, 4).map((d) => <img key={d.slug} src={d.img} alt="" width={40} height={40} className="h-10 w-10 rounded-full border-2 border-white bg-peri-200 object-cover shadow-sm" />)}
              {doctors.length > 4 && <span className="grid h-10 w-10 place-items-center rounded-full border-2 border-white bg-peri-800 text-[11px] font-bold text-white">+{doctors.length - Math.min(4, FEATURED.length)}</span>}
            </div>
            {(hero.rating || hero.trust) && <div className="text-center sm:text-left">
              {hero.rating && <div className="flex items-center justify-center gap-2 sm:justify-start"><Stars value={5} /><span className="text-sm font-bold text-peri-900">{hero.rating}</span></div>}
              {hero.trust && <p className="text-xs text-slate-500"><Rich text={hero.trust} hl="font-bold text-peri-800" /></p>}
            </div>}
          </div>}
        </div>

        {/* visual */}
        <div ref={stage} onPointerMove={onMove} onPointerLeave={onLeave} className="relative mx-auto w-full max-w-[520px] [--mx:0] [--my:0]">
          <div className="l-rise relative" style={{ animationDelay: '300ms' }}>
            <div aria-hidden="true" className="absolute -inset-4 rounded-[3rem] bg-gradient-to-br from-peri-300 via-peri-200 to-white opacity-80 blur-2xl" />
            <div className="relative overflow-hidden rounded-[2.5rem] border-[6px] border-white bg-peri-300 shadow-[0_40px_80px_-30px_rgba(41,41,102,.45)]">
              <img src={hero.image} alt={hero.imageAlt} width={900} height={1117} {...{ fetchpriority: 'high' }} className="aspect-[4/5] w-full object-cover transition-transform duration-[1.5s] ease-out hover:scale-[1.03]" style={{ transform: 'translate3d(calc(var(--mx,0) * -8px), calc(var(--my,0) * -8px), 0) scale(1.04)' }} />
              <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-peri-900/40 to-transparent" />
            </div>
          </div>

          {/* floating cards */}
          {float && <div className="absolute -left-3 top-8 sm:-left-10" style={depth(26)}>
            <div className="l-rise" style={{ animationDelay: '900ms' }}><div className="glass w-52 animate-float rounded-2xl p-3.5 motion-safe-only">
              <div className="flex items-center gap-3">
                <img src={float.img} alt="" width={40} height={40} className="h-10 w-10 rounded-xl bg-peri-200 object-cover" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-peri-900">{float.name}</p>
                  <p className="truncate text-[11px] text-slate-500">{float.role}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-xl bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700">
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Next slot</span>Today · 11:30
              </div>
            </div></div>
          </div>}

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

          {insurers.length > 0 && <div className="absolute -bottom-4 right-3 sm:-right-4" style={depth(-14)}>
            <div className="l-rise flex items-center gap-2 rounded-2xl bg-peri-900 px-4 py-3 text-white shadow-glow" style={{ animationDelay: '1350ms' }}>
              <ShieldCheck className="h-5 w-5 text-peri-300" />
              <div className="leading-tight"><p className="text-xs font-semibold">Cashless</p><p className="text-[11px] text-peri-300">30+ insurers</p></div>
            </div>
          </div>}
        </div>
      </div>
    </section>
  )
}

/* ───────────────────────────────── Social proof ───────────────────────────────── */

function SocialProof() {
  const { stats: STATS, insurers: INSURERS, insurersTitle } = useSite().home
  return (
    <section aria-label="In numbers" className="relative py-10 sm:py-14">
      <div className="l-container">
        <div className={cn('grid grid-cols-2 gap-3 sm:gap-4', STATS.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4')}>
          {STATS.map((s, i) => (
            <Reveal key={s.label} delay={i * 90} className="rounded-3xl border border-peri-200/80 bg-white/80 p-5 text-center shadow-soft backdrop-blur transition duration-500 hover:-translate-y-1 sm:p-7">
              <p className="font-display text-3xl font-extrabold tracking-tight text-peri-900 sm:text-4xl">
                <Counter value={s.value} suffix={s.suffix} decimals={s.decimals} format={s.format} />
              </p>
              <p className="mt-1.5 text-xs font-medium text-slate-500 sm:text-sm">{s.label}</p>
            </Reveal>
          ))}
        </div>

        {insurersTitle && INSURERS.length > 0 && <Reveal className="mt-12 text-center" delay={100}>
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-peri-500">{insurersTitle}</p>
        </Reveal>}
        {INSURERS.length > 0 && <div className="mask-fade-x group mt-6 overflow-hidden" aria-hidden="true">
          <div className="motion-safe-only flex w-max animate-marquee gap-4 group-hover:[animation-play-state:paused]">
            {[...INSURERS, ...INSURERS].map((n, i) => (
              <span key={i} className="flex items-center gap-2 whitespace-nowrap rounded-2xl border border-peri-200/70 bg-white/70 px-6 py-3.5 font-display text-base font-bold text-peri-400 transition hover:text-peri-800">
                <ShieldCheck className="h-4 w-4" />{n}
              </span>
            ))}
          </div>
        </div>}
        <p className="sr-only">Insurance partners: {INSURERS.join(', ')}.</p>
      </div>
    </section>
  )
}

/* ───────────────────────────────── Features (bento) ───────────────────────────────── */

function MiniScheduler() {
  const doc = useFeatured()[0]
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
        {doc && <img src={doc.img} alt="" width={36} height={36} className="h-9 w-9 rounded-xl bg-peri-200 object-cover" />}
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-peri-900">{doc?.name ?? 'Our specialists'}</p><p className="text-xs text-slate-500">{doc ? `${doc.dept} · ${inr(doc.fee)}` : 'Book online'}</p></div>
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
  const { home: { features, featureCards }, services } = useSite()
  const c = useContact()
  const card = (i: number) => featureCards[i] ?? { title: '', text: '' }
  return (
    <section id="features" aria-labelledby="features-title" className="relative scroll-mt-24 py-20 sm:py-28">
      <div className="l-container">
        <SectionHeader id="features-title" eyebrow={features.eyebrow} title={features.title} lead={features.lead} />

        <div className="mt-14 grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-3">
          <Reveal className="md:col-span-2 lg:col-span-1 lg:row-span-2" delay={0}>
            <SpotlightCard className="h-full p-6 sm:p-7">
              <FeatureIcon icon={CalendarDays} />
              <h3 className="mt-5 font-display text-xl font-bold text-peri-900">{card(0).title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{card(0).text}</p>
              <MiniScheduler />
            </SpotlightCard>
          </Reveal>

          <Reveal delay={90}>
            <SpotlightCard className="h-full p-6 sm:p-7">
              <FeatureIcon icon={Pill} />
              <h3 className="mt-5 font-display text-xl font-bold text-peri-900">{card(1).title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{card(1).text}</p>
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
              <h3 className="mt-5 font-display text-xl font-bold text-peri-900">{card(2).title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{card(2).text}</p>
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
              <h3 className="mt-5 font-display text-xl font-bold text-peri-900">{card(3).title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{card(3).text}</p>
              <a href={c.tel} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-rose-600 transition hover:gap-3">Call {c.phone}<ArrowRight className="h-4 w-4" /></a>
            </SpotlightCard>
          </Reveal>

          <Reveal delay={180}>
            <SpotlightCard className="h-full p-6 sm:p-7">
              <FeatureIcon icon={Wallet} />
              <h3 className="mt-5 font-display text-xl font-bold text-peri-900">{card(4).title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{card(4).text}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {['UPI', 'Cards', 'Cashless', 'EMI'].map((m) => <span key={m} className="rounded-full border border-peri-200 bg-white px-3 py-1 text-xs font-semibold text-peri-700 transition group-hover:border-peri-300">{m}</span>)}
              </div>
            </SpotlightCard>
          </Reveal>
        </div>

        {/* speciality chips */}
        <Reveal className="mt-10 flex flex-wrap justify-center gap-2" delay={120}>
          {services.map((s) => { const Icon = iconFor(s.icon); return (
            <Link key={s.slug} to={`/services/${s.slug}`} className="inline-flex items-center gap-2 rounded-full border border-peri-200 bg-white/80 px-4 py-2 text-sm font-medium text-peri-700 transition duration-300 hover:-translate-y-0.5 hover:border-peri-800 hover:bg-peri-800 hover:text-white"><Icon className="h-4 w-4" />{s.name}</Link>
          ) })}
        </Reveal>
      </div>
    </section>
  )
}

/* ───────────────────────────────── Doctors ───────────────────────────────── */

function Doctors() {
  const { home, doctors } = useSite()
  const FEATURED = useFeatured()
  const depts = useMemo(() => ['All', ...new Set(FEATURED.map((d) => d.dept))], [FEATURED])
  const [filter, setFilter] = useState('All')
  const list = filter === 'All' ? FEATURED : FEATURED.filter((d) => d.dept === filter)
  return (
    <section id="doctors" aria-labelledby="doctors-title" className="relative scroll-mt-24 overflow-hidden py-20 sm:py-28">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-full bg-gradient-to-b from-peri-100/70 via-peri-50/40 to-transparent" />
      <div className="l-container">
        <div className="flex flex-col items-center justify-between gap-8 lg:flex-row lg:items-end">
          <SectionHeader id="doctors-title" center={false} eyebrow={home.doctors.eyebrow} title={home.doctors.title} lead={home.doctors.lead} />
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
          {list.map((d, i) => <DoctorCard key={d.slug + filter} d={d} delay={i * 90} />)}
        </div>
        <Reveal className="mt-12 flex justify-center" delay={100}>
          <Link to="/find-a-doctor" className="btn-ghost group">View all {doctors.length} specialists<ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></Link>
        </Reveal>
      </div>
    </section>
  )
}

/* ───────────────────────────────── Benefits + how it works ───────────────────────────────── */

function Benefits() {
  const { why, benefits, steps: stepsBlock } = useSite().home
  const steps = stepsBlock.items.map((x, i) => ({ ...x, n: String(i + 1).padStart(2, '0') }))
  return (
    <section id="why-us" aria-labelledby="why-title" className="relative scroll-mt-24 py-20 sm:py-28">
      <div className="l-container grid grid-cols-1 items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <Reveal variant="left" className="relative order-last lg:order-first">
          <div aria-hidden="true" className="absolute -inset-6 rounded-[3rem] bg-gradient-to-tr from-peri-300/70 via-peri-200/50 to-transparent blur-2xl" />
          <div className="relative overflow-hidden rounded-[2.25rem] border-[6px] border-white shadow-[0_40px_80px_-30px_rgba(41,41,102,.4)]">
            <img src={why.image} alt="" width={1100} height={821} loading="lazy" className="aspect-[4/3.4] w-full object-cover transition duration-1000 hover:scale-105" />
          </div>
          <div className="glass absolute -bottom-6 -right-2 w-48 animate-float rounded-2xl p-4 motion-safe-only sm:-right-6">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-peri-500">{why.waitLabel}</p>
            <p className="mt-1 font-display text-3xl font-extrabold text-peri-900">{why.waitValue} <span className="text-base font-semibold text-slate-500">min</span></p>
            <p className="mt-1 text-[11px] text-emerald-600">{why.waitNote}</p>
          </div>
          <div className="glass absolute -left-2 -top-5 flex items-center gap-2.5 rounded-2xl px-4 py-3 sm:-left-6">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-peri-800 text-white"><Globe2 className="h-4 w-4" /></span>
            <div className="leading-tight"><p className="text-xs font-semibold text-peri-900">{why.badgeTitle}</p><p className="text-[11px] text-slate-500">{why.badgeText}</p></div>
          </div>
        </Reveal>

        <div>
          <SectionHeader id="why-title" center={false} eyebrow={why.eyebrow} title={why.title} />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2">
            {benefits.map((b, i) => { const Icon = iconFor(b.icon); return (
              <Reveal as="li" key={b.title} delay={i * 90} className="group rounded-2xl border border-transparent p-4 transition duration-300 hover:border-peri-200 hover:bg-white hover:shadow-soft">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-peri-100 text-peri-700 transition duration-300 group-hover:rotate-[-6deg] group-hover:bg-peri-800 group-hover:text-white"><Icon className="h-5 w-5" /></span>
                <h3 className="mt-4 font-display text-base font-bold text-peri-900">{b.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{b.text}</p>
              </Reveal>
            ) })}
          </ul>
        </div>
      </div>

      {/* how it works */}
      <div className="l-container mt-24">
        <Reveal className="relative overflow-hidden rounded-[2rem] border border-peri-200 bg-white/80 p-6 shadow-soft backdrop-blur sm:p-10">
          <div aria-hidden="true" className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-peri-200/60 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <span className="l-eyebrow">{stepsBlock.eyebrow}</span>
              <h3 className="mt-3 font-display text-2xl font-bold text-peri-900 sm:text-3xl"><Rich text={stepsBlock.title} /></h3>
            </div>
            <Link to={useBookHref()} className="btn-peri self-start sm:self-auto">Get started free<ArrowRight className="h-4 w-4" /></Link>
          </div>
          <ol className={cn('relative mt-10 grid grid-cols-1 gap-8 md:gap-6', steps.length === 4 ? 'md:grid-cols-4' : steps.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3')}>
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

function TestimonialCard({ t }: { t: Testimonial }) {
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
  const { testimonials: TESTIMONIALS, home } = useSite()
  const half = Math.ceil(TESTIMONIALS.length / 2)
  const rows = [TESTIMONIALS.slice(0, half), TESTIMONIALS.slice(half)]
  return (
    <section id="testimonials" aria-labelledby="testimonials-title" className="relative scroll-mt-24 overflow-hidden py-20 sm:py-28">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-peri-100/60 to-transparent" />
      <div className="l-container">
        <SectionHeader id="testimonials-title" eyebrow={home.testimonials.eyebrow} title={home.testimonials.title} lead={home.testimonials.lead} />
        <Reveal delay={200} className="mt-6 flex items-center justify-center gap-3 text-sm text-slate-600">
          {home.testimonials.reviews && <><Stars value={5} /><Rich text={home.testimonials.reviews} hl="font-bold text-peri-900" /></>}
        </Reveal>
      </div>
      <div className="mt-12 space-y-5">
        {rows.filter((row) => row.length).map((row, r) => (
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
  const { packages } = useSite().home
  return (
    <section id="packages" aria-labelledby="packages-title" className="relative scroll-mt-24 py-20 sm:py-28">
      <div className="l-container">
        <SectionHeader id="packages-title" eyebrow={packages.eyebrow} title={packages.title} lead={packages.lead} />
        <PackagesGrid />
        <Reveal delay={150} className="mt-10 flex flex-col items-center gap-2 text-center">
          <Link to="/packages" className="inline-flex items-center gap-1.5 text-sm font-semibold text-peri-700 transition hover:gap-2.5 hover:text-peri-900">Compare all tests<ArrowRight className="h-4 w-4" /></Link>
          {packages.note && <p className="text-xs text-slate-500">{packages.note}</p>}
        </Reveal>
      </div>
    </section>
  )
}

/* ───────────────────────────────── FAQ ───────────────────────────────── */

function Faq() {
  const { home, faqs } = useSite()
  const c = useContact()
  const all = faqs.flatMap((g) => g.items)
  const picked = all.filter((f) => f.featured)
  const items = (picked.length ? picked : all).slice(0, 6)
  return (
    <section id="faq" aria-labelledby="faq-title" className="relative scroll-mt-24 py-20 sm:py-28">
      <div className="l-container grid grid-cols-1 gap-12 lg:grid-cols-[.8fr_1.2fr] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeader id="faq-title" center={false} eyebrow={home.faq.eyebrow} title={home.faq.title} lead={home.faq.lead} />
          <Reveal delay={220} className="mt-8 flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
            <Link to="/faq" className="btn-peri">Browse all FAQs<ArrowRight className="h-4 w-4" /></Link>
            <a href={c.mailto} className="btn-ghost"><Mail className="h-4 w-4" />Email us</a>
          </Reveal>
        </div>
        <Accordion idPrefix="home-faq" items={items} />
      </div>
    </section>
  )
}
