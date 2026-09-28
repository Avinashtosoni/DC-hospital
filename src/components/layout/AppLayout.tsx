import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Bell, ChevronDown, Cross, Database, LogOut, Menu, Search, Settings, X } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { NAV, navLabel } from './nav'
import { Avatar, Badge } from '../ui'
import { ROLE_LABEL } from '../../types'
import { cn, HOSPITAL, ago } from '../../lib/utils'
import { isSupabaseConfigured } from '../../lib/supabase'
import { useTable } from '../../hooks/useData'

export function Logo({ light }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#ccccff] via-[#a3a3cc] to-[#5c5c99] text-white shadow-lg shadow-brand-950/40 ring-1 ring-white/30">
        <Cross className="h-5 w-5" strokeWidth={2.75} />
      </div>
      <div className="leading-tight">
        <div className={cn('text-[15px] font-bold tracking-tight', light ? 'text-white' : 'text-slate-900')}>{HOSPITAL.name}</div>
        <div className={cn('text-[10px] font-medium uppercase tracking-[.14em]', light ? 'text-brand-300/80' : 'text-slate-400')}>Management System</div>
      </div>
    </div>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth()
  if (!user) return null
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-b from-[#292966] via-[#23235a] to-[#1b1b47] text-brand-200">
      <div aria-hidden="true" className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-[#5c5c99]/40 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -right-24 h-64 w-64 rounded-full bg-[#a3a3cc]/15 blur-3xl" />
      <div className="relative px-5 py-5"><Logo light /></div>
      <nav className="scrollbar-dark relative flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {NAV.map((section) => {
          const items = section.items.filter((i) => i.roles.includes(user.role))
          if (!items.length) return null
          return (
            <div key={section.title}>
              <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[.16em] text-brand-400/80">{section.title}</div>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavLink key={item.path} to={item.path} end={item.path === '/'} onClick={onNavigate}
                    className={({ isActive }) => cn('group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition duration-200',
                      isActive ? 'bg-gradient-to-r from-white/[.16] to-white/[.04] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.08)] ring-1 ring-inset ring-[#ccccff]/20' : 'text-brand-200/75 hover:bg-white/[.06] hover:text-white')}>
                    {({ isActive }) => <>
                      {isActive && <span aria-hidden="true" className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[#ccccff] shadow-[0_0_12px_rgba(204,204,255,.8)]" />}
                      <item.icon className={cn('h-[18px] w-[18px] transition', isActive ? 'text-[#ccccff]' : 'text-brand-400 group-hover:text-brand-200')} />
                      {navLabel(item, user.role)}
                    </>}
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })}
      </nav>
      <div className="relative border-t border-white/[.07] p-3">
        <div className="flex items-center gap-3 rounded-xl bg-white/[.07] p-2.5 ring-1 ring-inset ring-white/[.06]">
          <Avatar name={user.full_name} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-white">{user.full_name}</div>
            <div className="truncate text-[11px] text-brand-300">{ROLE_LABEL[user.role]}</div>
          </div>
        </div>
      </div>
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

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[#e6e6f5] bg-white/75 px-4 backdrop-blur-xl sm:px-6">
      <button onClick={onMenu} className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
      {canSearchPatients ? (
        <form className="relative hidden max-w-md flex-1 sm:block" onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/patients?q=${encodeURIComponent(q.trim())}`); setQ('') }}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patients by name, MRN or phone…" className="input border-transparent bg-brand-50 pl-9 shadow-none hover:border-brand-200 focus:bg-white" />
        </form>
      ) : <div className="flex-1" />}
      <div className="flex-1 sm:hidden" />
      <div className="ml-auto flex items-center gap-2">
        {!isSupabaseConfigured && <Badge tone="amber" className="hidden md:inline-flex"><Database className="h-3 w-3" />Demo mode</Badge>}
        <div className="relative">
          <button onClick={() => setBell((b) => !b)} className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Notifications">
            <Bell className="h-5 w-5" />
            {visible.length > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />}
          </button>
          {bell && <>
            <div className="fixed inset-0 z-40" onClick={() => setBell(false)} />
            <div className="absolute right-0 z-50 mt-2 w-80 animate-pop-in rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><span className="text-sm font-semibold">Notices</span><Link to="/notices" onClick={() => setBell(false)} className="text-xs font-medium text-brand-700">View all</Link></div>
              <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {visible.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">You're all caught up</p>}
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
            <Avatar name={user?.full_name} size="sm" />
            <div className="hidden text-left leading-tight md:block">
              <div className="text-xs font-semibold text-slate-800">{user?.full_name}</div>
              <div className="text-[11px] text-slate-500">{user && ROLE_LABEL[user.role]}</div>
            </div>
            <ChevronDown className="hidden h-4 w-4 text-slate-400 md:block" />
          </button>
          {menu && <>
            <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
            <div className="absolute right-0 z-50 mt-2 w-56 animate-pop-in rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
              <div className="border-b border-slate-100 px-3 py-2.5"><div className="truncate text-sm font-medium">{user?.full_name}</div><div className="truncate text-xs text-slate-500">{user?.email}</div></div>
              <button onClick={() => { setMenu(false); navigate('/settings') }} className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"><Settings className="h-4 w-4" />Settings</button>
              <button onClick={async () => { setMenu(false); await signOut(); navigate('/login') }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"><LogOut className="h-4 w-4" />Sign out</button>
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
          <Outlet />
        </main>
      </div>
    </div>
  )
}
