/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, CircleDot, CloudUpload, Database, ExternalLink, EyeOff, FilePenLine, Globe, ImageIcon, Inbox, Keyboard, Layers, Sparkles,
} from 'lucide-react'
import { Badge, Button, Skeleton } from '../../components/ui'
import { useTable } from '../../hooks/useData'
import { ago, cn } from '../../lib/utils'
import { cms, type ContentRows } from '../../site/cms/store'
import type { ContentKey, SiteContent } from '../../site/cms/types'
import { SECTIONS, type Section } from './schema'

/** which Site settings → pages toggle controls a page section */
const PAGE_TOGGLE: Partial<Record<ContentKey, keyof SiteContent['settings']['pages']>> = {
  about: 'about', servicesPage: 'services', doctorsPage: 'doctors', packagesPage: 'packages', contactPage: 'contact', faqPage: 'faq',
}

function summary(k: ContentKey, v: any): string | null {
  if (!v) return null
  switch (k) {
    case 'services': case 'doctors': case 'support': case 'testimonials': {
      const a = v as { hidden?: boolean }[]; const h = a.filter((x) => x.hidden).length
      return `${a.length} item${a.length === 1 ? '' : 's'}${h ? ` · ${h} hidden` : ''}`
    }
    case 'packages': return `${v.items?.length ?? 0} packages · ${v.compare?.length ?? 0} compare groups`
    case 'faqs': return `${v.length} groups · ${v.reduce((n: number, g: any) => n + (g.items?.length ?? 0), 0)} questions`
    case 'home': return `${Object.values(v.sections ?? {}).filter(Boolean).length} of ${Object.keys(v.sections ?? {}).length} blocks shown`
    case 'settings': return `${v.hours?.length ?? 0} opening-hour rows · ${v.socials?.length ?? 0} social links`
    default: return null
  }
}

