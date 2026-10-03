/**
 * Building blocks of the product site: tiny client-side router, links, SEO tags, layout (announcement bar, header,
 * footer), section headings, call-to-action band and a safe Markdown renderer for blog posts.
 */
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { ArrowRight, Eye, Mail, MapPin, Menu, Phone, Stethoscope, X } from 'lucide-react'
import { SocialIcon } from '../../site/parts'
import { platformCompany, platformDomain, platformName } from '../../lib/supabase'
import { safeUrl } from '../../lib/safeUrl'
import { cn } from '../../lib/utils'
import { iconFor } from '../../site/cms/icons'
import { isPreview } from './store'
import type { Cta, Heading, IconItem, PlatformSite, Seo } from './types'

// ------------------------------------------------------------------ routing
/** keeps ?platform (preview hosts) and ?preview (drafts) on internal links */
export function siteHref(path: string): string {
  if (typeof location === 'undefined' || !path.startsWith('/')) return path
  const cur = new URLSearchParams(location.search)
  const keep = ['platform', 'preview'].filter((k) => cur.has(k))
  if (!keep.length) return path
  const [p, hash = ''] = path.split('#')
  return `${p}${p.includes('?') ? '&' : '?'}${keep.join('&')}${hash ? `#${hash}` : ''}`
}
const internal = (to: string) => to.startsWith('/') && !to.startsWith('//') && !to.startsWith('/control-panel')

export function navigate(to: string) {
  const url = siteHref(to)
  if (url === location.pathname + location.search) { window.scrollTo({ top: 0, behavior: 'smooth' }); return }
  history.pushState(null, '', url)
  window.dispatchEvent(new Event('hc:nav'))
  const hash = url.split('#')[1]
  requestAnimationFrame(() => { const el = hash && document.getElementById(hash); if (el) el.scrollIntoView(); else window.scrollTo(0, 0) })
}
export function usePath(): { path: string; search: URLSearchParams } {
  const read = () => ({ path: location.pathname.replace(/\/+$/, '') || '/', search: new URLSearchParams(location.search) })
  const [s, set] = useState(read)
  useEffect(() => {
    const on = () => set(read())
    window.addEventListener('popstate', on); window.addEventListener('hc:nav', on)
    return () => { window.removeEventListener('popstate', on); window.removeEventListener('hc:nav', on) }
  }, [])
  return s
}

/** <a> that navigates inside the site without a reload; other links behave normally */
export function A({ to, className, children, onClick, ...rest }: { to: string; className?: string; children: ReactNode; onClick?: () => void; 'aria-current'?: 'page' }) {
  const isInt = internal(to)
  const href = isInt ? siteHref(to) : safeUrl(to) || '#'
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.()
    if (!isInt || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault(); navigate(to)
  }
  const ext = !isInt && /^https?:/i.test(href)
  return <a href={href} onClick={click} className={className} {...(ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...rest}>{children}</a>
}

// ------------------------------------------------------------------ SEO
function meta(attr: 'name' | 'property', key: string, content: string) {
  let m = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!m) { m = document.createElement('meta'); m.setAttribute(attr, key); document.head.appendChild(m) }
  m.content = content
}
export function useSeo(seo: Partial<Seo> | undefined, fallbackTitle: string) {
  useEffect(() => {
    const title = `${(seo?.title || fallbackTitle).trim()} · ${platformName}`
    const desc = (seo?.description || '').trim()
    document.title = title
    meta('name', 'description', desc)
    meta('property', 'og:title', title)
    meta('property', 'og:description', desc)
    meta('property', 'og:type', 'website')
    const img = safeUrl(seo?.image, 'image')
    if (img) meta('property', 'og:image', img.startsWith('/') ? location.origin + img : img)
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link) }
    link.href = `https://${platformDomain}${location.pathname}`
  }, [seo?.title, seo?.description, seo?.image, fallbackTitle])
}

// ------------------------------------------------------------------ text helpers
/** *word* → highlighted */
export function Hi({ text, hl = 'text-gradient' }: { text: string; hl?: string }) {
  return <>{text.split(/(\*[^*]+\*)/g).filter(Boolean).map((p, i) => (p.length > 2 && p.startsWith('*') && p.endsWith('*') ? <span key={i} className={hl}>{p.slice(1, -1)}</span> : <span key={i}>{p}</span>))}</>
}
export const plain = (t: string) => t.replace(/\*/g, '')

