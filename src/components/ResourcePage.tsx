import { format } from 'date-fns'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, MoreHorizontal, Pencil, Plus, Search, SearchX, Trash2, X } from 'lucide-react'
import type { ResourceCtx, ResourceDef, RowAction } from '../resources/types'
import { useResourceCtx } from '../resources/useResourceCtx'
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { qk, useCreate, useRemove, useRows, useTable, useUpdate } from '../hooks/useData'
import { db, queryAll } from '../data/adapter'
import { cleanTerm, type Filter, type Query } from '../data/query'
import type { TableName } from '../types'
import { can } from '../auth/permissions'
import { translate, useT } from '../i18n'
import { Button, Card, ConfirmDialog, EmptyState, Input, PageHeader, Select, Skeleton } from './ui'
import { ResourceFormDrawer } from './ResourceForm'
import { cn, downloadCsv } from '../lib/utils'

const PAGE_SIZE = 12
const EXPORT_CAP = 20_000
const hideCls = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' }

/** Debounced copy of a value (search box → server query). */
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id) }, [value, ms])
  return v
}

type ListState = { search: string; filters: Record<string, string>; sort: { key: string; dir: 'asc' | 'desc' } }

/** Builds the database query for a server-mode resource list (scope + search + filters + sort). */
async function buildServerQuery(def: ResourceDef, ctx: ResourceCtx, st: ListState): Promise<Query> {
  const spec = def.server!
  const where: Filter[] = [...(spec.scope?.(ctx) ?? [])]
  for (const f of def.filters ?? []) {
    const v = st.filters[f.key]
    if (v) where.push(...(spec.filters?.[f.key]?.(v, ctx) ?? [[f.key, 'eq', v] as Filter]))
  }
  const term = cleanTerm(st.search)
  let search: Query['search']
  if (term) {
    // e.g. typing a patient's name on Invoices: find matching patients first, then their invoices
    const ids = await Promise.all((spec.searchVia ?? []).filter((v) => can(ctx.role, v.table, 'read')).map(async (v) => ({
      column: v.column,
      ids: (await db.query(v.table, { search: { term, columns: v.columns }, range: [0, 99] })).rows.map((r) => r.id),
    })))
    search = { term, columns: spec.search, ids }
  }
  const cols = spec.sort?.[st.sort.key]?.split(',') ?? []
  return { where, search, order: cols.length ? cols.map((column) => ({ column, asc: st.sort.dir === 'asc' })) : undefined }
}

