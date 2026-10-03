import { useState, type ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Building2, ClipboardList, CreditCard, ExternalLink, Gauge, Inbox, LogOut, Menu, Settings, ShieldAlert, ShieldCheck, UserPlus, Users, X } from 'lucide-react'
import { Avatar, Badge, Spinner } from '../../src/components/ui'
import { cn } from '../../src/lib/utils'
import { ErrorBoundary } from '../../src/components/ErrorBoundary'
import { platformName } from '../../src/lib/supabase'
import { cp } from './api'
import { MeContext, ROLE_LABEL, ROLE_TONE, useMe } from './ui'
import type { ProviderRole } from './types'
import { LoginPage } from './pages/LoginPage'
import { OverviewPage } from './pages/OverviewPage'
import { HospitalsPage } from './pages/HospitalsPage'
import { HospitalPage } from './pages/HospitalPage'
import { TeamPage } from './pages/TeamPage'
import { LeadsPage } from './pages/LeadsPage'
import { SignupsPage } from './pages/SignupsPage'
import { PaymentsPage } from './pages/PaymentsPage'
import { AuditPage } from './pages/AuditPage'
import { SettingsPage } from './pages/SettingsPage'
import { HealthPage } from './pages/HealthPage'
import { IncidentsPage } from './pages/IncidentsPage'

const NAV: { to: string; label: string; icon: ReactNode; roles: ProviderRole[] }[] = [
  { to: '/', label: 'Overview', icon: <Gauge className="h-4 w-4" />, roles: ['admin', 'support', 'finance'] },
  { to: '/hospitals', label: 'Hospitals', icon: <Building2 className="h-4 w-4" />, roles: ['admin', 'support', 'finance'] },
  { to: '/payments', label: 'Payments', icon: <CreditCard className="h-4 w-4" />, roles: ['admin', 'finance'] },
  { to: '/signups', label: 'Sign-ups', icon: <UserPlus className="h-4 w-4" />, roles: ['admin'] },
  { to: '/leads', label: 'Leads', icon: <Inbox className="h-4 w-4" />, roles: ['admin'] },
  { to: '/health', label: 'System health', icon: <Activity className="h-4 w-4" />, roles: ['admin', 'support'] },
  { to: '/incidents', label: 'Incidents', icon: <ShieldAlert className="h-4 w-4" />, roles: ['admin', 'support'] },
  { to: '/team', label: 'Team', icon: <Users className="h-4 w-4" />, roles: ['admin'] },
  { to: '/audit', label: 'Audit log', icon: <ClipboardList className="h-4 w-4" />, roles: ['admin'] },
  { to: '/settings', label: 'Platform settings', icon: <Settings className="h-4 w-4" />, roles: ['admin'] },
]

export function App() {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['cp-me'], queryFn: () => cp.me(), staleTime: Infinity })
  if (me.isLoading) return <div className="grid min-h-screen place-items-center"><Spinner className="h-6 w-6 text-brand-700" /></div>
  if (!me.data) return <LoginPage onSignedIn={(m) => qc.setQueryData(['cp-me'], m)} error={me.error} />
  const signOut = async () => {
    await cp.signOut()
    qc.setQueryData(['cp-me'], null)
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'cp-me' })   // the next person must not see this one's data
  }
  return (
    <MeContext.Provider value={{ me: me.data, signOut }}>
      <Shell>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/hospitals" element={<HospitalsPage />} />
          <Route path="/hospitals/:id" element={<HospitalPage />} />
          <Route path="/payments" element={<Only roles={['admin', 'finance']}><PaymentsPage /></Only>} />
          <Route path="/signups" element={<Only roles={['admin']}><SignupsPage /></Only>} />
          <Route path="/leads" element={<Only roles={['admin']}><LeadsPage /></Only>} />
          <Route path="/health" element={<Only roles={['admin', 'support']}><HealthPage /></Only>} />
          <Route path="/incidents" element={<Only roles={['admin', 'support']}><IncidentsPage /></Only>} />
          <Route path="/team" element={<Only roles={['admin']}><TeamPage /></Only>} />
          <Route path="/audit" element={<Only roles={['admin']}><AuditPage /></Only>} />
          <Route path="/settings" element={<Only roles={['admin']}><SettingsPage /></Only>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </MeContext.Provider>
  )
}

function Only({ roles, children }: { roles: ProviderRole[]; children: ReactNode }) {
  const { me } = useMe()
  return roles.includes(me.role) ? <>{children}</> : <Navigate to="/" replace />
}

function Shell({ children }: { children: ReactNode }) {
  const { me, signOut } = useMe()
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-900 text-white shadow-glow"><ShieldCheck className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="truncate font-display text-[15px] font-bold leading-tight text-white">{platformName}</p>
          <p className="text-[11px] uppercase tracking-wider text-brand-300">Control panel</p>
        </div>
      </div>
      <div className="flex-1 space-y-0.5 px-3">
        {NAV.filter((n) => n.roles.includes(me.role)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setOpen(false)}
            className={({ isActive }) => cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
              isActive || (n.to === '/hospitals' && loc.pathname.startsWith('/hospitals')) ? 'bg-white/15 text-white' : 'text-brand-200 hover:bg-white/10 hover:text-white')}>
            {n.icon}{n.label}
          </NavLink>
        ))}
      </div>
      <div className="space-y-3 border-t border-white/10 p-4">
        <a href="/" className="flex items-center gap-2 text-xs text-brand-300 hover:text-white"><ExternalLink className="h-3.5 w-3.5" /> Product website</a>
        <div className="flex items-center gap-3">
          <Avatar name={me.full_name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{me.full_name}</p>
            <p className="truncate text-[11px] text-brand-300">{me.email}</p>
          </div>
          <button type="button" onClick={signOut} title="Sign out" aria-label="Sign out" className="rounded-lg p-2 text-brand-300 hover:bg-white/10 hover:text-white"><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </nav>
  )
  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-brand-950 lg:block">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-brand-950/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 animate-slide-left bg-brand-950">
            <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="absolute right-3 top-5 rounded-lg p-1.5 text-brand-200 hover:bg-white/10"><X className="h-5 w-5" /></button>
            {nav}
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[#e6e6f5] bg-white/85 px-4 backdrop-blur sm:px-6">
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-lg p-2 text-slate-600 hover:bg-brand-50 lg:hidden"><Menu className="h-5 w-5" /></button>
        <p className="font-display text-sm font-semibold text-brand-950 lg:hidden">{platformName}</p>
        <div className="ml-auto flex items-center gap-2">
          <Badge tone={ROLE_TONE[me.role]}>{ROLE_LABEL[me.role]}</Badge>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        {/* a crash in one page shows a friendly card; the sidebar keeps working and the next page resets it */}
        <ErrorBoundary resetKey={loc.pathname}>{children}</ErrorBoundary>
      </main>
    </div>
  )
}