// ------------------------------------------------------------------ sections
export function SectionHead({ h, as = 'h2', className }: { h: Partial<Heading> & { title: string }; as?: 'h1' | 'h2'; className?: string }) {
  const H = as
  return (
    <div className={cn('mx-auto max-w-2xl text-center', className)}>
      {h.eyebrow && <span className="l-eyebrow">{h.eyebrow}</span>}
      <H className={cn('mt-4 font-display font-extrabold tracking-tight text-peri-900', as === 'h1' ? 'text-4xl sm:text-5xl' : 'text-3xl sm:text-4xl')}><Hi text={h.title} /></H>
      {h.lead && <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">{h.lead}</p>}
    </div>
  )
}
export function Section({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return <section id={id} className={cn('scroll-mt-24 py-16 sm:py-20', className)}><div className="l-container">{children}</div></section>
}
/** page title band at the top of inner pages */
export function PageHero({ h }: { h: Heading }) {
  return (
    <section className="relative pb-10 pt-14 sm:pb-14 sm:pt-20">
      <div aria-hidden="true" className="absolute -right-32 -top-40 h-[420px] w-[420px] rounded-full bg-[#CCCCFF] opacity-60 blur-3xl" />
      <div aria-hidden="true" className="absolute -left-40 top-20 h-[320px] w-[320px] rounded-full bg-[#A3A3CC] opacity-25 blur-3xl" />
      <div className="l-container relative"><SectionHead h={h} as="h1" /></div>
    </section>
  )
}
export function IconCard({ item }: { item: IconItem }) {
  const Icon = iconFor(item.icon)
  return (
    <div className="rounded-3xl border border-peri-200/80 bg-white p-6 shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-glow">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#CCCCFF] text-peri-900"><Icon className="h-5 w-5" /></span>
      <h3 className="mt-4 font-display text-base font-bold text-peri-900">{item.title}</h3>
      {item.text && <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.text}</p>}
    </div>
  )
}
export function CtaBand({ cta }: { cta: Cta }) {
  if (!cta?.title) return null
  return (
    <section className="py-14 sm:py-20">
      <div className="l-container">
        <div className="relative overflow-hidden rounded-[2rem] bg-[#292966] px-6 py-12 text-center text-white sm:px-12 sm:py-16">
          <div aria-hidden="true" className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#5C5C99] opacity-60 blur-3xl" />
          <div aria-hidden="true" className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-[#A3A3CC] opacity-30 blur-3xl" />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl"><Hi text={cta.title} hl="text-[#CCCCFF]" /></h2>
            {cta.lead && <p className="mt-4 text-[#CCCCFF]">{cta.lead}</p>}
            {cta.button && <A to={cta.link || '/signup'} className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 font-semibold text-[#292966] shadow-lg transition hover:bg-[#CCCCFF]">{cta.button}<ArrowRight className="h-4 w-4" /></A>}
          </div>
        </div>
      </div>
    </section>
  )
}
export function FaqList({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="space-y-3">
      {items.map((f) => (
        <details key={f.q} className="group rounded-2xl border border-peri-200/80 bg-white p-5 shadow-soft">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-peri-900">
            {f.q}<span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-peri-100 text-peri-700 transition group-open:rotate-45">+</span>
          </summary>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">{f.a}</p>
        </details>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ Markdown (blog) — builds React elements, never HTML
function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(!\[([^\]]*)\]\(([^)\s]+)\))|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(_([^_]+)_)/g
  let last = 0, m: RegExpExecArray | null, n = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}-${n++}`
    if (m[1]) { const src = safeUrl(m[3], 'image'); if (src) out.push(<img key={k} src={src} alt={m[2]} loading="lazy" className="my-6 w-full rounded-2xl" />) }
    else if (m[4]) { const href = safeUrl(m[6]); out.push(href ? <A key={k} to={href} className="font-medium text-peri-700 underline underline-offset-2 hover:text-peri-500">{m[5]}</A> : m[5]) }
    else if (m[7]) out.push(<strong key={k} className="font-semibold text-peri-900">{m[8]}</strong>)
    else if (m[9]) out.push(<code key={k} className="rounded bg-peri-50 px-1.5 py-0.5 text-[0.9em] text-peri-900">{m[10]}</code>)
    else if (m[11]) out.push(<em key={k}>{m[12]}</em>)
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
/** ## headings, paragraphs, - / 1. lists, > quotes, --- rules, **bold**, _italic_, `code`, [links](https://…), ![images](https://…) */
export function Markdown({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/)
  return (
    <div className="space-y-5 text-[1.05rem] leading-relaxed text-slate-700">
      {blocks.map((b, i) => {
        const t = b.trim()
        if (!t) return null
        const h = t.match(/^(#{1,4})\s+(.*)$/)
        if (h && !t.includes('\n')) {
          const lvl = h[1].length
          return lvl <= 2 ? <h2 key={i} className="pt-4 font-display text-2xl font-extrabold text-peri-900">{inline(h[2], `h${i}`)}</h2>
            : <h3 key={i} className="pt-2 font-display text-xl font-bold text-peri-900">{inline(h[2], `h${i}`)}</h3>
        }
        if (/^(-{3,}|\*{3,})$/.test(t)) return <hr key={i} className="border-peri-200" />
        const lines = t.split('\n')
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return <ul key={i} className="list-disc space-y-1.5 pl-6 marker:text-peri-500">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ''), `u${i}${j}`)}</li>)}</ul>
        if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return <ol key={i} className="list-decimal space-y-1.5 pl-6 marker:font-semibold marker:text-peri-600">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*\d+[.)]\s+/, ''), `o${i}${j}`)}</li>)}</ol>
        if (lines.every((l) => l.startsWith('>'))) return <blockquote key={i} className="border-l-4 border-peri-300 bg-peri-50/60 py-2 pl-4 italic text-peri-900">{inline(lines.map((l) => l.replace(/^>\s?/, '')).join(' '), `q${i}`)}</blockquote>
        if (h) {   // heading followed by text in the same block
          return <div key={i}><h2 className="pt-4 font-display text-2xl font-extrabold text-peri-900">{inline(h[2].split('\n')[0], `h${i}`)}</h2><p className="mt-3">{inline(lines.slice(1).join(' '), `p${i}`)}</p></div>
        }
        return <p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l, `p${i}${j}`)}</span>)}</p>
      })}
    </div>
  )
}

// ------------------------------------------------------------------ layout
export const NAV: [string, string][] = [['Features', '/features'], ['Solutions', '/solutions'], ['Pricing', '/pricing'], ['Security', '/security'], ['Blog', '/blog'], ['About', '/about']]

function Logo({ site }: { site: PlatformSite }) {
  const logo = safeUrl(site.brand.logo, 'image')
  return (
    <A to="/" className="flex items-center gap-2.5 font-display text-lg font-extrabold text-peri-900">
      {logo ? <img src={logo} alt="" className="h-9 w-auto max-w-[140px] object-contain" />
        : <span className="grid h-9 w-9 place-items-center rounded-xl bg-peri-800 text-white shadow-glow"><Stethoscope className="h-5 w-5" /></span>}
      {platformName}
    </A>
  )
}

function Header({ site, path }: { site: PlatformSite; path: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [path])
  const active = (to: string) => path === to || (to !== '/' && path.startsWith(`${to}/`))
  return (
    <header className="sticky top-0 z-40 border-b border-peri-200/60 bg-white/80 backdrop-blur-xl">
      <div className="l-container flex h-16 items-center justify-between gap-4">
        <Logo site={site} />
        <nav aria-label="Main" className="hidden items-center gap-6 text-sm font-medium text-peri-800 lg:flex">
          {NAV.map(([l, to]) => <A key={to} to={to} aria-current={active(to) ? 'page' : undefined} className={cn('transition hover:text-peri-500', active(to) && 'text-peri-500')}>{l}</A>)}
        </nav>
        <div className="flex items-center gap-2">
          <A to="/contact" className="hidden px-2 text-sm font-semibold text-peri-800 hover:text-peri-500 md:inline">Contact</A>
          <A to="/signup" className="btn-peri hidden !px-5 !py-2.5 sm:inline-flex">Start free trial<ArrowRight className="h-4 w-4" /></A>
          <button type="button" className="grid h-10 w-10 place-items-center rounded-xl text-peri-800 hover:bg-peri-100 lg:hidden" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav aria-label="Mobile" className="border-t border-peri-200/60 bg-white lg:hidden">
          <div className="l-container flex flex-col py-3">
            {[...NAV, ['FAQ', '/faq'] as [string, string], ['Contact', '/contact'] as [string, string]].map(([l, to]) => (
              <A key={to} to={to} className={cn('rounded-xl px-3 py-3 font-medium text-peri-900 hover:bg-peri-50', active(to) && 'bg-peri-50')}>{l}</A>
            ))}
            <A to="/signup" className="btn-peri mt-2">Start free trial<ArrowRight className="h-4 w-4" /></A>
          </div>
        </nav>
      )}
    </header>
  )
}

function Footer({ site }: { site: PlatformSite }) {
  const b = site.brand
  const social = ([['linkedin', 'LinkedIn'], ['x', 'X'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['youtube', 'YouTube']] as const)
    .map(([k, icon]) => ({ k, icon, url: safeUrl(b.social?.[k], 'web') })).filter((s) => s.url)
  const legal = site.legal.docs.filter((d) => !d.hidden && d.slug !== 'contact')
  const col = (title: string, links: [string, string][]) => (
    <div>
      <p className="text-xs font-bold uppercase tracking-[.18em] text-peri-500">{title}</p>
      <ul className="mt-4 space-y-2.5 text-sm">{links.map(([l, to]) => <li key={to}><A to={to} className="text-slate-600 hover:text-peri-700">{l}</A></li>)}</ul>
    </div>
  )
  return (
    <footer className="border-t border-peri-200/70 bg-white/60">
      <div className="l-container grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div>
          <Logo site={site} />
          {b.footerText && <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-600">{b.footerText}</p>}
          <ul className="mt-5 space-y-2 text-sm text-slate-600">
            {b.email && <li><a href={`mailto:${b.email}`} className="inline-flex items-center gap-2 hover:text-peri-700"><Mail className="h-4 w-4 text-peri-500" />{b.email}</a></li>}
            {b.phone && <li><a href={`tel:${b.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-2 hover:text-peri-700"><Phone className="h-4 w-4 text-peri-500" />{b.phone}</a></li>}
            {b.address && <li className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-peri-500" />{b.address}</li>}
          </ul>
          {social.length > 0 && (
            <div className="mt-5 flex gap-2">
              {social.map(({ k, icon, url }) => <a key={k} href={url} target="_blank" rel="noopener noreferrer" aria-label={icon} className="grid h-9 w-9 place-items-center rounded-full border border-peri-200 text-peri-700 transition hover:bg-peri-800 hover:text-white"><SocialIcon name={icon} /></a>)}
            </div>
          )}
        </div>
        {col('Product', [['Features', '/features'], ['Solutions', '/solutions'], ['Pricing', '/pricing'], ['Security', '/security'], ['Free trial', '/signup']])}
        {col('Company', [['About us', '/about'], ['Blog', '/blog'], ['FAQ', '/faq'], ['Contact', '/contact'], ['Grievances', '/legal/grievance']])}
        {col('Legal', legal.map((d) => [d.title, `/legal/${d.slug}`] as [string, string]))}
      </div>
      <div className="border-t border-peri-200/60">
        <p className="l-container py-5 text-center text-xs text-slate-500 sm:text-left">© {new Date().getFullYear()} {platformCompany.legalName} · {platformName} · {platformDomain}</p>
      </div>
    </footer>
  )
}

function AnnouncementBar({ site }: { site: PlatformSite }) {
  const a = site.brand.announcement
  if (!a?.enabled || !a.text) return null
  return (
    <div className="bg-[#292966] px-4 py-2 text-center text-sm text-white">
      {a.text}{a.link && <> <A to={a.link} className="ml-1 font-semibold text-[#CCCCFF] underline underline-offset-2 hover:text-white">{a.linkText || 'Learn more'} →</A></>}
    </div>
  )
}

export function Layout({ site, path, children }: { site: PlatformSite; path: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-[#f7f7ff] text-slate-700">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2">Skip to content</a>
      {isPreview() && <div className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-xs font-semibold text-amber-950 print:hidden"><Eye className="h-3.5 w-3.5" />Preview — showing unpublished drafts (only the platform team sees these)</div>}
      <AnnouncementBar site={site} />
      <Header site={site} path={path} />
      <main id="main" className="flex-1">{children}</main>
      <Footer site={site} />
    </div>
  )
}
