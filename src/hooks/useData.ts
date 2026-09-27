import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { db, type NewRow, type Row } from '../data/adapter'
import type { TableName } from '../types'
import { useAuth } from '../auth/AuthProvider'
import { can } from '../auth/permissions'

export const qk = (table: TableName) => ['table', table] as const

/** Fetches a whole table (cached). Returns [] when the current role has no read access. */
export function useTable<T extends TableName>(table: T, opts: { enabled?: boolean } = {}) {
  const { user } = useAuth()
  const allowed = can(user?.role, table, 'read') || table === 'profiles'
  return useQuery({
    queryKey: qk(table),
    queryFn: () => db.list(table),
    enabled: allowed && (opts.enabled ?? true) && !!user,
    staleTime: 30_000,
  })
}

/** id -> row lookup map for a table */
export function useLookup<T extends TableName>(table: T, opts: { enabled?: boolean } = {}) {
  const q = useTable(table, opts)
  const map = new Map<string, Row<T>>()
  q.data?.forEach((r) => map.set(r.id, r))
  return map
}

type Ctx<T extends TableName> = { prev?: Row<T>[] }

/** Create with optimistic insert + rollback */
export function useCreate<T extends TableName>(table: T, opts: { silent?: boolean; label?: string } = {}) {
  const qc = useQueryClient()
  return useMutation<Row<T>, Error, NewRow<T>, Ctx<T>>({
    mutationFn: (row) => db.insert(table, row),
    onMutate: async (row) => {
      await qc.cancelQueries({ queryKey: qk(table) })
      const prev = qc.getQueryData<Row<T>[]>(qk(table))
      const temp = { ...row, id: row.id ?? `temp-${crypto.randomUUID()}`, created_at: new Date().toISOString(), __optimistic: true } as unknown as Row<T>
      qc.setQueryData<Row<T>[]>(qk(table), (old) => [temp, ...(old ?? [])])
      return { prev }
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk(table), ctx.prev)
      toast.error(`Could not create ${opts.label ?? 'record'}`, { description: err.message })
    },
    onSuccess: () => { if (!opts.silent) toast.success(`${opts.label ?? 'Record'} created`) },
    onSettled: () => qc.invalidateQueries({ queryKey: qk(table) }),
  })
}

/** Update with optimistic patch + rollback */
export function useUpdate<T extends TableName>(table: T, opts: { silent?: boolean; label?: string } = {}) {
  const qc = useQueryClient()
  return useMutation<Row<T>, Error, { id: string; patch: Partial<Row<T>> }, Ctx<T>>({
    mutationFn: ({ id, patch }) => db.update(table, id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk(table) })
      const prev = qc.getQueryData<Row<T>[]>(qk(table))
      qc.setQueryData<Row<T>[]>(qk(table), (old) => (old ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)))
      return { prev }
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk(table), ctx.prev)
      toast.error(`Could not update ${opts.label ?? 'record'}`, { description: err.message })
    },
    onSuccess: () => { if (!opts.silent) toast.success(`${opts.label ?? 'Record'} updated`) },
    onSettled: () => qc.invalidateQueries({ queryKey: qk(table) }),
  })
}

/** Delete with optimistic removal + rollback */
export function useRemove<T extends TableName>(table: T, opts: { silent?: boolean; label?: string } = {}) {
  const qc = useQueryClient()
  return useMutation<void, Error, string, Ctx<T>>({
    mutationFn: (id) => db.remove(table, id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk(table) })
      const prev = qc.getQueryData<Row<T>[]>(qk(table))
      qc.setQueryData<Row<T>[]>(qk(table), (old) => (old ?? []).filter((r) => r.id !== id))
      return { prev }
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk(table), ctx.prev)
      toast.error(`Could not delete ${opts.label ?? 'record'}`, { description: err.message })
    },
    onSuccess: () => { if (!opts.silent) toast.success(`${opts.label ?? 'Record'} deleted`) },
    onSettled: () => qc.invalidateQueries({ queryKey: qk(table) }),
  })
}
