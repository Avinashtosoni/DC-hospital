import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AlertTriangle, Clock, Lock, X } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { cn } from '../lib/utils'
import { tenancyEnabled } from '../tenancy/state'
import { licenseBanner } from './license'

const TONE = {
  info: 'border-brand-200 bg-brand-50 text-brand-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-rose-200 bg-rose-50 text-rose-900',
}

/** who may renew: the hospital's owner and the Hospital Comrade team (admin / finance) */
export function useCanPay() {
  const { user, context } = useAuth()
  const pr = context?.provider_role
  return pr ? pr === 'admin' || pr === 'finance' : user?.role === 'owner'
}

/**
 * Trial days left, renewal due, grace period, read-only — at the top of every dashboard page for the hospital's
 * staff (not patients). Trial / renewal notes can be dismissed for the session; grace and read-only stay.
 */
export function LicenseBanner() {
  const { user, context } = useAuth()
  const canPay = useCanPay()
  const loc = useLocation()
  const b = licenseBanner(context?.license, canPay)
  const key = `dch:license-dismissed:${context?.license?.status}:${b?.title ?? ''}`
  const [gone, setGone] = useState(() => sessionStorage.getItem(key) === '1')
  if (!tenancyEnabled() || !b || !user || user.role === 'patient') return null
  const dismissible = b.tone !== 'danger' && context?.license?.status !== 'grace'
  if (dismissible && gone) return null
  const onPlanTab = loc.pathname === '/settings' && new URLSearchParams(loc.search).get('tab') === 'plan'
  const Icon = b.tone === 'danger' ? Lock : b.tone === 'warning' ? AlertTriangle : Clock
  return (
    <div role="status" className={cn('mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3 text-sm', TONE[b.tone])}>
      <Icon className="h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1"><b className="font-semibold">{b.title}.</b> {b.text}</p>
      {b.cta && !onPlanTab && (
        <Link to="/billing" className={cn('shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition',
          b.tone === 'danger' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-brand-900 hover:bg-brand-800')}>
          {context?.license?.status === 'trial' ? 'Choose a plan' : 'Renew now'}
        </Link>
      )}
      {dismissible && (
        <button onClick={() => { sessionStorage.setItem(key, '1'); setGone(true) }} aria-label="Dismiss" className="rounded p-0.5 opacity-60 hover:opacity-100"><X className="h-4 w-4" /></button>
      )}
    </div>
  )
}
