import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Bell, ChevronDown, Cross, Database, EyeOff, LogOut, Megaphone, Menu, Search, Settings, X, CircleUserRound } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { NAV, navLabel } from './nav'
import { Avatar, Badge } from '../ui'
import { ROLE_LABEL } from '../../types'
import { cn, ago } from '../../lib/utils'
import { useSiteSettings } from '../../site/cms/content'
import { useAppSettings, useDashboardChrome } from '../../settings/AppSettingsProvider'
import { isSupabaseConfigured } from '../../lib/supabase'
import { useTable } from '../../hooks/useData'
import { LanguageSwitch, useT } from '../../i18n'

/** Patients get the portal in their language; staff screens stay English. */
function usePortalT() {
  const { user } = useAuth()
  const { t } = useT()
  return (s: string) => (user?.role === 'patient' ? t(s) : s)
}

export function Logo({ light }: { light?: boolean }) {
  const site = useSiteSettings()
  const b = site.brand
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {b?.logoUrl ? (
        <span className={cn('grid h-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-white p-1 shadow-sm ring-1', b.showName ? 'w-9' : 'max-w-[190px] px-2', light ? 'ring-white/30' : 'ring-slate-200')}>
          <img src={b.logoUrl} alt={b.showName ? '' : site.name} className="h-full w-full object-contain" />
        </span>
      ) : (
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-300 via-brand-400 to-brand-600 text-white shadow-lg shadow-brand-950/40 ring-1 ring-white/30">
          <Cross className="h-5 w-5" strokeWidth={2.75} />
        </div>
      )}
      {(b?.showName ?? true) && (
        <div className="min-w-0 leading-tight">
          <div className={cn('truncate text-[15px] font-bold tracking-tight', light ? 'text-white' : 'text-slate-900')}>{site.name}</div>
          {b?.appSubtitle && <div className={cn('truncate text-[10px] font-medium uppercase tracking-[.14em]', light ? 'text-brand-300/80' : 'text-slate-400')}>{b.appSubtitle}</div>}
        </div>
      )}
    </div>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth()
  const { settings } = useAppSettings()
  const tr = usePortalT()
  if (!user) return null
  const style = settings.appearance.sidebar
  const light = style === 'light'
  const hidden = new Set(settings.modules.hidden)
  return (
    <div className={cn('relative flex h-full flex-col overflow-hidden',
      light ? 'border-r border-brand-100 bg-white text-slate-600' : style === 'brand' ? 'bg-gradient-to-b from-brand-600 via-brand-700 to-brand-800 text-brand-100' : 'bg-gradient-to-b from-brand-900 via-brand-900 to-brand-950 text-brand-200')}>
      {!light && <>
        <div aria-hidden="true" className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-brand-600/40 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -right-24 h-64 w-64 rounded-full bg-brand-400/15 blur-3xl" />
      </>}
      <div className="relative px-5 py-5"><Logo light={!light} /></div>
      <nav className={cn('relative flex-1 space-y-5 overflow-y-auto px-3 pb-6', light ? 'scrollbar-thin' : 'scrollbar-dark')}>
        {NAV.map((section) => {
          const items = section.items.filter((i) => i.roles.includes(user.role) && (user.role === 'owner' || !hidden.has(i.path)))
          if (!items.length) return null
          return (
            <div key={section.title}>
              <div className={cn('px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[.16em]', light ? 'text-slate-400' : 'text-brand-400/80')}>{tr(section.title)}</div>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavLink key={item.path} to={item.path} end={item.path === '/'} onClick={onNavigate}
                    className={({ isActive }) => cn('group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition duration-200',
                      light
                        ? isActive ? 'bg-brand-50 text-brand-900 ring-1 ring-inset ring-brand-200' : 'text-slate-600 hover:bg-slate-50 hover:text-brand-900'
                        : isActive ? 'bg-gradient-to-r from-white/[.16] to-white/[.04] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.08)] ring-1 ring-inset ring-brand-300/20' : 'text-brand-200/75 hover:bg-white/[.06] hover:text-white',
                      hidden.has(item.path) && 'opacity-50')}>
                    {({ isActive }) => <>
                      {isActive && <span aria-hidden="true" className={cn('absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full', light ? 'bg-brand-600' : 'bg-brand-300 shadow-[0_0_12px_rgba(255,255,255,.5)]')} />}
                      <item.icon className={cn('h-[18px] w-[18px] transition', light ? (isActive ? 'text-brand-700' : 'text-slate-400 group-hover:text-brand-700') : (isActive ? 'text-brand-300' : 'text-brand-400 group-hover:text-brand-200'))} />
                      <span className="flex-1 truncate">{tr(navLabel(item, user.role))}</span>
                      {hidden.has(item.path) && <EyeOff className="h-3.5 w-3.5" aria-label="Hidden for other users" />}
                    </>}
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })}
      </nav>
      <div className={cn('relative border-t p-3', light ? 'border-slate-100' : 'border-white/[.07]')}>
        <div className={cn('flex items-center gap-3 rounded-xl p-2.5 ring-1 ring-inset', light ? 'bg-slate-50 ring-slate-100' : 'bg-white/[.07] ring-white/[.06]')}>
          <Avatar name={user.full_name} src={user.avatar_url} size="sm" />
          <div className="min-w-0 flex-1">
            <div className={cn('truncate text-xs font-semibold', light ? 'text-slate-900' : 'text-white')}>{user.full_name}</div>
            <div className={cn('truncate text-[11px]', light ? 'text-slate-500' : 'text-brand-300')}>{tr(ROLE_LABEL[user.role])}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const TONE: Record<string, string> = {
  info: 'border-brand-200 bg-brand-50 text-brand-900', warning: 'border-amber-200 bg-amber-50 text-amber-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900', danger: 'border-rose-200 bg-rose-50 text-rose-900',
}
function Announcement() {
  const { user } = useAuth()
  const { settings } = useAppSettings()
  const a = settings.announcement
  const key = `dch:ann-dismissed:${a.text.length}:${a.text.slice(0, 24)}`
  const [gone, setGone] = useState(() => sessionStorage.getItem(key) === '1')
  if (!a.enabled || !a.text.trim() || gone || !user) return null
  if (a.audience === 'staff' && user.role === 'patient') return null
  if (a.audience === 'patients' && user.role !== 'patient') return null
  return (
    <div role="status" className={cn('mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', TONE[a.tone])}>
      <Megaphone className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1">{a.text}{a.link && <> <a href={a.link} className="font-semibold underline" target={a.link.startsWith('/') ? undefined : '_blank'} rel="noreferrer">Learn more</a></>}</p>
      <button onClick={() => { sessionStorage.setItem(key, '1'); setGone(true) }} aria-label="Dismiss announcement" className="rounded p-0.5 opacity-60 hover:opacity-100"><X className="h-4 w-4" /></button>
    </div>
  )
}

function ModuleOff() {
  return (
    <div className="card mx-auto mt-10 max-w-md p-8 text-center">
      <EyeOff className="mx-auto h-8 w-8 text-brand-400" />
      <h1 className="mt-3 font-display text-lg font-bold text-brand-950">This module is turned off</h1>
      <p className="mt-1 text-sm text-slate-500">The hospital administrator has hidden this section. Contact them if you need access.</p>
      <Link to="/" className="mt-4 inline-block text-sm font-semibold text-brand-700 hover:underline">Back to dashboard</Link>
    </div>
  )
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState(false)
  const [bell, setBell] = useState(false)
  const notices = useTable('notices')
  const visible = useMemo(() => (notices.data ?? []).filter((n) =>
    user?.role === 'owner' || n.audience === 'all' || (user?.role === 'patient' ? n.audience === 'patients' : n.audience === 'staff' || (user?.role === 'doctor' && n.audience === 'doctors')),
  ).sort((a, b) => b.published_on.localeCompare(a.published_on)).slice(0, 5), [notices.data, user])
  const canSearchPatients = user && user.role !== 'patient'
  const tr = usePortalT()

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-brand-100 bg-white/75 px-4 backdrop-blur-xl sm:px-6">
      <button onClick={onMenu} className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
      {canSearchPatients ? (
        <form className="relative hidden max-w-md flex-1 sm:block" onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/patients?q=${encodeURIComponent(q.trim())}`); setQ('') }}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patients by name, MRN or phone…" className="input border-transparent bg-brand-50 pl-9 shadow-none hover:border-brand-200 focus:bg-white" />
        </form>
      ) : <div className="flex-1" />}
      <div className="flex-1 sm:hidden" />
      <div className="ml-auto flex items-center gap-2">
        {user?.role === 'patient' && <LanguageSwitch />}
        {!isSupabaseConfigured && <Badge tone="amber" className="hidden md:inline-flex"><Database className="h-3 w-3" />Demo mode</Badge>}
        <div className="relative">
          <button onClick={() => setBell((b) => !b)} className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Notifications">
            <Bell className="h-5 w-5" />
            {visible.length > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />}
          </button>
          {bell && <>
            <div className="fixed inset-0 z-40" onClick={() => setBell(false)} />
            <div className="absolute right-0 z-50 mt-2 w-80 animate-pop-in rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><span className="text-sm font-semibold">{tr('Notices')}</span><Link to="/notices" onClick={() => setBell(false)} className="text-xs font-medium text-brand-700">{tr('View all')}</Link></div>
              <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {visible.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">{tr("You're all caught up")}</p>}
                {visible.map((n) => (
                  <div key={n.id} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {n.priority !== 'normal' && <span className={cn('h-1.5 w-1.5 rounded-full', n.priority === 'urgent' ? 'bg-rose-500' : 'bg-amber-500')} />}
                      <span className="text-sm font-medium text-slate-800">{n.title}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.body}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{ago(n.published_on)}</p>
                  </div>
                ))}
              </div>
            </div>
          </>}
        </div>
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-slate-100">
            <Avatar name={user?.full_name} src={user?.avatar_url} size="sm" />
            <div className="hidden text-left leading-tight md:block">
              <div className="text-xs font-semibold text-slate-800">{user?.full_name}</div>
              <div className="text-[11px] text-slate-500">{user && tr(ROLE_LABEL[user.role])}</div>
            </div>
            <ChevronDown className="hidden h-4 w-4 text-slate-400 md:block" />
          </button>
          {menu && <>
            <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
            <div className="absolute right-0 z-50 mt-2 w-56 animate-pop-in rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
              <div className="border-b border-slate-100 px-3 py-2.5"><div className="truncate text-sm font-medium">{user?.full_name}</div><div className="truncate text-xs text-slate-500">{user?.email}</div></div>
              <button onClick={() => { setMenu(false); navigate('/profile') }} className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"><CircleUserRound className="h-4 w-4" />{tr('My profile')}</button>
              <button onClick={() => { setMenu(false); navigate('/settings') }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"><Settings className="h-4 w-4" />{tr('Settings')}</button>
              <button onClick={async () => { setMenu(false); await signOut(); navigate('/login') }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"><LogOut className="h-4 w-4" />{tr('Sign out')}</button>
            </div>
          </>}
        </div>
      </div>
    </header>
  )
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const loc = useLocation()
  const { user } = useAuth()
  const { settings } = useAppSettings()
  const site = useSiteSettings()
  useDashboardChrome()
  useEffect(() => {
    const item = NAV.flatMap((s) => s.items).filter((i) => i.path === '/' ? loc.pathname === '/' : loc.pathname.startsWith(i.path)).sort((x, y) => y.path.length - x.path.length)[0]
    const brand = site.brand?.shortName || site.name
    document.title = item && user ? `${navLabel(item, user.role)} · ${brand}` : brand
  }, [site.name, site.brand?.shortName, loc.pathname, user])
  const off = user?.role !== 'owner' && settings.modules.hidden.some((p) => p !== '/' && (loc.pathname === p || loc.pathname.startsWith(`${p}/`)))
  useEffect(() => { setMobileOpen(false); window.scrollTo({ top: 0 }) }, [loc.pathname])
  return (
    <div className="app-canvas min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block"><Sidebar /></aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-brand-950/50 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-72 max-w-[85%] animate-slide-left shadow-2xl">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-5 grid h-8 w-8 place-items-center rounded-lg text-brand-300 hover:bg-white/10" aria-label="Close menu"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}
      <div className="lg:pl-64">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Announcement />
          {off ? <ModuleOff /> : <Outlet />}
        </main>
      </div>
    </div>
  )
}
