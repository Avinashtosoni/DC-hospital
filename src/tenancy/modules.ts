import { useCallback } from 'react'
import { useAuth } from '../auth/AuthProvider'
import type { MyContext } from './state'

/**
 * Settings modules a hospital can be locked out of (multi-hospital mode). A locked module is managed by the
 * Hospital Comrade team and HIDDEN from the hospital (tabs, menu items, routes); the database refuses writes too
 * (scripts/sql/tenancy.sql → module locks). Owners always keep users, billing & booking, enquiries and their account.
 */
export const LOCKABLE_MODULES = ['general', 'appearance', 'dashboard', 'notifications', 'forms', 'security', 'data', 'cms'] as const
export type ModuleKey = (typeof LOCKABLE_MODULES)[number]

export const MODULE_LABEL: Record<ModuleKey, string> = {
  general: 'General & brand', appearance: 'Appearance', dashboard: 'Dashboard widgets', notifications: 'Notifications & APIs',
  forms: 'Website forms', security: 'Security & access', data: 'Data & backup', cms: 'Website CMS',
}

/** app pages that belong to a module */
export const NAV_MODULE: Record<string, ModuleKey> = { '/cms': 'cms' }

/** same rule as public.module_locked(): providers are never locked; an unlisted module is provider-managed */
export function moduleLocked(ctx: MyContext | null, m: ModuleKey): boolean {
  if (!ctx || ctx.provider_role) return false          // single-hospital install / demo mode / platform team
  return (ctx.tenant?.modules?.[m] ?? 'provider') !== 'hospital'
}

export function useModuleLocks() {
  const { context } = useAuth()
  return useCallback((m: ModuleKey | undefined) => (m ? moduleLocked(context, m) : false), [context])
}

/** is this app path hidden because its module is locked? */
export function useNavLocked() {
  const locked = useModuleLocks()
  return useCallback((path: string) => locked(NAV_MODULE[path]), [locked])
}