export function CmsOverview({ rows, loading, site, dirtyKeys, onOpen, onPublishAll, publishingAll, compact }: {
  compact?: boolean; rows?: ContentRows; loading: boolean; site: SiteContent; dirtyKeys: ContentKey[]
  onOpen: (k: ContentKey | 'media') => void; onPublishAll: () => void; publishingAll: boolean
}) {
  const enquiries = useTable('site_enquiries')
  const newEnq = enquiries.data?.filter((e) => e.status === 'new').length ?? 0
  const pages = site.settings.pages
  const visiblePages = 1 + Object.values(pages).filter(Boolean).length
  const totalPages = 1 + Object.keys(pages).length
  const edited = Object.keys(rows ?? {}).length
  const recent = Object.values(rows ?? {}).filter(Boolean).sort((a, b) => b!.updated_at.localeCompare(a!.updated_at)).slice(0, 6)
  const liveDoctors = site.doctors.filter((d) => !d.hidden).length
  const liveServices = site.services.filter((s) => !s.hidden).length

  const stats = [
    { label: 'Visible pages', value: `${visiblePages}/${totalPages}`, hint: visiblePages === totalPages ? 'All pages are live' : `${totalPages - visiblePages} hidden from the menu`, icon: Globe, onClick: () => onOpen('settings') },
    { label: 'Customised sections', value: `${edited}/${SECTIONS.length}`, hint: edited ? 'Edited from the original' : 'Still the original content', icon: FilePenLine },
    { label: 'Unpublished drafts', value: String(dirtyKeys.length), hint: dirtyKeys.length ? 'Waiting to be published' : 'Everything is live', icon: CircleDot, warn: dirtyKeys.length > 0 },
    { label: 'New enquiries', value: enquiries.isPending ? '—' : String(newEnq), hint: 'From the website forms', icon: Inbox, to: '/enquiries' },
  ]

  return (
    <div className="space-y-6">
      {/* hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-900 via-[#3a3a7a] to-brand-600 p-6 text-white shadow-lift sm:p-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-brand-300/25 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 left-1/3 h-60 w-60 rounded-full bg-brand-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-xl">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-brand-300 ring-1 ring-inset ring-white/15">
              <Sparkles className="h-3 w-3" />Website CMS
            </p>
            <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight sm:text-3xl">Manage every page of your website</h1>
            <p className="mt-2 text-sm leading-relaxed text-brand-200">Edit texts, images, doctors, specialities and packages. Changes stay as drafts, with a live preview, until you publish them.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="outline" className="border-white/20 bg-white text-brand-900 hover:bg-brand-50" icon={<Layers className="h-4 w-4" />} onClick={() => onOpen('home')}>Edit home page</Button>
              <a href="/welcome" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium text-white ring-1 ring-inset ring-white/25 transition hover:bg-white/10">
                <ExternalLink className="h-4 w-4" />View website
              </a>
              {dirtyKeys.length > 0 && (
                <Button className="bg-amber-400 text-amber-950 shadow-none hover:bg-amber-300" loading={publishingAll} icon={<CloudUpload className="h-4 w-4" />} onClick={onPublishAll}>
                  Publish all ({dirtyKeys.length})
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end sm:text-right">
            <Badge tone={cms.mode === 'supabase' ? 'green' : 'amber'} dot><Database className="mr-0.5 h-3 w-3" />{cms.mode === 'supabase' ? 'Supabase' : 'Demo · this browser'}</Badge>
            <p className="text-xs text-brand-300">{liveDoctors} doctors · {liveServices} specialities live</p>
            <p className="hidden items-center gap-1.5 text-[11px] text-brand-400 sm:inline-flex"><Keyboard className="h-3.5 w-3.5" />Ctrl + S publish · Ctrl + Z undo</p>
          </div>
        </div>
      </section>

      {/* stats */}
      <div className={cn('grid grid-cols-2 gap-3', !compact && 'lg:grid-cols-4')}>
        {stats.map((s) => {
          const body = (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-500">{s.label}</p>
                <span className={cn('grid h-8 w-8 place-items-center rounded-lg', s.warn ? 'bg-amber-50 text-amber-600' : 'bg-brand-50 text-brand-700')}><s.icon className="h-4 w-4" /></span>
              </div>
              <div className={cn('mt-2 font-display text-2xl font-semibold', s.warn ? 'text-amber-600' : 'text-brand-950')}>{loading ? <Skeleton className="h-7 w-14" /> : s.value}</div>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">{s.hint}</p>
            </>
          )
          const cls = 'card block p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lift'
          return s.to ? <Link key={s.label} to={s.to} className={cls}>{body}</Link>
            : s.onClick ? <button key={s.label} type="button" onClick={s.onClick} className={cls}>{body}</button>
              : <div key={s.label} className="card p-4">{body}</div>
        })}
      </div>

      <div className={cn('grid gap-6', !compact && '2xl:grid-cols-[minmax(0,1fr)_320px]')}>
        {/* section cards */}
        <div className="space-y-6">
          {(['General', 'Pages', 'Collections'] as const).map((g) => (
            <div key={g}>
              <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[.14em] text-brand-600">{g}</h2>
              <div className={cn('grid gap-3 sm:grid-cols-2', !compact && 'xl:grid-cols-3')}>
                {SECTIONS.filter((s) => s.group === g).map((s) => (
                  <SectionCard key={s.key} s={s} row={rows?.[s.key]} loading={loading} draft={dirtyKeys.includes(s.key)}
                    hidden={PAGE_TOGGLE[s.key] ? !pages[PAGE_TOGGLE[s.key]!] : false} info={summary(s.key, site[s.key])} onOpen={() => onOpen(s.key)} />
                ))}
                {g === 'General' && (
                  <button type="button" onClick={() => onOpen('media')} className="group card flex items-start gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-300 to-brand-400 text-brand-900"><ImageIcon className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2 text-sm font-semibold text-brand-950">Media library<ArrowRight className="h-4 w-4 text-brand-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600" /></span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">Upload and reuse images anywhere on the website.</span>
                    </span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* recent activity */}
        <aside className={cn('card h-fit p-5', !compact && '2xl:sticky 2xl:top-36')}>
          <h2 className="text-sm font-semibold text-brand-950">Recent activity</h2>
          <p className="text-xs text-slate-500">Latest published changes</p>
          <ol className="mt-4 space-y-3">
            {loading ? Array.from({ length: 3 }).map((_, i) => <li key={i}><Skeleton className="h-10 rounded-lg" /></li>)
              : recent.length === 0 ? <li className="rounded-xl bg-brand-50/60 p-4 text-center text-xs text-slate-500">Nothing published yet — the website shows the original content.</li>
                : recent.map((r) => {
                  const s = SECTIONS.find((x) => x.key === r!.key)
                  if (!s) return null
                  return (
                    <li key={r!.key}>
                      <button type="button" onClick={() => onOpen(s.key)} className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition hover:bg-brand-50">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-800"><s.icon className="h-4 w-4" /></span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-800">{s.label}</span>
                          <span className="block truncate text-[11px] text-slate-500">{ago(r!.updated_at)}{r!.updated_by_name ? ` · ${r!.updated_by_name}` : ''}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
          </ol>
        </aside>
      </div>
    </div>
  )
}

function SectionCard({ s, row, draft, hidden, info, loading, onOpen }: {
  s: Section; row?: { updated_at: string }; draft: boolean; hidden: boolean; info: string | null; loading: boolean; onOpen: () => void
}) {
  return (
    <button type="button" onClick={onOpen}
      className={cn('group card relative flex items-start gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lift', draft ? 'border-amber-200' : 'hover:border-brand-300')}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-900 text-white shadow-md shadow-brand-900/20"><s.icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2 text-sm font-semibold text-brand-950">
          <span className="truncate">{s.label}</span>
          <ArrowRight className="h-4 w-4 shrink-0 text-brand-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
        </span>
        <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{s.description}</span>
        <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {loading ? <Skeleton className="h-5 w-20 rounded-full" />
            : draft ? <Pill cls="bg-amber-50 text-amber-700 ring-amber-200"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Draft</Pill>
              : row ? <Pill cls="bg-brand-50 text-brand-800 ring-brand-200">Edited {ago(row.updated_at)}</Pill>
                : <Pill cls="bg-slate-50 text-slate-500 ring-slate-200">Original</Pill>}
          {hidden && <Pill cls="bg-rose-50 text-rose-600 ring-rose-200"><EyeOff className="h-3 w-3" />Hidden</Pill>}
          {info && <span className="text-[11px] text-slate-400">{info}</span>}
        </span>
      </span>
    </button>
  )
}
const Pill = ({ cls, children }: { cls: string; children: ReactNode }) =>
  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset', cls)}>{children}</span>
