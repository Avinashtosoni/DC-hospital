import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, ShieldCheck } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { platformName } from '../lib/supabase'
import { loadProviderTenants, providerLog } from './session'
import { activeTenantId, chooseProviderMode, chooseProviderTenant, PROVIDER_ROLE_LABEL, type ProviderRole } from './state'

const MODE_HINT: Record<ProviderRole, string> = {
  admin: 'full access, like the hospital owner',
  support: 'owner access, patient records read-only',
  finance: 'accountant access',
}

/**
 * Hospital Comrade team only: which hospital they are looking at, a switcher and (admins) the mode.
 * Switching reloads the app so every screen, cache and setting belongs to the new hospital.
 */
export function ProviderBanner() {
  const { context } = useAuth()
  const [busy, setBusy] = useState(false)
  const role = context?.provider_role
  const tenants = useQuery({ queryKey: ['provider_tenants'], queryFn: loadProviderTenants, enabled: !!role, staleTime: 60_000 })
  if (!role || !context) return null
  const mode = context.provider_mode ?? role
  const current = context.tenant

  const go = async (apply: () => void, action: string, target?: string) => {
    setBusy(true)
    await providerLog(action, target)
    apply()
    location.assign('/')
  }

  return (
    <div role="region" aria-label={`${platformName} provider access`}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-brand-950 px-4 py-2 text-xs text-brand-100 sm:px-6">
      <span className="inline-flex items-center gap-1.5 font-semibold text-white">
        <ShieldCheck className="h-4 w-4 text-brand-300" />{platformName} · {PROVIDER_ROLE_LABEL[role]}
      </span>
      <label className="inline-flex items-center gap-1.5">
        <Building2 className="h-3.5 w-3.5 text-brand-300" /><span className="sr-only">Hospital</span>
        <select value={current?.id ?? activeTenantId() ?? ''} disabled={busy || tenants.isLoading}
          onChange={(e) => { const id = e.target.value; void go(() => chooseProviderTenant(id), 'switch_hospital', id) }}
          className="max-w-[240px] rounded-md border border-brand-700 bg-brand-900 px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-brand-400">
          {!tenants.data?.length && current && <option value={current.id}>{current.name}</option>}
          {tenants.data?.map((t) => <option key={t.id} value={t.id}>{t.name}{t.status !== 'active' ? ` (${t.status.replace('_', ' ')})` : ''}</option>)}
        </select>
      </label>
      {role === 'admin' ? (
        <label className="inline-flex items-center gap-1.5">
          <span className="text-brand-300">Mode</span>
          <select value={mode} disabled={busy}
            onChange={(e) => { const m = e.target.value as ProviderRole; void go(() => chooseProviderMode(m), 'switch_mode', m) }}
            className="rounded-md border border-brand-700 bg-brand-900 px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-brand-400">
            {(['admin', 'support', 'finance'] as const).map((m) => <option key={m} value={m}>{PROVIDER_ROLE_LABEL[m]}</option>)}
          </select>
        </label>
      ) : null}
      <span className="hidden text-brand-300 md:inline">{MODE_HINT[mode]} · every action is logged</span>
    </div>
  )
}
