import { flushNotificationsSoon } from '../settings/store'
import { useCallback, useMemo } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { db, queryAll } from '../data/adapter'
import { queryKey } from '../data/query'
import { useAuth } from '../auth/AuthProvider'
import { can } from '../auth/permissions'
import { isAudited } from '../lib/audit'
import { BIG_TABLES, qk } from '../hooks/useData'
import { useMe } from '../hooks/useScope'
import { TABLES, type TableName } from '../types'
import type { Lookups, RelationSpec, ResourceCtx } from './types'
import { useSiteSettings } from '../site/cms/content'

const specTable = (r: RelationSpec) => (typeof r === 'string' ? r : r.table)

/**
 * Builds the context object shared by resource columns, forms and actions.
 *
 * `relations` fills ctx.lk: small tables are loaded whole, `{ table, where }` loads a bounded window, and big
 * tables named plainly are NOT downloaded — pass the rows a screen needs through `extra` (see useByIds).
 */
export function useResourceCtx(relations: RelationSpec[] = [], extra: Partial<Record<TableName, Map<string, unknown> | unknown[]>> = {}): { ctx: ResourceCtx | null; loading: boolean } {
  const { user } = useAuth()
  const me = useMe()
  const navigate = useNavigate()
  const site = useSiteSettings()
  const qc = useQueryClient()
  const specs = relations.filter((r) => can(user?.role, specTable(r), 'read') && (typeof r !== 'string' || !BIG_TABLES.has(r)))

  const results = useQueries({
    queries: specs.map((r) => typeof r === 'string'
      ? { queryKey: qk(r), queryFn: () => db.list(r) as Promise<unknown[]>, staleTime: 30_000, enabled: !!user }
      : { queryKey: [...qk(r.table), 'w', queryKey({ where: r.where })], queryFn: () => queryAll(r.table, { where: r.where }) as Promise<unknown[]>, staleTime: 30_000, enabled: !!user }),
  })

  const dataKey = results.map((r) => r.dataUpdatedAt).join('|')
  const extraKey = Object.values(extra).map((v) => v)
  const lk = useMemo(() => {
    const out = Object.fromEntries(TABLES.map((t) => [t, new Map()])) as unknown as Lookups
    specs.forEach((r, i) => {
      const m = out[specTable(r)] as Map<string, { id: string }>
      ;(results[i]?.data as { id: string }[] | undefined)?.forEach((row) => m.set(row.id, row))
    })
    for (const [t, rows] of Object.entries(extra)) {
      const m = out[t as TableName] as Map<string, unknown>
      if (rows instanceof Map) rows.forEach((v, k) => m.set(k, v))
      else (rows as { id: string }[] | undefined)?.forEach((row) => m.set(row.id, row))
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, JSON.stringify(specs), ...extraKey])

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

  const refresh = useCallback<ResourceCtx['refresh']>((table) => {
    qc.invalidateQueries({ queryKey: qk(table) }); if (isAudited(table)) qc.invalidateQueries({ queryKey: qk('audit_log') })
  }, [qc])

  const ctx = useMemo<ResourceCtx | null>(() => (user ? {
    role: user.role, user, me: { patient: me.patient, doctor: me.doctor }, lk, navigate, site, patch, insert, refresh,
  } : null), [user, me.patient, me.doctor, lk, navigate, site, patch, insert, refresh])

  return { ctx, loading: results.some((r) => r.isLoading) || me.loading }
}
