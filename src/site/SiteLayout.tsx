import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, ChevronDown, Mail, MapPin, Menu, Phone, Siren, X } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { cn } from '../lib/utils'
import { SiteContentProvider, useContact, useIsPreview, useSite } from './cms/content'
import { iconFor } from './cms/icons'
import type { SiteSettings } from './cms/types'
import { useRevealAll, useScroll } from './hooks'
import { LandingLogo, SocialIcon } from './parts'
import NotFound from './pages/NotFound'
import { useBookHref, useHomeHref } from './ui'

type PageKey = keyof SiteSettings['pages']
const NAV_LINKS: { to: string; label: string; page: PageKey; mega?: boolean }[] = [
  { to: '/about', label: 'About', page: 'about' },
  { to: '/services', label: 'Services', page: 'services', mega: true },
  { to: '/find-a-doctor', label: 'Find a Doctor', page: 'doctors' },
  { to: '/packages', label: 'Health Packages', page: 'packages' },
  { to: '/contact', label: 'Contact', page: 'contact' },
]
const PAGE_OF: [string, PageKey][] = [['/about', 'about'], ['/services', 'services'], ['/find-a-doctor', 'doctors'], ['/packages', 'packages'], ['/contact', 'contact'], ['/faq', 'faq']]
/** Page key for a pathname, used to hide pages the owner switched off in the CMS. */
export const pageOf = (path: string) => PAGE_OF.find(([p]) => path === p || path.startsWith(`${p}/`))?.[1]
function usePageOn() {
  const { pages } = useSite().settings
  return (to: string) => { const k = pageOf(to); return !k || pages[k] !== false }
}

/** Public website shell: navbar, footer, mobile CTA, scroll handling and scroll-reveal. */
export default function SiteLayout({ children }: { children?: ReactNode }) {
  return (
    <SiteContentProvider fallback={<div className="min-h-screen bg-[#fbfbff]"><PageFallback /></div>}>
      <Shell>{children}</Shell>
    </SiteContentProvider>
  )
}

function Shell({ children }: { children?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  useRevealAll(root)
  useScrollManager()
  const { pathname } = useLocation()
  const pageOn = usePageOn()
  const preview = useIsPreview()
  const hidden = !pageOn(pathname) && !preview
  return (
    <div ref={root} className="relative min-h-screen overflow-x-clip bg-[#fbfbff] font-sans text-slate-700 antialiased selection:bg-peri-300 selection:text-peri-950">
      <a href="#main" className="sr-only z-[100] rounded-full bg-peri-800 px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <Navbar />
      <main id="main">
        <Suspense fallback={<PageFallback />}>{hidden ? <NotFound /> : children ?? <Outlet />}</Suspense>
      </main>
      <Footer />
      <MobileCtaBar />
    </div>
  )
}

function PageFallback() {
  return (
    <div className="grid min-h-[70vh] place-items-center pt-24">
      <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-peri-200 border-t-peri-700" aria-label="Loading page" />
    </div>
  )
}

/** Scroll to top on page change, or to the hash target if present. */
function useScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
      return () => clearTimeout(t)
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname, hash])
}

/* ───────────────────────────────── Navbar ───────────────────────────────── */