export function ResourcePage({ def, headerExtra }: { def: ResourceDef; headerExtra?: ReactNode }) {
  const server = !!def.server
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [filters, setFilters] = useState<Record<string, string>>(() => Object.fromEntries((def.filters ?? []).map((f) => [f.key, params.get(f.key) ?? ''])))
  const [sort, setSort] = useState(def.defaultSort ?? { key: def.columns[0].key, dir: 'asc' as const })
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [prefill, setPrefill] = useState<Record<string, any>>({})
  const [deleting, setDeleting] = useState<any | null>(null)
  const [exporting, setExporting] = useState(false)
  const debounced = useDebounced(search, server ? 300 : 0)

  // ---------------------------------------------------------------- server mode: one page at a time
  const { ctx: baseCtx } = useResourceCtx(server ? [] : def.relations)
  const listState: ListState = { search: debounced, filters, sort }
  const pageQ = useQuery({
    queryKey: [...qk(def.table), 'page', JSON.stringify(listState), page, baseCtx?.role, baseCtx?.me.patient?.id, baseCtx?.me.doctor?.id],
    queryFn: async () => db.query(def.table, { ...(await buildServerQuery(def, baseCtx!, listState)), range: [(page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1], count: true }),
    enabled: server && !!baseCtx,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
  const pageRows = useMemo(() => (pageQ.data?.rows ?? []) as any[], [pageQ.data])
  // related records for just the rows on screen (patient names, invoice numbers…)
  const resolveEntries = Object.entries(def.server?.resolve ?? {})
  const resolved = useQueries({
    queries: resolveEntries.map(([col, table]) => {
      const ids = [...new Set(pageRows.map((r) => r[col]).filter((x): x is string => !!x && !String(x).startsWith('temp-')))].sort()
      return {
        queryKey: [...qk(table), 'ids', ids.join(',')],
        queryFn: async () => (await db.query(table, { where: [['id', 'in', ids]] })).rows as { id: string }[],
        enabled: server && ids.length > 0 && can(baseCtx?.role, table, 'read'),
        staleTime: 60_000,
        placeholderData: keepPreviousData,
      }
    }),
  })
  const extra = useMemo(() => {
    const out: Partial<Record<TableName, unknown[]>> = {}
    resolveEntries.forEach(([, table], i) => { out[table] = [...(out[table] ?? []), ...(resolved[i]?.data ?? [])] })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved.map((r) => r.dataUpdatedAt).join('|'), def])
  const latest = useRows(def.table, { order: [{ column: def.server?.latestBy ?? 'created_at', asc: false }], range: [0, 19] }, { enabled: server && !!def.server?.latestBy })

  // ---------------------------------------------------------------- client mode: small tables, filtered in memory
  const full = useTable(def.table, { enabled: !server })
  const { ctx: relCtx, loading: relLoading } = useResourceCtx(server ? (def.relations ?? []) : [], extra)
  const ctx = server ? relCtx : baseCtx
  const ctxLoading = server ? relLoading : !baseCtx

  const label = def.singular
  const create = useCreate(def.table, { label })
  const update = useUpdate(def.table, { label })
  const remove = useRemove(def.table, { label })

  const role = ctx?.role
  const { t: tt } = useT()
  // patient portal follows the chosen language; staff lists stay English
  const t = (s: string, v?: Record<string, string | number>) => (role === 'patient' ? tt(s, v) : translate('en', s, v))
  const rawTitle = typeof def.title === 'function' ? (role ? def.title(role) : '') : def.title
  const title = t(rawTitle)
  const rawDesc = typeof def.description === 'function' ? (role ? def.description(role) : '') : def.description
  const description = rawDesc && t(rawDesc)
  const canCreate = def.allowCreate !== false && can(role, def.table, 'create')
  const canUpdate = can(role, def.table, 'update')
  const canDel = can(role, def.table, 'delete')

  // open "new" drawer from query string, e.g. /appointments?new=1&patient_id=...
  useEffect(() => {
    if (params.get('new') && ctx && canCreate) {
      const pre: Record<string, string> = {}
      params.forEach((v, k) => { if (k !== 'new' && def.fields.some((f) => f.name === k)) pre[k] = v })
      setPrefill(pre); setEditing(null); setFormOpen(true)
      const next = new URLSearchParams(params); next.delete('new'); def.fields.forEach((f) => next.delete(f.name))
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, ctx, canCreate])

  const columns = useMemo(() => def.columns.filter((c) => role && !c.hideFor?.includes(role) && (!c.showFor || c.showFor.includes(role))), [def.columns, role])
  const sortable = (key: string) => !server || !!def.server?.sort?.[key]

  const scoped = useMemo(() => {
    if (server || !ctx || !full.data) return []
    return def.scope ? full.data.filter((r) => def.scope!(r, ctx)) : full.data
  }, [server, full.data, ctx, def])

  const filtered = useMemo(() => {
    if (server || !ctx) return []
    const s = search.trim().toLowerCase()
    let rows = scoped
    if (s) rows = rows.filter((r) => def.searchText(r, ctx).toLowerCase().includes(s))
    for (const f of def.filters ?? []) {
      const v = filters[f.key]
      if (!v) continue
      rows = rows.filter((r) => (f.predicate ? f.predicate(r, v, ctx) : String((r as any)[f.key]) === v))
    }
    const col = columns.find((c) => c.key === sort.key)
    const sv = (r: any) => (col?.sortValue ? col.sortValue(r, ctx) : r[sort.key] ?? '')
    return [...rows].sort((a, b) => {
      const x = sv(a), y = sv(b)
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [server, scoped, search, filters, sort, ctx, def, columns])

  useEffect(() => setPage(1), [debounced, filters, sort])
  const total = server ? pageQ.data?.count ?? 0 : filtered.length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  // a delete on the last page can leave us past the end
  useEffect(() => { if (server && pageQ.data && page > pages) setPage(pages) }, [server, pageQ.data, page, pages])
  const current = server ? pageRows : filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const loading = (server ? pageQ.isLoading : full.isLoading) || ctxLoading || !ctx
  const refreshing = server && pageQ.isFetching && !pageQ.isLoading
  const activeFilters = Object.values(filters).filter(Boolean).length + (search ? 1 : 0)
  const isEmptyTable = server ? total === 0 && activeFilters === 0 && !pageQ.isPlaceholderData : scoped.length === 0
  const formRows = (server ? [...(latest.data?.rows ?? []), ...pageRows] : full.data ?? []) as any[]

  const openCreate = () => { setPrefill({}); setEditing(null); setFormOpen(true) }
  const openEdit = (row: any) => { setEditing(row); setFormOpen(true) }

  const handleSubmit = (values: Record<string, any>) => {
    if (!ctx) return
    const existing = editing ?? undefined
    const payload = def.beforeSave ? def.beforeSave(values, ctx, existing) : values
    setFormOpen(false)
    if (existing) {
      update.mutate({ id: existing.id, patch: payload }, { onSuccess: (saved) => def.afterSave?.(saved, ctx, existing) })
    } else {
      create.mutate(payload as never, { onSuccess: (saved) => def.afterSave?.(saved, ctx) })
    }
  }

  const confirmDelete = () => {
    if (!deleting || !ctx) return
    const row = deleting
    setDeleting(null)
    remove.mutate(row.id, { onSuccess: () => def.afterDelete?.(row, ctx) })
  }

  const exportCsv = async () => {
    if (!ctx) return
    let rows: any[] = filtered
    if (server) {
      // export every matching row, not just the visible page
      setExporting(true)
      try {
        rows = await queryAll(def.table, await buildServerQuery(def, ctx, { search, filters, sort }), EXPORT_CAP)
        if (rows.length >= EXPORT_CAP) toast.info(`Exported the first ${EXPORT_CAP.toLocaleString('en-IN')} rows — narrow the filters to export the rest.`)
      } catch (e) { toast.error('Export failed', { description: (e as Error).message }); return } finally { setExporting(false) }
    }
    downloadCsv(`${def.table}-${format(new Date(), 'yyyy-MM-dd')}.csv`, rows.map((r: any) => {
      const { __optimistic, ...rest } = r
      void __optimistic
      return rest
    }))
  }

  const toggleSort = (key: string) => { if (sortable(key)) setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })) }

  return (
    <div>
      <PageHeader title={title} description={description}
        actions={<>
          {headerExtra}
          {role !== 'patient' && <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!total || exporting}>{exporting ? 'Exporting…' : 'Export'}</Button>}
          {canCreate && <Button icon={<Plus className="h-4 w-4" />} onClick={openCreate} disabled={!ctx}>New {label.toLowerCase()}</Button>}
        </>} />

      <Card className="overflow-hidden">
        {/* toolbar */}
        <div className="flex flex-col gap-2 border-b border-slate-100 p-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search {what}…', { what: title.toLowerCase() })} className="pl-9" />
          </div>
          {!!def.filters?.length && (
            <div className="grid grid-cols-2 gap-2 sm:flex">
              {def.filters.map((f) => (
                <Select key={f.key} value={filters[f.key]} onChange={(e) => setFilters((s) => ({ ...s, [f.key]: e.target.value }))} className="sm:w-40">
                  <option value="">{f.label}: All</option>
                  {(typeof f.options === 'function' ? (ctx ? f.options(ctx) : []) : f.options).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              ))}
            </div>
          )}
          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={() => { setSearch(''); setFilters((s) => Object.fromEntries(Object.keys(s).map((k) => [k, '']))) }}>Clear</Button>
          )}
        </div>

        {/* table */}
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-50/70 text-[11px] font-semibold uppercase tracking-wide text-brand-700/80">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={cn('whitespace-nowrap px-4 py-2.5', c.hideBelow && hideCls[c.hideBelow], c.align === 'right' && 'text-right')}>
                    <button onClick={() => toggleSort(c.key)} disabled={!sortable(c.key)} className={cn('inline-flex items-center gap-1', sortable(c.key) && 'hover:text-slate-800', sort.key === c.key && 'text-slate-800')}>
                      {t(c.header)}
                      {sort.key === c.key && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                    </button>
                  </th>
                ))}
                <th className="w-12 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#efeff8]">
              {loading && Array.from({ length: 7 }).map((_, i) => (
                <tr key={i}>
                  {columns.map((c, j) => (
                    <td key={c.key} className={cn('px-4 py-3.5', c.hideBelow && hideCls[c.hideBelow])}>
                      {j === 0 ? <div className="flex items-center gap-3"><Skeleton className="h-8 w-8 rounded-full" /><div className="space-y-1.5"><Skeleton className="h-3 w-28" /><Skeleton className="h-2.5 w-16" /></div></div> : <Skeleton className="h-3 w-20" />}
                    </td>
                  ))}
                  <td />
                </tr>
              ))}
              {!loading && current.map((row: any) => {
                const optimistic = row.__optimistic || String(row.id).startsWith('temp-')
                const editable = canUpdate && (!def.canEdit || def.canEdit(row, ctx!))
                const deletable = canDel && (!def.canDelete || def.canDelete(row, ctx!))
                const custom = (def.rowActions?.(row, ctx!) ?? []).filter(Boolean) as RowAction<any>[]
                return (
                  <tr key={row.id} className={cn('group transition hover:bg-brand-50/50', optimistic && 'pointer-events-none animate-pulse opacity-60')}>
                    {columns.map((c, j) => (
                      <td key={c.key} className={cn('px-4 py-3 align-middle', c.hideBelow && hideCls[c.hideBelow], c.align === 'right' && 'text-right tabular-nums', c.className)}>
                        {j === 0 && def.rowLink && !optimistic ? <Link to={def.rowLink(row)} className="block hover:[&_.name]:text-brand-700">{c.render(row, ctx!)}</Link> : c.render(row, ctx!)}
                      </td>
                    ))}
                    <td className="px-2 py-3 text-right">
                      {!optimistic && (editable || deletable || custom.length > 0) && (
                        <RowMenu ctx={ctx!} row={row} actions={[
                          ...custom,
                          ...(editable ? [{ label: 'Edit', icon: Pencil, onClick: () => openEdit(row) }] : []),
                          ...(deletable ? [{ label: 'Delete', icon: Trash2, tone: 'danger' as const, onClick: () => setDeleting(row) }] : []),
                        ]} />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {!loading && total === 0 && (
          isEmptyTable ? (
            <EmptyState icon={<def.icon className="h-6 w-6" />} title={t('No {what} yet', { what: title.toLowerCase() })}
              description={def.emptyText ? t(def.emptyText) : canCreate ? `Get started by creating your first ${label.toLowerCase()}.` : t('Nothing to show here right now.')}
              action={canCreate && <Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>New {label.toLowerCase()}</Button>} />
          ) : (
            <EmptyState icon={<SearchX className="h-6 w-6" />} title={t('No matching results')} description={t('Try adjusting your search or filters.')}
              action={<Button variant="outline" onClick={() => { setSearch(''); setFilters((s) => Object.fromEntries(Object.keys(s).map((k) => [k, '']))) }}>{t('Clear filters')}</Button>} />
          )
        )}

        {!loading && total > 0 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            <span>Showing <b className="text-slate-700">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}</b> of <b className="text-slate-700">{total.toLocaleString('en-IN')}</b>{refreshing && <span className="ml-2 text-brand-500">Updating…</span>}</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous"><ChevronLeft className="h-3.5 w-3.5" /></Button>
              <span className="px-2">Page {page} / {pages}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next"><ChevronRight className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        )}
      </Card>

      {ctx && (
        <ResourceFormDrawer def={def} ctx={ctx} open={formOpen} onClose={() => setFormOpen(false)} initial={editing} prefill={prefill}
          rows={formRows} onSubmit={handleSubmit} saving={create.isPending || update.isPending} />
      )}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={confirmDelete}
        title={`Delete this ${label.toLowerCase()}?`} description="This action cannot be undone. The record will be permanently removed." />
    </div>
  )
}

export function RowMenu({ row, actions, ctx }: { row: any; actions: RowAction<any>[]; ctx: ResourceCtx }) {
  const [open, setOpen] = useState(false)
  const { t } = useT()
  const btn = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, up: false })

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const up = window.innerHeight - r.bottom < 260
    setPos({ top: up ? r.top : r.bottom + 4, left: Math.max(8, r.right - 208), up })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [open])

  return (
    <>
      <button ref={btn} onClick={() => setOpen((o) => !o)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Row actions">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed z-50 w-52 animate-pop-in rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
            style={{ top: pos.top, left: pos.left, transform: pos.up ? 'translateY(calc(-100% - 4px))' : undefined }}>
            {actions.map((a, i) => (
              <button key={i} onClick={() => { setOpen(false); a.onClick(row, ctx) }}
                className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition',
                  a.tone === 'danger' ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-100',
                  a.tone === 'danger' && i > 0 && 'mt-1 border-t border-slate-100')}>
                {a.icon && <a.icon className="h-4 w-4 opacity-70" />}
                {ctx.role === 'patient' ? t(a.label) : a.label}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
