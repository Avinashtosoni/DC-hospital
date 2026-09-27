import type { ReactNode } from 'react'
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

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <FullScreenLoader />
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  return <>{children}</>
}

export function RequireNav({ path, children }: { path: string; children: ReactNode }) {
  const { user } = useAuth()
  if (!user || !canSee(path, user.role)) return <Forbidden />
  return <>{children}</>
}

export function Forbidden() {
  return <EmptyState className="py-24" icon={<ShieldOff className="h-6 w-6" />} title="You don't have access to this page" description="Your role doesn't include this module. Contact the hospital administrator if you think this is a mistake." />
}
