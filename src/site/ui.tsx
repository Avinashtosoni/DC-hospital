import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarCheck, CalendarDays, Check, ChevronDown, ChevronRight, Clock, Languages, Phone, Sparkles, Stethoscope, Users, type LucideIcon } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { cn } from '../lib/utils'
import { Rich, nextAvailable, useContact, useSite } from './cms/content'
import { iconFor } from './cms/icons'
import type { FaqItem, SiteDoctor } from './cms/types'
import { Reveal } from './parts'

export const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

/** Where "Book" CTAs go: signed-in users book from the portal; guests sign up first. */
export function useBookHref(q?: { doctor?: string; service?: string }) {
  const { user } = useAuth()
  const { settings } = useSite()
  if (settings.booking?.enabled !== false) {
    const p = new URLSearchParams()
    if (q?.doctor) p.set('doctor', q.doctor)
    if (q?.service) p.set('service', q.service)
    const s = p.toString()
    return `/book${s ? `?${s}` : ''}`
  }
  return user ? '/appointments' : '/register'
}
/** "/" is the dashboard for signed-in users, so the public home lives at /welcome for them. */
export function useHomeHref() {
  const { user } = useAuth()
  return user ? '/welcome' : '/'
}

export function AmbientBackdrop({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0 -z-10 overflow-hidden', className)}>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#f0f0ff_0%,#fbfbff_60%,#fbfbff_100%)]" />
      <div className="absolute inset-0 opacity-[.35] [background-image:linear-gradient(rgba(92,92,153,.09)_1px,transparent_1px),linear-gradient(90deg,rgba(92,92,153,.09)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,#000_20%,transparent_70%)]" />
      <div className="motion-safe-only absolute -left-40 -top-32 h-[520px] w-[520px] animate-drift rounded-full bg-peri-300/60 blur-[110px]" />
      <div className="motion-safe-only absolute -right-32 top-24 h-[460px] w-[460px] animate-drift-slow rounded-full bg-peri-400/40 blur-[120px]" />
    </div>
  )
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  const home = useHomeHref()
  const all = [{ label: 'Home', to: home }, ...items]
  return (
    <nav aria-label="Breadcrumb" className="l-rise">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500">
        {all.map((c, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-peri-300" aria-hidden="true" />}
            {c.to && i < all.length - 1
              ? <Link to={c.to} className="rounded transition hover:text-peri-800">{c.label}</Link>
              : <span aria-current={i === all.length - 1 ? 'page' : undefined} className="text-peri-800">{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** Inner-page hero with breadcrumbs, eyebrow, title and optional right-hand content. */
export function PageHero({ crumbs, eyebrow, title, lead, children, aside, center }: {
  crumbs: { label: string; to?: string }[]; eyebrow?: string; title: ReactNode | string; lead?: ReactNode
  children?: ReactNode; aside?: ReactNode; center?: boolean
}) {
  return (
    <section className="relative isolate overflow-hidden pb-14 pt-28 sm:pb-20 sm:pt-36">
      <AmbientBackdrop />
      <div className={cn('l-container', aside && 'grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]')}>
        <div className={cn(center && !aside && 'mx-auto max-w-3xl text-center [&_ol]:justify-center')}>
          <Breadcrumbs items={crumbs} />
           {eyebrow && <div className="l-rise mt-6" style={{ animationDelay: '80ms' }}><span className="l-eyebrow">{eyebrow}</span></div>}
          <h1 className="l-rise mt-4 font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-peri-900 sm:text-5xl lg:text-[3.5rem]" style={{ animationDelay: '160ms' }}>{typeof title === 'string' ? <Rich text={title} /> : title}</h1>
          {lead && <p className={cn('l-rise mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg', center && !aside && 'mx-auto')} style={{ animationDelay: '260ms' }}>{lead}</p>}
          {children && <div className="l-rise mt-8" style={{ animationDelay: '360ms' }}>{children}</div>}
        </div>
        {aside && <div className="l-rise relative" style={{ animationDelay: '300ms' }}>{aside}</div>}
      </div>
    </section>
  )
}

export function SectionHeader({ eyebrow, title, lead, id, center = true, className }: { eyebrow: string; title: ReactNode | string; lead?: string; id?: string; center?: boolean; className?: string }) {
  return (
    <div className={cn('max-w-2xl', center && 'mx-auto text-center', className)}>
      <Reveal><span className="l-eyebrow">{eyebrow}</span></Reveal>
      <Reveal as="h2" id={id} delay={80} className="l-h2">{typeof title === 'string' ? <Rich text={title} /> : title}</Reveal>
      {lead && <Reveal as="p" delay={160} className="l-lead">{lead}</Reveal>}
    </div>
  )
}

export function FeatureIcon({ icon, className }: { icon: LucideIcon | string; className?: string }) {
  const Icon = typeof icon === 'string' ? iconFor(icon) : icon
  return (
    <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-peri-200 to-peri-300 text-peri-800 ring-1 ring-inset ring-white/60 transition duration-500 group-hover:scale-110 group-hover:from-peri-600 group-hover:to-peri-800 group-hover:text-white', className)}>
      <Icon className="h-6 w-6" />
    </span>
  )
}

const StarIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="currentColor" aria-hidden="true"><path d="M10 1.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.8L10 1.5z" /></svg>
)

export function DoctorCard({ d, delay = 0, compact }: { d: SiteDoctor; delay?: number; compact?: boolean }) {
  const book = useBookHref({ doctor: d.slug })
  const next = nextAvailable(d)
  return (
    <article className="group relative flex animate-pop-in flex-col overflow-hidden rounded-[1.75rem] border border-peri-200/80 bg-white shadow-soft transition duration-500 hover:-translate-y-1.5 hover:shadow-[0_30px_60px_-25px_rgba(41,41,102,.35)] focus-within:ring-4 focus-within:ring-peri-300" style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}>
      <Link to={`/find-a-doctor/${d.slug}`} className="relative block aspect-[4/4.1] overflow-hidden bg-peri-300 focus-visible:outline-none" aria-label={`View profile of ${d.name}`}>
        <img src={d.img} alt={`Portrait of ${d.name}, ${d.role}`} width={560} height={560} loading="lazy" className="h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.07]" />
        <span className="absolute left-3 top-3 rounded-full bg-white/85 px-3 py-1 text-[11px] font-semibold text-peri-800 backdrop-blur">{d.dept}</span>
        <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-peri-900/80 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur"><StarIcon className="h-3 w-3 text-amber-300" />{d.rating.toFixed(1)}</span>
        {!compact && (
          <div className="absolute inset-x-3 bottom-3 translate-y-[calc(100%+12px)] rounded-2xl border border-white/60 bg-white/85 p-3 text-xs text-slate-600 opacity-0 backdrop-blur-xl transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
            <p className="flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5 text-peri-600" />{d.days.length === 7 ? 'All days' : d.days.join(', ')}</p>
            <p className="mt-1.5 flex items-center gap-2"><Languages className="h-3.5 w-3.5 text-peri-600" />{d.langs.join(', ')}</p>
            <p className={cn('mt-1.5 flex items-center gap-2 font-semibold', d.onLeave ? 'text-amber-600' : 'text-emerald-700')}><Clock className="h-3.5 w-3.5" />{d.onLeave ? 'Currently on leave' : `Next available: ${next}`}</p>
          </div>
        )}
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-display text-lg font-bold text-peri-900"><Link to={`/find-a-doctor/${d.slug}`} className="transition hover:text-peri-600">{d.name}</Link></h3>
        <p className="text-sm text-slate-500">{d.role}</p>
        <div className="mb-4 mt-3 flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1"><Stethoscope className="h-3.5 w-3.5 text-peri-500" />{d.exp} yrs</span>
          <span className="h-3 w-px bg-peri-200" />
          <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5 text-peri-500" />{d.reviews.toLocaleString('en-IN')} reviews</span>
        </div>
        <div className="mt-auto flex items-center justify-between border-t border-peri-100 pt-4">
          <p className="text-sm"><span className="font-display text-lg font-bold text-peri-900">{inr(d.fee)}</span><span className="text-xs text-slate-500"> / visit</span></p>
          <Link to={book} className="inline-flex items-center gap-1.5 rounded-full bg-peri-100 px-4 py-2 text-xs font-semibold text-peri-800 transition duration-300 hover:bg-peri-800 hover:text-white" aria-label={`Book appointment with ${d.name}`}>
            Book<ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </article>
  )
}

export function Accordion({ items, idPrefix, defaultOpen = 0 }: { items: FaqItem[]; idPrefix: string; defaultOpen?: number | null }) {
  const [open, setOpen] = useState<number | null>(defaultOpen)
  return (
    <div className="space-y-3">
      {items.map((f, i) => {
        const isOpen = open === i
        return (
          <Reveal key={f.q} delay={Math.min(i, 6) * 50} className={cn('overflow-hidden rounded-2xl border bg-white transition-all duration-300', isOpen ? 'border-peri-300 shadow-soft' : 'border-peri-200/80 hover:border-peri-300')}>
            <h3>
              <button type="button" id={`${idPrefix}-q-${i}`} aria-expanded={isOpen} aria-controls={`${idPrefix}-a-${i}`} onClick={() => setOpen(isOpen ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left font-display text-base font-semibold text-peri-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-peri-200 sm:px-6">
                {f.q}
                <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full transition-all duration-300', isOpen ? 'rotate-180 bg-peri-800 text-white' : 'bg-peri-100 text-peri-700')}><ChevronDown className="h-4 w-4" /></span>
              </button>
            </h3>
            <div id={`${idPrefix}-a-${i}`} role="region" aria-labelledby={`${idPrefix}-q-${i}`} className={cn('grid transition-all duration-500 ease-[cubic-bezier(.2,.8,.2,1)]', isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
              <div className="overflow-hidden"><p className="px-5 pb-5 text-sm leading-relaxed text-slate-600 sm:px-6">{f.a}</p></div>
            </div>
          </Reveal>
        )
      })}
    </div>
  )
}

export function PackagesGrid() {
  const [couple, setCouple] = useState(false)
  const book = useBookHref()
  const PACKAGES = useSite().packages.items
  return (
    <>
      <Reveal delay={150} className="mt-8 flex justify-center">
        <div className="relative grid grid-cols-2 rounded-full border border-peri-200 bg-white p-1 shadow-sm" role="radiogroup" aria-label="Package type">
          <span aria-hidden="true" className={cn('absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-peri-800 shadow-glow transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)]', couple && 'translate-x-full')} />
          {([['Individual', false], ['Couple', true]] as const).map(([label, val]) => (
            <button key={label} type="button" role="radio" aria-checked={couple === val} onClick={() => setCouple(val)}
              className={cn('relative z-10 rounded-full px-6 py-2 text-sm font-semibold transition-colors duration-300', couple === val ? 'text-white' : 'text-slate-500 hover:text-peri-800')}>
              {label}{val && <span className={cn('ml-1.5 rounded-full px-1.5 py-0.5 text-[10px]', couple ? 'bg-white/20' : 'bg-emerald-100 text-emerald-700')}>-10%</span>}
            </button>
          ))}
        </div>
      </Reveal>
      <div className={cn('mt-12 grid grid-cols-1 items-stretch gap-5', PACKAGES.length === 2 ? 'mx-auto max-w-4xl lg:grid-cols-2' : PACKAGES.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
        {PACKAGES.length === 0 && <p className="col-span-full text-center text-sm text-slate-500">Packages will be announced soon.</p>}
        {PACKAGES.map((p, i) => {
          const price = couple ? p.couple : p.price
          return (
            <Reveal key={p.name} delay={i * 110} variant="scale" className={cn('relative', p.popular && 'lg:-my-4')}>
              <div className={cn('group relative flex h-full flex-col overflow-hidden rounded-[2rem] p-7 transition duration-500 hover:-translate-y-1.5 sm:p-8',
                p.popular ? 'bg-gradient-to-br from-peri-800 via-peri-800 to-peri-700 text-white shadow-[0_40px_80px_-30px_rgba(41,41,102,.7)]' : 'border border-peri-200 bg-white shadow-soft hover:shadow-[0_30px_60px_-25px_rgba(41,41,102,.3)]')}>
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
    </>
  )
}

export function CtaBand({ title, lead, badge }: { title?: string; lead?: string; badge?: string }) {
  const book = useBookHref()
  const c = useContact()
  const cta = c.cta
  return (
    <section aria-label="Book an appointment" className="relative py-16 sm:py-24">
      <div className="l-container">
        <Reveal variant="scale" className="relative isolate overflow-hidden rounded-[2.5rem] bg-peri-900 px-6 py-14 text-center sm:px-12 sm:py-20">
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_left,rgba(163,163,204,.45),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(92,92,153,.7),transparent_55%)]" />
          <div aria-hidden="true" className="absolute inset-0 -z-10 opacity-[.08] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:48px_48px]" />
          <div aria-hidden="true" className="motion-safe-only absolute -left-10 top-10 -z-10 h-40 w-40 animate-drift rounded-full bg-peri-300/30 blur-3xl" />
          {(badge || cta.badge) && (
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-semibold text-peri-200 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{badge || cta.badge}
            </span>
          )}
          <h2 className="mx-auto mt-6 max-w-3xl font-display text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
            <Rich text={title || cta.title} hl="text-peri-300" />
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base text-peri-200 sm:text-lg">{lead || cta.lead}</p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to={book} className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-4 text-sm font-semibold text-peri-900 shadow-xl transition duration-300 hover:-translate-y-0.5 hover:bg-peri-100">
              <CalendarCheck className="h-4 w-4" />Book appointment
            </Link>
            <a href={c.tel} className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/5 px-7 py-4 text-sm font-semibold text-white backdrop-blur transition duration-300 hover:-translate-y-0.5 hover:bg-white/10">
              <Phone className="h-4 w-4" />{c.phone}
            </a>
          </div>
          {cta.note && <p className="mt-6 text-xs text-peri-300">{cta.note}</p>}
        </Reveal>
      </div>
    </section>
  )
}
