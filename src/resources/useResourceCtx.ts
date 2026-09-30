import { flushNotificationsSoon } from '../settings/store'
import { useCallback, useMemo } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { db } from '../data/adapter'
import { useAuth } from '../auth/AuthProvider'
import { can } from '../auth/permissions'
import { isAudited } from '../lib/audit'
import { qk } from '../hooks/useData'
import { useMe } from '../hooks/useScope'
import { TABLES, type TableName } from '../types'
import type { Lookups, ResourceCtx } from './types'
import { useSiteSettings } from '../site/cms/content'

/** Builds the context object shared by resource columns, forms and actions. */
export function useResourceCtx(relations: TableName[] = []): { ctx: ResourceCtx | null; loading: boolean } {
  const { user } = useAuth()
  const me = useMe()
  const navigate = useNavigate()
  const site = useSiteSettings()
  const qc = useQueryClient()
  const tables = relations.filter((t) => can(user?.role, t, 'read'))

  const results = useQueries({
    queries: tables.map((t) => ({ queryKey: qk(t), queryFn: () => db.list(t), staleTime: 30_000, enabled: !!user })),
  })

  const dataKey = results.map((r) => r.dataUpdatedAt).join('|')
  const lk = useMemo(() => {
    const out = Object.fromEntries(TABLES.map((t) => [t, new Map()])) as unknown as Lookups
    tables.forEach((t, i) => {
      const m = out[t] as Map<string, { id: string }>
      ;(results[i]?.data as { id: string }[] | undefined)?.forEach((r) => m.set(r.id, r))
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, tables.join(',')])

  const patch = useCallback<ResourceCtx['patch']>(async (table, id, p) => {
    try { await db.update(table, id, p) } catch (e) { toast.error((e as Error).message) }
    qc.invalidateQueries({ queryKey: qk(table) }); if (isAudited(table)) qc.invalidateQueries({ queryKey: qk('audit_log') })
    if (['appointments', 'invoices', 'payments', 'lab_tests'].includes(table)) flushNotificationsSoon(1200, [id])
  }, [qc])
  const insert = useCallback<ResourceCtx['insert']>(async (table, row) => {
    let saved: { id?: string; invoice_id?: string } | undefined
    try { saved = await db.insert(table, row as never) as never } catch (e) { toast.error((e as Error).message) }
    qc.invalidateQueries({ queryKey: qk(table) }); if (isAudited(table)) qc.invalidateQueries({ queryKey: qk('audit_log') })
    if (['appointments', 'invoices', 'payments', 'lab_tests'].includes(table)) flushNotificationsSoon(1200, [saved?.id, saved?.invoice_id])
  }, [qc])

  const ctx = useMemo<ResourceCtx | null>(() => (user ? {
    role: user.role, user, me: { patient: me.patient, doctor: me.doctor }, lk, navigate, site, patch, insert,
  } : null), [user, me.patient, me.doctor, lk, navigate, site, patch, insert])

  return { ctx, loading: results.some((r) => r.isLoading) || me.loading }
}
