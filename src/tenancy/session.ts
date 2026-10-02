import { supabase } from '../lib/supabase'
import { localMyContext, localProviderTenants } from '../data/localAdapter'
import type { Profile, Role } from '../types'
import { activeTenantId, chooseProviderTenant, contextProblem, siteTenant, tenancyEnabled, type MyContext, type TenantInfo } from './state'

export interface ProviderTenant extends TenantInfo { domain: string | null }

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('No database')
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

// demo mode answers from the browser store (src/tenancy/demo.ts)
export const loadContext = async () => (supabase ? rpc<MyContext>('my_context') : localMyContext())
export const loadProviderTenants = async () => (supabase ? rpc<ProviderTenant[]>('provider_tenants') : localProviderTenants() as ProviderTenant[])
export const providerLog = async (action: string, target?: string, detail?: Record<string, unknown>) => {
  if (!supabase) return
  await rpc<void>('provider_log', { p_action: action, p_target: target ?? null, p_detail: detail ?? null }).catch(() => undefined)
}

export class TenantAccessError extends Error {}

/**
 * After sign-in (multi mode): work out the hospital and the role this person has here.
 * - hospital accounts must be on their own hospital's website (one account = one hospital)
 * - providers land in the website's hospital if they may open it, otherwise in the first one they may
 * Throws TenantAccessError when the account can't be used here (the caller signs out).
 */
export async function resolveSession(p: Profile): Promise<{ user: Profile; context: MyContext | null }> {
  if (!tenancyEnabled()) return { user: p, context: null }
  let ctx = await loadContext()
  const problem = contextProblem(ctx, siteTenant())
  if (problem) throw new TenantAccessError(problem)
  if (ctx.provider_role && !ctx.tenant) {
    const list = await loadProviderTenants()
    const pick = list.find((t) => t.id === activeTenantId()) ?? list[0]
    if (!pick) throw new TenantAccessError('No hospitals are assigned to you yet. Ask a Hospital Comrade admin.')
    chooseProviderTenant(pick.id)
    ctx = await loadContext()
  }
  return { user: { ...p, role: (ctx.role ?? p.role) as Role }, context: ctx }
}
