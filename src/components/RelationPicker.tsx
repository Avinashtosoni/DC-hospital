import { useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Loader2, Search, X } from 'lucide-react'
import { db } from '../data/adapter'
import { cleanTerm } from '../data/query'
import { qk } from '../hooks/useData'
import type { FieldDef, Lookups, ResourceCtx } from '../resources/types'
import type { TableName } from '../types'
import { cn } from '../lib/utils'

const LIMIT = 20

/** foreign keys a picker label may need (an invoice label shows the patient's name) */
const LABEL_LINKS: Partial<Record<TableName, Record<string, TableName>>> = {
  invoices: { patient_id: 'patients' },
}

/** fetch the rows linked from `rows` and return a ctx whose lookups include them */
async function withLinks(table: TableName, rows: { id: string }[], ctx: ResourceCtx): Promise<Lookups> {
  const links = Object.entries(LABEL_LINKS[table] ?? {})
  if (!links.length) return ctx.lk
  const lk = { ...ctx.lk }
  for (const [col, t] of links) {
    const ids = [...new Set(rows.map((r) => (r as unknown as Record<string, string>)[col]).filter(Boolean))]
    if (!ids.length) continue
    const m = new Map(ctx.lk[t] as Map<string, unknown>)
    ;(await db.query(t, { where: [['id', 'in', ids]] })).rows.forEach((r) => m.set(r.id, r))
    ;(lk as Record<string, unknown>)[t] = m
  }
  return lk
}

/**
 * Searchable picker for relations to big tables (patients, invoices): queries the database as the user types and
 * never downloads the whole table.
 */
export function RelationPicker({ f, ctx, value, values, onChange, disabled, invalid }: {
  f: FieldDef; ctx: ResourceCtx; value: string | null | undefined; values: Record<string, any>; onChange: (v: string) => void; disabled?: boolean; invalid?: boolean
}) {
  const rel = f.relation!
  const spec = rel.search!
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { const id = setTimeout(() => setDebounced(cleanTerm(term)), 250); return () => clearTimeout(id) }, [term])

  const where = spec.where?.(ctx, values) ?? []
  const results = useQuery({
    queryKey: [...qk(rel.table), 'pick', f.name, debounced, JSON.stringify(where)],
    queryFn: async () => {
      const { rows } = await db.query(rel.table, {
        where, search: debounced ? { term: debounced, columns: spec.columns } : undefined,
        order: [{ column: spec.order ?? 'created_at', asc: spec.order ? true : false }], range: [0, LIMIT - 1],
      })
      const lk = await withLinks(rel.table, rows, ctx)
      const c = { ...ctx, lk }
      return rows.filter((r) => !rel.filter || rel.filter(r, c, values)).map((r) => ({ value: r.id, label: rel.label(r, c) }))
    },
    enabled: open,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })

  // label of the current value (it may not be among the search results)
  const selected = useQuery({
    queryKey: [...qk(rel.table), 'pick-label', value],
    queryFn: async () => {
      const known = (ctx.lk[rel.table] as Map<string, { id: string }>).get(value!)
      const row = known ?? (await db.query(rel.table, { where: [['id', 'eq', value]] })).rows[0]
      if (!row) return null
      return rel.label(row, { ...ctx, lk: await withLinks(rel.table, [row], ctx) })
    },
    enabled: !!value,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  useEffect(() => setActive(0), [debounced])

  const opts = useMemo(() => results.data ?? [], [results.data])
  const pick = (v: string) => { onChange(v); setOpen(false); setTerm('') }

  return (
    <div ref={box} className="relative">
      <button type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} data-field={f.name}
        onClick={() => { setOpen((o) => !o); setTimeout(() => input.current?.focus(), 0) }}
        className={cn('flex h-10 w-full items-center justify-between gap-2 rounded-xl border bg-white px-3 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:bg-slate-50',
          invalid ? 'border-rose-300' : 'border-slate-200 hover:border-slate-300')}>
        <span className={cn('truncate', !value && 'text-slate-400')}>
          {value ? (selected.data ?? (selected.isLoading ? 'Loading…' : 'Unknown record')) : `Search ${f.label.toLowerCase()}…`}
        </span>
        <span className="flex items-center gap-1 text-slate-400">
          {value && !disabled && !f.required && <X className="h-3.5 w-3.5 hover:text-slate-600" onClick={(e) => { e.stopPropagation(); onChange('') }} />}
          <ChevronsUpDown className="h-4 w-4" />
        </span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full animate-pop-in overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="relative border-b border-slate-100">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input ref={input} value={term} onChange={(e) => setTerm(e.target.value)} placeholder={`Type to search${spec.columns.includes('mrn') ? ' name, MRN or phone' : ''}…`}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(opts.length - 1, a + 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
                else if (e.key === 'Enter') { e.preventDefault(); if (opts[active]) pick(opts[active].value) }
                else if (e.key === 'Escape') setOpen(false)
              }}
              className="h-10 w-full bg-transparent pl-9 pr-8 text-sm outline-none" />
            {results.isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
          </div>
          <ul role="listbox" className="scrollbar-thin max-h-64 overflow-y-auto p-1">
            {opts.map((o, i) => (
              <li key={o.value} role="option" aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(o.value) }}
                className={cn('flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm', i === active ? 'bg-brand-50 text-brand-800' : 'text-slate-700')}>
                <span className="truncate">{o.label}</span>
                {o.value === value && <Check className="h-4 w-4 shrink-0 text-brand-600" />}
              </li>
            ))}
            {!results.isLoading && opts.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">{debounced ? 'No matches' : 'No options available'}</li>}
            {results.isLoading && <li className="px-3 py-6 text-center text-sm text-slate-400">Searching…</li>}
          </ul>
          {opts.length === LIMIT && <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">Showing the first {LIMIT} — keep typing to narrow down</div>}
        </div>
      )}
    </div>
  )
}
