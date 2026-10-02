import { useMemo } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { db, queryAll, type NewRow, type Row } from '../data/adapter'
import type { TableName } from '../types'
import { queryKey, type Filter, type Query, type QueryResult } from '../data/query'
import { useAuth } from '../auth/AuthProvider'
import { can } from '../auth/permissions'
import { isAudited } from '../lib/audit'
import { flushNotificationsSoon } from '../settings/store'

/** Tables whose changes can queue SMS / WhatsApp / email (see scripts/sql/settings.sql). */
const NOTIFY_TABLES = new Set<string>(['appointments', 'invoices', 'payments', 'lab_tests'])
/** records whose notifications should be delivered right away (the row + its invoice, if any) */
const notifyIds = (row: unknown) => { const r = row as { id?: string; invoice_id?: string } | null; return [r?.id, r?.invoice_id] }

export const qk = (table: TableName) => ['table', table] as const
/** Money totals computed in the database (dashboard_finance, financial_report) — refreshed after any money write. */
export const FINANCE_KEY = ['finance'] as const
const FINANCE_TABLES = new Set<TableName>(['invoices', 'payments', 'expenses'])

function afterWrite(qc: QueryClient, table: TableName) {
  qc.invalidateQueries({ queryKey: qk(table) })
  if (isAudited(table)) qc.invalidateQueries({ queryKey: qk('audit_log') })
  if (FINANCE_TABLES.has(table)) qc.invalidateQueries({ queryKey: FINANCE_KEY })
}

/**
 * Tables that grow with every visit / bill. They are never downloaded whole: screens read a page, a date window
 * or the rows for specific ids (`useRows`, `useCount`, `useByIds`, `useRow`). Everything else (doctors, beds,
 * departments, settings…) is small and loaded fully with `useTable`.
 */
export const BIG_TABLES = new Set<TableName>(['patients', 'appointments', 'invoices', 'payments', 'prescriptions', 'lab_tests',
  'admissions', 'expenses', 'audit_log', 'visit_feedback'])

function useAllowed(table: TableName) {
  const { user } = useAuth()
  return { user, allowed: !!user && (can(user.role, table, 'read') || table === 'profiles') }
}

/** Fetches a whole table (cached). Returns [] when the current role has no read access. Use only for small tables. */
export function useTable<T extends TableName>(table: T, opts: { enabled?: boolean } = {}) {
  const { allowed } = useAllowed(table)
  if (import.meta.env.DEV && BIG_TABLES.has(table) && opts.enabled !== false) console.warn(`[dc-hospital] useTable('${table}') loads the whole table — use useRows / useByIds`)
  return useQuery({
    queryKey: qk(table),
    queryFn: () => db.list(table),
    enabled: allowed && (opts.enabled ?? true),
    staleTime: 30_000,
  })
}

/** One page / window of a table. Keeps the previous page on screen while the next one loads. */
export function useRows<T extends TableName>(table: T, q: Query, opts: { enabled?: boolean; keepPrevious?: boolean } = {}) {
  const { allowed } = useAllowed(table)
  return useQuery<QueryResult<Row<T>>>({
    queryKey: [...qk(table), 'q', queryKey(q)],
    queryFn: () => db.query(table, q),
    enabled: allowed && (opts.enabled ?? true),
    staleTime: 30_000,
    placeholderData: opts.keepPrevious ? keepPreviousData : undefined,
  })
}

/** Every row of a bounded window (e.g. this month's payments, today's appointments, one patient's records). */
export function useWindow<T extends TableName>(table: T, q: Query, opts: { enabled?: boolean } = {}) {
  const { allowed } = useAllowed(table)
  return useQuery<Row<T>[]>({
    queryKey: [...qk(table), 'w', queryKey(q)],
    queryFn: () => queryAll(table, q),
    enabled: allowed && (opts.enabled ?? true),
    staleTime: 30_000,
  })
}

/** Number of rows matching the filters (no rows are transferred). */
export function useCount(table: TableName, where: readonly Filter[] = [], opts: { enabled?: boolean } = {}) {
  const { allowed } = useAllowed(table)
  const q = useQuery({
    queryKey: [...qk(table), 'count', queryKey({ where })],
    queryFn: async () => (await db.query(table, { where, head: true })).count ?? 0,
    enabled: allowed && (opts.enabled ?? true),
    staleTime: 30_000,
  })
  return { count: q.data, isLoading: q.isLoading }
}

