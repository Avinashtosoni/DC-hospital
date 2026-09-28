/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  ArrowDown, ArrowUp, Check, ChevronDown, Copy, Eye, EyeOff, ImageIcon, ImagePlus, Plus, Search, Trash2, X,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { ConfirmDialog, Input, Modal, Select, Textarea } from '../../components/ui'
import { Rich } from '../../site/cms/content'
import { ICON_NAMES, iconFor } from '../../site/cms/icons'
import { MediaLibrary } from './MediaLibrary'
import type { Ctx, FieldDef, Obj } from './schema'

// ------------------------------------------------------------------ path helpers ('' = the object itself)
const get = (o: any, k: string) => (k ? o?.[k] : o)
const put = (o: any, k: string, v: any) => (k ? { ...o, [k]: v } : v)
const move = <T,>(a: T[], from: number, to: number) => { const n = [...a]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return n }
const changed = (a: unknown, b: unknown) => b !== undefined && JSON.stringify(a) !== JSON.stringify(b)
const EditedChip = () => <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Edited</span>

/** `saved` is the published value at the same path — used to flag groups/lists with unpublished edits. */
export function FieldsForm({ fields, value, saved, onChange, ctx, depth = 0 }: { fields: FieldDef[]; value: any; saved?: any; onChange: (v: any) => void; ctx: Ctx; depth?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((f, i) => (
        <div key={f.k + i} className={cn((f.full || f.t === 'group' || f.t === 'list' || f.t === 'tags' || f.t === 'strings' || f.t === 'cells') && 'sm:col-span-2')}>
          <FieldView f={f} value={get(value, f.k)} saved={saved === undefined ? undefined : get(saved, f.k)} onChange={(v) => onChange(put(value, f.k, v))} ctx={ctx} depth={depth} />
        </div>
      ))}
    </div>
  )
}

function Label({ f, children, htmlFor }: { f: FieldDef; children?: ReactNode; htmlFor?: string }) {
  return (
    <div className="mb-1.5 flex items-end justify-between gap-2">
      <label htmlFor={htmlFor} className="text-xs font-semibold text-slate-700">{f.label}</label>
      {children}
    </div>
  )
}
const Hint = ({ f }: { f: FieldDef }) => (f.hint ? <p className="mt-1 text-[11px] leading-snug text-slate-400">{f.hint}</p> : null)
let uid = 0
const useId = () => useState(() => `cf-${++uid}`)[0]

function FieldView({ f, value, saved, onChange, ctx, depth }: { f: FieldDef; value: any; saved?: any; onChange: (v: any) => void; ctx: Ctx; depth: number }) {
  const id = useId()
  switch (f.t) {
    case 'text': case 'url':
      return <div><Label f={f} htmlFor={id} /><Input id={id} type={f.t === 'url' ? 'url' : 'text'} value={value ?? ''} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} /><Hint f={f} /></div>
    case 'textarea':
      return <div><Label f={f} htmlFor={id}><span className="text-[10px] text-slate-400">{String(value ?? '').length}</span></Label><Textarea id={id} rows={f.rows ?? 3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="min-h-0" /><Hint f={f} /></div>
    case 'rich':
      return (
        <div>
          <Label f={f} htmlFor={id} />
          <Input id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
          {String(value ?? '').includes('*')
            ? <p className="mt-1.5 truncate rounded-md bg-slate-50 px-2 py-1 font-display text-xs font-bold text-peri-900"><Rich text={String(value)} /></p>
            : <Hint f={f} />}
        </div>
      )
    case 'number':
      return <div><Label f={f} htmlFor={id} /><Input id={id} type="number" inputMode="decimal" step={f.step ?? 1} min={f.min} max={f.max} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} /><Hint f={f} /></div>
    case 'toggle':
      return <Toggle label={f.label} hint={f.hint} checked={!!value} onChange={onChange} />
    case 'select': {
      const opts = typeof f.options === 'function' ? f.options(ctx) : f.options.map((o) => ({ value: o, label: o }))
      return <div><Label f={f} htmlFor={id} /><Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select><Hint f={f} /></div>
    }
    case 'image': return <ImageField f={f} value={value ?? ''} onChange={onChange} />
    case 'icon': return <IconField f={f} value={value ?? ''} onChange={onChange} />
    case 'tags': return <TagsField f={f} value={Array.isArray(value) ? value : []} onChange={onChange} />
    case 'strings': return <StringsField f={f} value={Array.isArray(value) ? value : []} onChange={onChange} />
    case 'days': return <DaysField f={f} value={Array.isArray(value) ? value : []} onChange={onChange} />
    case 'cells': return <CellsField f={f} value={Array.isArray(value) ? value : []} onChange={onChange} ctx={ctx} />
    case 'group': return <Group f={f} value={value ?? {}} saved={saved} onChange={onChange} ctx={ctx} depth={depth} />
    case 'list': return <ListField f={f} value={Array.isArray(value) ? value : []} saved={Array.isArray(saved) ? saved : undefined} onChange={onChange} ctx={ctx} depth={depth} />
  }
}

