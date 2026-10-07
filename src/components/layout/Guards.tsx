import type { ReactNode } from 'react'
import { useNavLocked } from '../../tenancy/modules'
import { Navigate, useLocation } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { canSee } from './nav'
import { EmptyState, Spinner } from '../ui'

export function FullScreenLoader() {
  return (
    <div className="grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-3"><Spinner className="h-7 w-7" /><p className="text-sm text-slate-500">Loading DC Hospital…</p></div>
    </div>
  )
}

export function RequireAuth({ children, guestHome, guestFallback }: {
  children: ReactNode
  /** Rendered for signed-out visitors on "/" (the public website home). */
  guestHome?: ReactNode
  /** Optional renderer for signed-out visitors on other paths; return null to fall through to the login redirect. */
  guestFallback?: (pathname: string) => ReactNode
}) {
  const { user, loading, signedOut } = useAuth()
  const loc = useLocation()
  if (loading) return <FullScreenLoader />
  if (!user && guestHome && loc.pathname === '/') return <>{guestHome}</>
  // signed out on purpose → back to the public website home
  if (!user && signedOut) return <Navigate to="/" replace />
  if (!user && guestFallback) { const node = guestFallback(loc.pathname); if (node) return <>{node}</> }
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  return <>{children}</>
}

export function RequireNav({ path, children }: { path: string; children: ReactNode }) {
  const { user } = useAuth()
  const navLocked = useNavLocked()
  if (!user || !canSee(path, user.role) || navLocked(path)) return <Forbidden />
  return <>{children}</>
}

export function Forbidden() {
  return <EmptyState className="py-24" icon={<ShieldOff className="h-6 w-6" />} title="You don't have access to this page" description="Your role doesn't include this module. Contact the hospital administrator if you think this is a mistake." />
}
