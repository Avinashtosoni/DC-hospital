import { Building2, PauseCircle, WifiOff } from 'lucide-react'
import { platformName } from '../lib/supabase'
import type { BootResult } from './boot'

/** Full-page messages shown instead of the app when the domain doesn't lead to an open hospital. */
export function TenantScreen({ result }: { result: Extract<BootResult, { ok: false }> }) {
  const host = typeof location === 'undefined' ? '' : location.hostname
  const view = {
    not_found: {
      icon: Building2,
      title: 'No hospital at this address',
      text: <>We couldn&apos;t find a hospital for <b className="font-semibold text-brand-900">{host}</b>. Check the address, or ask the hospital for its correct website link.</>,
    },
    suspended: {
      icon: PauseCircle,
      title: `${result.tenant?.name ?? 'This hospital'} is temporarily unavailable`,
      text: <>Online services for this hospital are paused. Please call the hospital directly for appointments and reports.</>,
    },
    error: {
      icon: WifiOff,
      title: 'We could not connect',
      text: <>The service is not reachable right now. Please check your internet connection and try again.</>,
    },
  }[result.reason]
  const Icon = view.icon
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-50 via-white to-brand-100 p-6">
      <div className="w-full max-w-md rounded-2xl border border-brand-100 bg-white p-7 text-center shadow-lift">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-100 text-brand-700"><Icon className="h-7 w-7" /></div>
        <h1 className="mt-4 text-lg font-semibold text-brand-950">{view.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{view.text}</p>
        {result.reason === 'error' && (
          <button onClick={() => location.reload()} className="btn-peri mt-5">Try again</button>
        )}
        <p className="mt-6 text-[11px] uppercase tracking-[.16em] text-brand-400">{platformName}</p>
      </div>
    </div>
  )
}
