/**
 * Live plans from the database (platform_plans(): the Control Panel's Plans & billing page). Loaded once per page
 * view and shared by every component; until it arrives (or if it can't) the built-in list in plans.ts is used.
 *   usePlans()      → every plan the caller may see, sorted (visitors: offered ones + their own hospital's plan)
 *   planLabel(id)   → "Hospital" for 'hospital' (works outside React too, e.g. in invoice PDFs)
 */
import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import { PLANS, planList, normalisePlan, offered, type Plan } from './plans'

export interface PlanCatalog {
  plans: Plan[]
  gstPercent: number
  yearlyMonths: number
  trialDays: number
  /** false while still showing the built-in fallback */
  live: boolean
}

let state: PlanCatalog = { plans: planList(null), gstPercent: 18, yearlyMonths: 10, trialDays: 14, live: false }
let loading: Promise<PlanCatalog> | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

/** put a fresh catalogue in place (also used by the Control Panel right after saving) */
export function setPlanCatalog(next: Partial<PlanCatalog> & { plans: Plan[] }) {
  state = { ...state, ...next, live: true }
  emit()
}

interface Raw { plans?: (Partial<Plan> & { id: string })[]; gstPercent?: number; yearlyMonths?: number; trialDays?: number }

/** platform_plans() → catalogue (exported for tests) */
export function parseCatalog(raw: Raw | null | undefined): PlanCatalog {
  const list = Array.isArray(raw?.plans) && raw!.plans.length
    ? raw!.plans.filter((p) => p && typeof p.id === 'string').map((p, i) => normalisePlan(p.id, p, 50 + i)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
    : planList(null)
  return { plans: list, gstPercent: Number(raw?.gstPercent ?? 18), yearlyMonths: Number(raw?.yearlyMonths ?? 10), trialDays: Number(raw?.trialDays ?? 14), live: !!raw?.plans }
}

export function loadPlans(force = false): Promise<PlanCatalog> {
  if (loading && !force) return loading
  loading = (async () => {
    if (!supabase) return state
    try {
      const { data, error } = await supabase.rpc('platform_plans')
      if (error) throw error
      state = parseCatalog(data as Raw)
      emit()
    } catch (e) {
      console.warn('[plans] using the built-in plans:', e instanceof Error ? e.message : e)
      loading = null   // try again next time something asks
    }
    return state
  })()
  return loading
}

export function usePlanCatalog(): PlanCatalog {
  const s = useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb) }, () => state, () => state)
  useEffect(() => { void loadPlans() }, [])
  return s
}

/** every plan the caller may see (sorted) and the ones visitors can pick */
export function usePlans() {
  const c = usePlanCatalog()
  return { plans: c.plans, offered: offered(c.plans), live: c.live, catalog: c }
}

export function planLabel(id: string | null | undefined): string {
  if (!id) return '—'
  return state.plans.find((p) => p.id === id)?.name ?? PLANS.find((p) => p.id === id)?.name ?? id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export const findPlan = (id: string | null | undefined, plans: Plan[] = state.plans) => (id ? plans.find((p) => p.id === id) : undefined)