function Navbar() {
  const { scrolled, progress } = useScroll()
  const [open, setOpen] = useState(false)
  const [mega, setMega] = useState(false)
  const { user } = useAuth()
  const book = useBookHref()
  const home = useHomeHref()
  const { pathname } = useLocation()
  const megaTimer = useRef<ReturnType<typeof setTimeout>>()
  const { services } = useSite()
  const c = useContact()
  const pageOn = usePageOn()
  const links = NAV_LINKS.filter((l) => pageOn(l.to))

  useEffect(() => { setOpen(false); setMega(false) }, [pathname])
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setMega(false) } }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey) }
  }, [open])

  const openMega = () => { clearTimeout(megaTimer.current); setMega(true) }
  const closeMega = () => { megaTimer.current = setTimeout(() => setMega(false), 140) }
  const solid = scrolled || mega

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className={cn('hidden overflow-hidden bg-peri-900 text-peri-200 transition-all duration-500 md:block', scrolled || !c.topBar.enabled ? 'max-h-0' : 'max-h-10')}>
        <div className="l-container flex h-9 items-center justify-between text-xs">
          <p className="flex items-center gap-2"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>{c.topBar.text}</p>
          <div className="flex items-center gap-5">
            <a href={c.tel} className="flex items-center gap-1.5 transition hover:text-white"><Phone className="h-3.5 w-3.5" />{c.phone}</a>
            <a href={c.mailto} className="flex items-center gap-1.5 transition hover:text-white"><Mail className="h-3.5 w-3.5" />{c.email}</a>
          </div>
        </div>
      </div>

      <div className={cn('transition-all duration-500', scrolled ? 'py-2' : 'py-3 md:py-4')}>
        <nav aria-label="Primary" className={cn('l-container relative flex items-center justify-between gap-4 rounded-full transition-all duration-500',
          solid && 'max-w-6xl border border-white/70 bg-white/80 py-2 shadow-glass backdrop-blur-xl sm:px-4')}>
          <LandingLogo to={home} />
          <ul className="hidden items-center gap-0.5 lg:flex">
            {links.map((l) => (
              <li key={l.to} className="relative" onMouseEnter={l.mega ? openMega : undefined} onMouseLeave={l.mega ? closeMega : undefined}>
                <NavLink to={l.to} className={({ isActive }) => cn('relative flex items-center gap-1 rounded-full px-3.5 py-2 text-sm font-medium transition-colors xl:px-4',
                  isActive ? 'bg-peri-200/70 text-peri-900' : 'text-slate-500 hover:text-peri-800')}>
                  {l.label}
                  {l.mega && <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-300', mega && 'rotate-180')} aria-hidden="true" />}
                </NavLink>
                {l.mega && (
                  <button type="button" className="sr-only focus:not-sr-only focus:absolute focus:-right-2 focus:top-1 focus:rounded focus:bg-white focus:px-1 focus:text-xs" aria-expanded={mega} aria-controls="mega-menu" onClick={() => setMega((m) => !m)}>Toggle services menu</button>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Link to={user ? '/' : '/login'} className="hidden rounded-full px-4 py-2 text-sm font-semibold text-peri-800 transition hover:bg-peri-100 sm:inline-flex">{user ? 'Dashboard' : 'Sign in'}</Link>
            <Link to={book} className="btn-peri hidden !px-5 !py-2.5 sm:inline-flex">Book appointment<ArrowRight className="h-4 w-4" /></Link>
            <button type="button" onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-full border border-peri-200 bg-white/80 text-peri-800 backdrop-blur transition hover:bg-white lg:hidden" aria-label="Open menu" aria-expanded={open} aria-controls="mobile-menu">
              <Menu className="h-5 w-5" />
            </button>
          </div>
          <span aria-hidden="true" className={cn('absolute inset-x-6 -bottom-px h-[2px] origin-left rounded-full bg-gradient-to-r from-peri-400 via-peri-600 to-peri-800 transition-opacity', scrolled ? 'opacity-100' : 'opacity-0')} style={{ transform: `scaleX(${progress})` }} />

          {/* services mega menu */}
          <div id="mega-menu" onMouseEnter={openMega} onMouseLeave={closeMega}
            className={cn('absolute inset-x-0 top-[calc(100%+10px)] hidden transition-all duration-300 lg:block', mega ? 'visible translate-y-0 opacity-100' : 'invisible -translate-y-2 opacity-0')}>
            <div className="mx-auto grid max-w-6xl grid-cols-[1fr_280px] gap-2 rounded-3xl border border-white/80 bg-white/95 p-3 shadow-[0_30px_80px_-20px_rgba(41,41,102,.35)] backdrop-blur-xl">
              <ul className="grid grid-cols-3 gap-1 p-2">
                {services.map((s) => { const Icon = iconFor(s.icon); return (
                  <li key={s.slug}>
                    <Link to={`/services/${s.slug}`} tabIndex={mega ? 0 : -1} className="group flex items-start gap-3 rounded-2xl p-3 transition hover:bg-peri-50">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-peri-100 text-peri-700 transition group-hover:bg-peri-800 group-hover:text-white"><Icon className="h-5 w-5" /></span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-peri-900">{s.name}</span>
                        <span className="line-clamp-1 text-xs text-slate-500">{s.tagline}</span>
                      </span>
                    </Link>
                  </li>
                ) })}
              </ul>
              <div className="relative flex flex-col justify-between overflow-hidden rounded-2xl bg-peri-900 p-5 text-white">
                <div aria-hidden="true" className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-peri-500/50 blur-2xl" />
                <div className="relative">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-rose-500"><Siren className="h-5 w-5" /></span>
                  <p className="mt-4 font-display text-lg font-bold">{c.emergency.title}</p>
                  <p className="mt-1 text-sm text-peri-200">{c.emergency.text}</p>
                </div>
                <div className="relative mt-5 space-y-2">
                  <a href={c.tel} tabIndex={mega ? 0 : -1} className="flex items-center justify-center gap-2 rounded-full bg-white py-2.5 text-sm font-semibold text-peri-900 transition hover:bg-peri-100"><Phone className="h-4 w-4" />Call now</a>
                  <Link to="/services" tabIndex={mega ? 0 : -1} className="flex items-center justify-center gap-1.5 text-xs font-semibold text-peri-200 transition hover:text-white">All services<ArrowRight className="h-3.5 w-3.5" /></Link>
                </div>
              </div>
            </div>
          </div>
        </nav>
      </div>

      {/* mobile drawer */}
      <div id="mobile-menu" className={cn('fixed inset-0 z-50 lg:hidden', open ? 'pointer-events-auto' : 'pointer-events-none')} aria-hidden={!open}>
        <div className={cn('absolute inset-0 bg-peri-950/30 backdrop-blur-sm transition-opacity duration-300', open ? 'opacity-100' : 'opacity-0')} onClick={() => setOpen(false)} />
        <div className={cn('absolute inset-x-3 top-3 max-h-[calc(100dvh-24px)] overflow-y-auto rounded-3xl border border-white/80 bg-white/95 p-5 shadow-2xl backdrop-blur-xl transition-all duration-300', open ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0')}>
          <div className="flex items-center justify-between">
            <LandingLogo to={home} />
            <button type="button" onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center rounded-full bg-peri-100 text-peri-800" aria-label="Close menu" tabIndex={open ? 0 : -1}><X className="h-5 w-5" /></button>
          </div>
          <ul className="mt-6 space-y-1">
            {[{ to: home, label: 'Home' }, ...links, { to: '/faq', label: 'FAQ' }].filter((l) => pageOn(l.to)).map((l, i) => (
              <li key={l.to} className={cn('transition-all duration-500', open ? 'translate-x-0 opacity-100' : '-translate-x-3 opacity-0')} style={{ transitionDelay: open ? `${60 + i * 40}ms` : '0ms' }}>
                <NavLink to={l.to} end={l.to === home} tabIndex={open ? 0 : -1} className={({ isActive }) => cn('flex items-center justify-between rounded-2xl px-4 py-3 font-display text-lg font-semibold transition', isActive ? 'bg-peri-100 text-peri-900' : 'text-peri-900 hover:bg-peri-50')}>
                  {l.label}<ArrowUpRight className="h-4 w-4 text-peri-400" />
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Link to={user ? '/' : '/login'} tabIndex={open ? 0 : -1} className="btn-ghost">{user ? 'Dashboard' : 'Sign in'}</Link>
            <Link to={book} tabIndex={open ? 0 : -1} className="btn-peri">Book now</Link>
          </div>
          <a href={c.tel} tabIndex={open ? 0 : -1} className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-rose-50 py-3 text-sm font-semibold text-rose-600"><Siren className="h-4 w-4" />Emergency: {c.phone}</a>
        </div>
      </div>
    </header>
  )
}

/* ───────────────────────────────── Footer ───────────────────────────────── */

function Footer() {
  const book = useBookHref()
  const home = useHomeHref()
  const { services } = useSite()
  const c = useContact()
  const pageOn = usePageOn()
  const socials = c.socials.filter((x) => x.url.trim())
  const cols: { title: string; links: [string, string][] }[] = [
    { title: 'Patients', links: [['Book appointment', book], ['Find a doctor', '/find-a-doctor'], ['Health packages', '/packages'], ['Patient portal', '/login'], ['FAQ', '/faq']] },
    { title: 'Specialities', links: pageOn('/services') ? services.slice(0, 6).map((s) => [s.name, `/services/${s.slug}`]) : [] },
    { title: 'Hospital', links: [['About us', '/about'], ['All services', '/services'], ['Contact us', '/contact'], ['Home', home], ['Staff login', '/login']] },
  ].map((col) => ({ ...col, links: col.links.filter(([, to]) => pageOn(to)) as [string, string][] })).filter((col) => col.links.length)
  return (
    <footer className="relative border-t border-peri-200/70 bg-white pb-28 pt-16 sm:pb-10">
      <div className="l-container">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.3fr_2fr]">
          <div>
            <LandingLogo to={home} />
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-slate-500">{c.about}</p>
            <ul className="mt-6 space-y-3 text-sm text-slate-600">
              <li className="flex gap-3"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-peri-500" />{c.address}</li>
              <li><a href={c.tel} className="flex gap-3 transition hover:text-peri-800"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-peri-500" />{c.phone}</a></li>
              <li><a href={c.mailto} className="flex gap-3 transition hover:text-peri-800"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-peri-500" />{c.email}</a></li>
            </ul>
            {socials.length > 0 && <div className="mt-6 flex gap-2">
              {socials.map(({ platform: s, url }) => (
                <a key={s} href={url} target="_blank" rel="noreferrer noopener" aria-label={`${c.name} on ${s}`} className="grid h-10 w-10 place-items-center rounded-full border border-peri-200 text-peri-600 transition duration-300 hover:-translate-y-0.5 hover:border-peri-800 hover:bg-peri-800 hover:text-white">
                  <SocialIcon name={s} />
                </a>
              ))}
            </div>}
          </div>
          <div className={cn('grid grid-cols-2 gap-8', cols.length >= 3 && 'sm:grid-cols-3')}>
            {cols.map((c) => (
              <nav key={c.title} aria-label={c.title}>
                <h3 className="font-display text-sm font-bold text-peri-900">{c.title}</h3>
                <ul className="mt-4 space-y-3">
                  {c.links.map(([label, href]) => <li key={label}><Link to={href} className="text-sm text-slate-500 transition hover:text-peri-800">{label}</Link></li>)}
                </ul>
              </nav>
            ))}
            <div className="col-span-2 rounded-2xl bg-gradient-to-br from-peri-100 to-peri-200/60 p-5 sm:col-span-3">
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <p className="flex items-center gap-2 font-display text-sm font-bold text-peri-900"><Siren className="h-4 w-4 text-rose-500" />{c.emergency.title}</p>
                  <p className="mt-1 text-xs text-slate-600">{c.emergency.text}</p>
                </div>
                <a href={c.tel} className="btn-peri !py-2.5">Call now</a>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-peri-100 pt-6 text-xs text-slate-500 sm:flex-row">
          <p>© {new Date().getFullYear()} {c.name}. All rights reserved.</p>
          <div className="flex gap-5">
            <Link to="/privacy" className="hover:text-peri-800">Privacy policy</Link>
            <Link to="/terms" className="hover:text-peri-800">Terms of use</Link>
            {pageOn('/contact') && <Link to="/contact" className="hover:text-peri-800">Grievances</Link>}
          </div>
        </div>
      </div>
    </footer>
  )
}

/* ───────────────────────────────── Mobile sticky CTA ───────────────────────────────── */

function MobileCtaBar() {
  const { y } = useScroll()
  const book = useBookHref()
  const { tel } = useContact()
  const show = y > 560
  return (
    <div className={cn('fixed inset-x-3 bottom-3 z-40 transition-all duration-500 sm:hidden', show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-24 opacity-0')} aria-hidden={!show}>
      <div className="glass flex items-center gap-2 rounded-full p-1.5">
        <a href={tel} tabIndex={show ? 0 : -1} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600" aria-label="Call emergency"><Phone className="h-5 w-5" /></a>
        <Link to={book} tabIndex={show ? 0 : -1} className="btn-peri flex-1 !py-3.5">Book appointment<ArrowRight className="h-4 w-4" /></Link>
      </div>
    </div>
  )
}