const CHUNK = 150
/** id -> row map for just the given ids (e.g. the patients shown on the current page). */
export function useByIds<T extends TableName>(table: T, ids: (string | null | undefined)[], opts: { enabled?: boolean } = {}) {
  const { allowed } = useAllowed(table)
  const list = useMemo(() => [...new Set(ids.filter((x): x is string => !!x && !x.startsWith('temp-')))].sort(), [ids])
  const q = useQuery({
    queryKey: [...qk(table), 'ids', list.join(',')],
    queryFn: async () => {
      const out: Row<T>[] = []
      for (let i = 0; i < list.length; i += CHUNK) out.push(...(await db.query(table, { where: [['id', 'in', list.slice(i, i + CHUNK)]] })).rows)
      return out
    },
    enabled: allowed && list.length > 0 && (opts.enabled ?? true),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
  const map = useMemo(() => { const m = new Map<string, Row<T>>(); q.data?.forEach((r) => m.set(r.id, r)); return m }, [q.data])
  return Object.assign(map, { isLoading: q.isLoading && list.length > 0 })
}

/** A single row by id (undefined while loading, null when missing / not visible to this role). */
export function useRow<T extends TableName>(table: T, id: string | undefined) {
  const { allowed } = useAllowed(table)
  return useQuery({
    queryKey: [...qk(table), 'row', id],
    queryFn: async () => (await db.query(table, { where: [['id', 'eq', id]] })).rows[0] ?? null,
    enabled: allowed && !!id,
    staleTime: 30_000,
  })
}

/** id -> row lookup map for a (small) table */
export function useLookup<T extends TableName>(table: T, opts: { enabled?: boolean } = {}) {
  const q = useTable(table, opts)
  return useMemo(() => { const map = new Map<string, Row<T>>(); q.data?.forEach((r) => map.set(r.id, r)); return map }, [q.data])
}

type Snapshot = [readonly unknown[], unknown][]
type Ctx = { prev: Snapshot }

/** apply an optimistic change to every cached read of this table — whole lists, pages and id lookups */
function patchCaches<T extends TableName>(qc: QueryClient, table: T, fn: (rows: Row<T>[], paged: boolean) => Row<T>[], countDelta = 0): Snapshot {
  const prev = qc.getQueriesData({ queryKey: qk(table) }) as Snapshot
  qc.setQueriesData({ queryKey: qk(table) }, (old: unknown) => {
    if (Array.isArray(old)) return fn(old as Row<T>[], false)
    if (old && typeof old === 'object' && Array.isArray((old as QueryResult<Row<T>>).rows)) {
      const o = old as QueryResult<Row<T>>
      const rows = fn(o.rows, true)
      return { rows, count: o.count == null ? null : Math.max(0, o.count + (rows.length - o.rows.length ? countDelta : 0)) }
    }
    return old
  })
  return prev
}
const restore = (qc: QueryClient, prev?: Snapshot) => prev?.forEach(([key, data]) => qc.setQueryData(key, data))

/** Create with optimistic insert + rollback */
export function useCreate<T extends TableName>(table: T, opts: { silent?: boolean; label?: string } = {}) {
  const qc = useQueryClient()
  return useMutation<Row<T>, Error, NewRow<T>, Ctx>({
    mutationFn: (row) => db.insert(table, row),
    onMutate: async (row) => {
      await qc.cancelQueries({ queryKey: qk(table) })
      const temp = { ...row, id: row.id ?? `temp-${crypto.randomUUID()}`, created_at: new Date().toISOString(), __optimistic: true } as unknown as Row<T>
      // shown at the top of full lists and of the first page of paged lists; the refetch puts it in its real place
      const prev = qc.getQueriesData({ queryKey: qk(table) }) as Snapshot
      qc.setQueriesData({ queryKey: qk(table) }, (old: unknown) => {
        if (Array.isArray(old)) return qc.getQueryData(qk(table)) === old ? [temp, ...old] : old
        const o = old as QueryResult<Row<T>> | undefined
        if (o && Array.isArray(o.rows) && o.count != null) return { rows: [temp, ...o.rows], count: o.count + 1 }
        return old
      })
      return { prev }
    },
    onError: (err, _v, ctx) => {
      restore(qc, ctx?.prev)
      toast.error(`Could not create ${opts.label ?? 'record'}`, { description: err.message })
    },
    onSuccess: (row) => { if (!opts.silent) toast.success(`${opts.label ?? 'Record'} created`); if (NOTIFY_TABLES.has(table)) flushNotificationsSoon(1200, notifyIds(row)) },
    onSettled: () => afterWrite(qc, table),
  })
}

/** Update with optimistic patch + rollback */
export function useUpdate<T extends TableName>(table: T, opts: { silent?: boolean; label?: string } = {}) {
  const qc = useQueryClient()
  return useMutation<Row<T>, Error, { id: string; patch: Partial<Row<T>> }, Ctx>({
    mutationFn: ({ id, patch }) => db.update(table, id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk(table) })
      const prev = patchCaches(qc, table, (rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
      qc.setQueriesData({ queryKey: [...qk(table), 'row', id] }, (old: unknown) => (old ? { ...(old as object), ...patch } : old))
      return { prev }
    },
    onError: (err, _v, ctx) => {
      restore(qc, ctx?.prev)
      toast.error(`Could not update ${opts.label ?? 'record'}`, { description: err.message })
    },
    onSuccess: (row, { id }) => { if (!opts.silent) toast.success(`${opts.label ?? 'Record'} updated`); if (NOTIFY_TABLES.has(table)) flushNotificationsSoon(1200, [id, ...notifyIds(row)]) },
    onSettled: () => afterWrite(qc, table),
  })
}

/** Delete with optimistic removal + rollback */
export function useRemove<T extends TableName>(table: T, opts: { silent?: boolean; label?: string } = {}) {
  const qc = useQueryClient()
  return useMutation<void, Error, string, Ctx>({
    mutationFn: (id) => db.remove(table, id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk(table) })
      const prev = patchCaches(qc, table, (rows) => rows.filter((r) => r.id !== id), -1)
      return { prev }
    },
    onError: (err, _v, ctx) => {
      restore(qc, ctx?.prev)
      toast.error(`Could not delete ${opts.label ?? 'record'}`, { description: err.message })
    },
    onSuccess: () => { if (!opts.silent) toast.success(`${opts.label ?? 'Record'} deleted`) },
    onSettled: () => afterWrite(qc, table),
  })
}
