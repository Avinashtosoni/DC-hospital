import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, MoreHorizontal, Pencil, Plus, Search, SearchX, Trash2, X } from 'lucide-react'
import type { ResourceCtx, ResourceDef, RowAction } from '../resources/types'
import { useResourceCtx } from '../resources/useResourceCtx'
import { useCreate, useRemove, useTable, useUpdate } from '../hooks/useData'
import { can } from '../auth/permissions'
import { Button, Card, ConfirmDialog, EmptyState, Input, PageHeader, Select, Skeleton } from './ui'
import { ResourceFormDrawer } from './ResourceForm'
import { cn, downloadCsv } from '../lib/utils'

const PAGE_SIZE = 12
const hideCls = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' }

export function ResourcePage({ def, headerExtra }: { def: ResourceDef; headerExtra?: ReactNode }) {
  const { ctx, loading: ctxLoading } = useResourceCtx(def.relations)
  const q = useTable(def.table)
  const label = def.singular
  const create = useCreate(def.table, { label })
  const update = useUpdate(def.table, { label })
  const remove = useRemove(def.table, { label })
  const [params, setParams] = useSearchParams()

  const [search, setSearch] = useState(params.get('q') ?? '')
  const [filters, setFilters] = useState<Record<string, string>>(() => Object.fromEntries((def.filters ?? []).map((f) => [f.key, params.get(f.key) ?? ''])))
  const [sort, setSort] = useState(def.defaultSort ?? { key: def.columns[0].key, dir: 'asc' as const })
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [prefill, setPrefill] = useState<Record<string, any>>({})
  const [deleting, setDeleting] = useState<any | null>(null)

  const role = ctx?.role
  const title = typeof def.title === 'function' ? (role ? def.title(role) : '') : def.title
  const description = typeof def.description === 'function' ? (role ? def.description(role) : '') : def.description
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

  const scoped = useMemo(() => {
    if (!ctx || !q.data) return []
    return def.scope ? q.data.filter((r) => def.scope!(r, ctx)) : q.data
  }, [q.data, ctx, def])

  const filtered = useMemo(() => {
    if (!ctx) return []
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
  }, [scoped, search, filters, sort, ctx, def, columns])

  useEffect(() => setPage(1), [search, filters])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const loading = q.isLoading || ctxLoading || !ctx
  const activeFilters = Object.values(filters).filter(Boolean).length + (search ? 1 : 0)

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

  const exportCsv = () => {
    if (!ctx) return
    downloadCsv(`${def.table}-${new Date().toISOString().slice(0, 10)}.csv`, filtered.map((r: any) => {
      const { __optimistic, ...rest } = r
      void __optimistic
      return rest
    }))
  }

  const toggleSort = (key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  return (
    <div>
      <PageHeader title={title} description={description}
        actions={<>
          {headerExtra}
          {role !== 'patient' && <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!filtered.length}>Export</Button>}
          {canCreate && <Button icon={<Plus className="h-4 w-4" />} onClick={openCreate} disabled={!ctx}>New {label.toLowerCase()}</Button>}
        </>} />

      <Card className="overflow-hidden">
        {/* toolbar */}
        <div className="flex flex-col gap-2 border-b border-slate-100 p-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${title.toLowerCase()}…`} className="pl-9" />
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
                    <button onClick={() => toggleSort(c.key)} className={cn('inline-flex items-center gap-1 hover:text-slate-800', sort.key === c.key && 'text-slate-800')}>
                      {c.header}
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

        {!loading && filtered.length === 0 && (
          scoped.length === 0 ? (
            <EmptyState icon={<def.icon className="h-6 w-6" />} title={`No ${title.toLowerCase()} yet`}
              description={def.emptyText ?? (canCreate ? `Get started by creating your first ${label.toLowerCase()}.` : 'Nothing to show here right now.')}
              action={canCreate && <Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>New {label.toLowerCase()}</Button>} />
          ) : (
            <EmptyState icon={<SearchX className="h-6 w-6" />} title="No matching results" description="Try adjusting your search or filters."
              action={<Button variant="outline" onClick={() => { setSearch(''); setFilters((s) => Object.fromEntries(Object.keys(s).map((k) => [k, '']))) }}>Clear filters</Button>} />
          )
        )}

        {!loading && filtered.length > 0 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            <span>Showing <b className="text-slate-700">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)}</b> of <b className="text-slate-700">{filtered.length}</b></span>
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
          rows={q.data ?? []} onSubmit={handleSubmit} saving={create.isPending || update.isPending} />
      )}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={confirmDelete}
        title={`Delete this ${label.toLowerCase()}?`} description="This action cannot be undone. The record will be permanently removed." />
    </div>
  )
}

export function RowMenu({ row, actions, ctx }: { row: any; actions: RowAction<any>[]; ctx: ResourceCtx }) {
  const [open, setOpen] = useState(false)
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
                {a.label}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