// ------------------------------------------------------------------ primitives
export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={cn('flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition', checked ? 'border-brand-200 bg-brand-50/60' : 'border-slate-200 bg-white hover:bg-slate-50')}>
      <span className={cn('relative h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-brand-600' : 'bg-slate-300')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
      <span className="min-w-0"><span className="block text-sm font-medium text-slate-700">{label}</span>{hint && <span className="block text-[11px] text-slate-400">{hint}</span>}</span>
    </button>
  )
}

function ImageField({ f, value, onChange }: { f: FieldDef; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <Label f={f} />
      <div className="flex gap-3">
        <button type="button" onClick={() => setOpen(true)} aria-label={`Choose ${f.label}`}
          className="group relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50 transition hover:border-brand-400">
          {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-6 w-6 text-slate-300" />}
          <span className="absolute inset-0 grid place-items-center bg-slate-900/50 text-white opacity-0 transition group-hover:opacity-100"><ImagePlus className="h-5 w-5" /></span>
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <Input value={value.startsWith('data:') ? '(uploaded image)' : value} readOnly={value.startsWith('data:')} placeholder="https://… or choose from library" onChange={(e) => onChange(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-md bg-brand-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-800"><ImagePlus className="h-3.5 w-3.5" />Choose / upload</button>
            {value && <button type="button" onClick={() => onChange('')} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100"><X className="h-3.5 w-3.5" />Remove</button>}
          </div>
        </div>
      </div>
      <Hint f={f} />
      <Modal open={open} onClose={() => setOpen(false)} title="Media library" size="max-w-4xl">
        <MediaLibrary selected={value} onPick={(url) => { onChange(url); setOpen(false) }} />
      </Modal>
    </div>
  )
}

function IconField({ f, value, onChange }: { f: FieldDef; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const Icon = iconFor(value)
  const list = ICON_NAMES.filter((n) => n.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div>
      <Label f={f} />
      <button type="button" onClick={() => setOpen(true)} className="input flex items-center gap-2 text-left">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-peri-100 text-peri-800"><Icon className="h-4 w-4" /></span>
        <span className="flex-1 truncate text-sm">{value || 'Choose icon'}</span><ChevronDown className="h-4 w-4 text-slate-400" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Choose an icon" size="max-w-2xl">
        <div className="relative mb-3"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search icons…" className="pl-9" /></div>
        <div className="grid max-h-[55vh] grid-cols-4 gap-2 overflow-y-auto p-0.5 sm:grid-cols-6">
          {list.map((n) => {
            const I = iconFor(n)
            return (
              <button key={n} type="button" onClick={() => { onChange(n); setOpen(false) }} title={n}
                className={cn('flex flex-col items-center gap-1.5 rounded-lg border p-3 text-[10px] text-slate-500 transition hover:border-brand-400 hover:bg-brand-50', n === value ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200')}>
                <I className="h-5 w-5 text-peri-800" /><span className="w-full truncate">{n}</span>
              </button>
            )
          })}
          {list.length === 0 && <p className="col-span-full py-8 text-center text-sm text-slate-400">No icons match “{q}”.</p>}
        </div>
      </Modal>
    </div>
  )
}

function TagsField({ f, value, onChange }: { f: FieldDef & { placeholder?: string }; value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = (raw: string) => {
    const parts = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).filter((s) => !value.includes(s))
    if (parts.length) onChange([...value, ...parts])
    setDraft('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft) }
    else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
  }
  return (
    <div>
      <Label f={f}><span className="text-[10px] text-slate-400">{value.length} items</span></Label>
      <div className="input flex h-auto min-h-[38px] flex-wrap items-center gap-1.5 py-1.5">
        {value.map((t, i) => (
          <span key={t + i} className="inline-flex items-center gap-1 rounded-md bg-slate-100 py-0.5 pl-2 pr-1 text-xs text-slate-700">
            {t}<button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label={`Remove ${t}`}><X className="h-3 w-3" /></button>
          </span>
        ))}
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => draft && add(draft)}
          onPaste={(e) => { const t = e.clipboardData.getData('text'); if (/[,\n]/.test(t)) { e.preventDefault(); add(t) } }}
          placeholder={value.length ? '' : (f.placeholder ?? 'Type and press Enter')} className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none" />
      </div>
      <Hint f={f} />
    </div>
  )
}

function StringsField({ f, value, onChange }: { f: FieldDef & { multiline?: boolean; addLabel?: string }; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <Label f={f} />
      <div className="space-y-2">
        {value.map((s, i) => (
          <div key={i} className="flex items-start gap-1.5">
            {f.multiline
              ? <Textarea rows={3} value={s} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} className="min-h-0 flex-1" />
              : <Input value={s} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} className="flex-1" />}
            <div className={cn('flex shrink-0', f.multiline ? 'flex-col' : 'flex-row')}>
              <IconBtn label="Move up" disabled={i === 0} onClick={() => onChange(move(value, i, i - 1))}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
              <IconBtn label="Move down" disabled={i === value.length - 1} onClick={() => onChange(move(value, i, i + 1))}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
              <IconBtn label="Remove" danger onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...value, ''])} className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"><Plus className="h-3.5 w-3.5" />{f.addLabel ?? 'Add'}</button>
      <Hint f={f} />
    </div>
  )
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
function DaysField({ f, value, onChange }: { f: FieldDef; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <Label f={f} />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={f.label}>
        {WEEKDAYS.map((d) => {
          const on = value.includes(d)
          return <button key={d} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== d) : WEEKDAYS.filter((x) => x === d || value.includes(x)))}
            className={cn('h-9 w-12 rounded-lg border text-xs font-semibold transition', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300')}>{d}</button>
        })}
      </div>
      <Hint f={f} />
    </div>
  )
}

function CellsField({ f, value, onChange, ctx }: { f: FieldDef; value: string[]; onChange: (v: string[]) => void; ctx: Ctx }) {
  const pkgs: Obj[] = ctx.root?.items ?? []
  const set = (i: number, v: string) => { const n = pkgs.map((_, j) => value[j] ?? ''); n[i] = v; onChange(n) }
  return (
    <div>
      <Label f={f} />
      <div className="grid gap-2 sm:grid-cols-3">
        {pkgs.map((p, i) => {
          const v = value[i] ?? ''
          const yes = v.trim().toLowerCase() === 'yes'
          return (
            <div key={i} className={cn('rounded-lg border p-2', p.hidden ? 'border-dashed border-slate-200 opacity-60' : 'border-slate-200')}>
              <p className="mb-1.5 truncate text-[11px] font-semibold text-slate-600">{p.name || `Package ${i + 1}`}</p>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => set(i, yes ? '' : 'yes')} aria-pressed={yes} aria-label={`${p.name}: included`}
                  className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-md border transition', yes ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 text-slate-300 hover:text-slate-500')}><Check className="h-4 w-4" /></button>
                <Input value={yes ? '' : v} placeholder={yes ? 'Included' : 'Not included'} onChange={(e) => set(i, e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function IconBtn({ label, onClick, children, disabled, danger }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick() }}
      className={cn('grid h-7 w-7 place-items-center rounded-md text-slate-400 transition disabled:pointer-events-none disabled:opacity-30', danger ? 'hover:bg-rose-50 hover:text-rose-600' : 'hover:bg-slate-100 hover:text-slate-700')}>
      {children}
    </button>
  )
}

// ------------------------------------------------------------------ containers
function Group({ f, value, saved, onChange, ctx, depth }: { f: Extract<FieldDef, { t: 'group' }>; value: any; saved?: any; onChange: (v: any) => void; ctx: Ctx; depth: number }) {
  const [open, setOpen] = useState(!f.collapsed)
  const top = depth === 0
  const edited = depth < 2 && changed(value, saved)
  return (
    <section className={cn(top ? 'rounded-2xl border bg-white shadow-card transition' : 'rounded-xl border bg-brand-50/40', top && (edited ? 'border-amber-200' : 'border-[#e6e6f5]'), !top && 'border-[#e6e6f5]')}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={cn('flex w-full items-center justify-between gap-3 text-left', top ? 'px-5 py-3.5' : 'px-4 py-2.5')}>
        <span className="min-w-0">
          <span className={cn('flex items-center gap-2 font-semibold text-brand-950', top ? 'text-sm' : 'text-xs')}>{f.label}{edited && <EditedChip />}</span>
          {f.hint && <span className="mt-0.5 block text-[11px] text-slate-400">{f.hint}</span>}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className={cn('border-t border-[#efeff8]', top ? 'p-5' : 'p-4')}><FieldsForm fields={f.fields} value={value} saved={saved} onChange={onChange} ctx={ctx} depth={depth + 1} /></div>}
    </section>
  )
}

function ListField({ f, value, saved, onChange, ctx, depth }: { f: Extract<FieldDef, { t: 'list' }>; value: Obj[]; saved?: Obj[]; onChange: (v: Obj[]) => void; ctx: Ctx; depth: number }) {
  const [open, setOpen] = useState<number | null>(null)
  const edited = depth < 2 && changed(value, saved)
  // Collections with their own pages (doctors, specialities) steer the live preview to the item being edited.
  const focusPath = open !== null && f.preview && value[open] && !value[open].hidden ? f.preview(value[open]) : null
  useEffect(() => { if (f.preview) ctx.focus?.(focusPath) }, [focusPath]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (f.preview) ctx.focus?.(null) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState('')
  const [confirm, setConfirm] = useState<number | null>(null)
  const top = depth === 0
  const searchable = value.length > 8
  const visible = useMemo(() => value.map((v, i) => ({ v, i })).filter(({ v, i }) => !q || (f.title(v, i) + ' ' + (f.subtitle?.(v) ?? '')).toLowerCase().includes(q.toLowerCase())), [value, q, f])
  const hiddenCount = f.hideable ? value.filter((v) => v.hidden).length : 0

  const update = (i: number, v: Obj) => onChange(value.map((x, j) => (j === i ? v : x)))
  const add = () => { const item = f.newItem(ctx); onChange([...value, item]); setOpen(value.length); setQ('') }
  const dup = (i: number) => {
    const c = structuredClone(value[i])
    if ('slug' in c) c.slug = `${c.slug}-copy`
    if ('name' in c && typeof c.name === 'string') c.name = `${c.name} (copy)`
    onChange([...value.slice(0, i + 1), c, ...value.slice(i + 1)]); setOpen(i + 1)
  }
  const del = (i: number) => { onChange(value.filter((_, j) => j !== i)); setOpen(null); setConfirm(null) }
  const mv = (i: number, to: number) => { onChange(move(value, i, to)); if (open === i) setOpen(to); else if (open === to) setOpen(i) }

  return (
    <div className={cn(top && 'rounded-2xl border bg-white p-4 shadow-card sm:p-5', top && (edited ? 'border-amber-200' : 'border-[#e6e6f5]'))}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className={cn('flex flex-wrap items-center gap-2 font-semibold text-brand-950', top ? 'text-sm' : 'text-xs')}>{f.label} <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-800">{value.length}{hiddenCount ? ` · ${hiddenCount} hidden` : ''}</span>{edited && <EditedChip />}</p>
          {f.hint && <p className="mt-0.5 text-[11px] text-slate-400">{f.hint}</p>}
        </div>
        {searchable && (
          <div className="relative w-full sm:w-56"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${f.label.toLowerCase()}…`} className="h-8 pl-8 text-xs" /></div>
        )}
      </div>

      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400">Nothing here yet.</div>
      ) : (
        <ul className="space-y-2">
          {visible.map(({ v, i }) => {
            const isOpen = open === i
            const thumb = f.thumb?.(v)
            return (
              <li key={i} className={cn('overflow-hidden rounded-xl border transition', isOpen ? 'border-brand-400 shadow-card ring-4 ring-brand-200/50' : 'border-[#e6e6f5] hover:border-brand-200', v.hidden && 'bg-slate-50')}>
                <div className="flex items-center gap-2 pr-1.5">
                  <button type="button" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left">
                    {f.thumb && (thumb ? <img src={thumb} alt="" className="h-9 w-9 shrink-0 rounded-md bg-slate-100 object-cover" /> : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-300"><ImageIcon className="h-4 w-4" /></span>)}
                    {!f.thumb && 'icon' in v && (() => { const I = iconFor(v.icon); return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-peri-100 text-peri-800"><I className="h-4 w-4" /></span> })()}
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-sm font-medium', v.hidden ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-800')}>{f.title(v, i) || 'Untitled'}</span>
                      {f.subtitle && <span className="block truncate text-xs text-slate-400">{f.subtitle(v)}</span>}
                    </span>
                    {v.hidden && <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">Hidden</span>}
                  </button>
                  <div className="flex shrink-0 items-center">
                    {!q && <IconBtn label="Move up" disabled={i === 0} onClick={() => mv(i, i - 1)}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>}
                    {!q && <IconBtn label="Move down" disabled={i === value.length - 1} onClick={() => mv(i, i + 1)}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>}
                    {f.hideable && <IconBtn label={v.hidden ? 'Show on website' : 'Hide from website'} onClick={() => update(i, { ...v, hidden: !v.hidden })}>{v.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</IconBtn>}
                    {!f.fixed && <IconBtn label="Duplicate" onClick={() => dup(i)}><Copy className="h-3.5 w-3.5" /></IconBtn>}
                    {!f.fixed && <IconBtn label="Delete" danger onClick={() => setConfirm(i)}><Trash2 className="h-3.5 w-3.5" /></IconBtn>}
                    <ChevronDown className={cn('ml-1 h-4 w-4 text-slate-400 transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
                  </div>
                </div>
                {isOpen && (
                  <div className="border-t border-[#efeff8] bg-white p-4">
                    {focusPath && <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700"><Eye className="h-3 w-3" />Live preview is showing {focusPath}</p>}
                    <FieldsForm fields={f.item} value={v} onChange={(nv) => update(i, nv)} ctx={ctx} depth={depth + 1} />
                  </div>
                )}
              </li>
            )
          })}
          {visible.length === 0 && <li className="py-6 text-center text-sm text-slate-400">No matches for “{q}”.</li>}
        </ul>
      )}
      {!f.fixed && (
        <button type="button" onClick={add} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-brand-300 py-2.5 text-xs font-semibold text-brand-700 transition hover:border-brand-500 hover:bg-brand-50 hover:text-brand-900">
          <Plus className="h-3.5 w-3.5" />{f.addLabel ?? 'Add item'}
        </button>
      )}
      <ConfirmDialog open={confirm !== null} onClose={() => setConfirm(null)} onConfirm={() => confirm !== null && del(confirm)}
        title={`Delete “${confirm !== null ? f.title(value[confirm] ?? {}, confirm) : ''}”?`} description="It is removed from the draft. Nothing changes on the website until you publish." />
    </div>
  )
}
