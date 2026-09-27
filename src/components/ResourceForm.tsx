import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { FieldDef, ResourceCtx, ResourceDef } from '../resources/types'
import { Button, Drawer, Field, Input, Select, Textarea } from './ui'
import { cn, money } from '../lib/utils'
import type { LineItem, Medication } from '../types'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Props {
  def: ResourceDef
  ctx: ResourceCtx
  open: boolean
  onClose: () => void
  initial?: Record<string, any> | null
  prefill?: Record<string, any>
  rows: any[]
  onSubmit: (values: Record<string, any>) => void
  saving?: boolean
}

export function buildDefaults(def: ResourceDef, ctx: ResourceCtx, rows: any[], prefill: Record<string, any> = {}) {
  const v: Record<string, any> = {}
  for (const f of def.fields) {
    const d = f.default?.(ctx, rows)
    v[f.name] = d !== undefined ? d : f.type === 'days' || f.type === 'medications' || f.type === 'line_items' ? [] : f.type === 'number' || f.type === 'currency' ? '' : ''
  }
  return { ...v, ...prefill }
}

export function ResourceFormDrawer({ def, ctx, open, onClose, initial, prefill, rows, onSubmit, saving }: Props) {
  const editing = !!initial
  const [values, setValues] = useState<Record<string, any>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setErrors({})
    setValues(initial ? { ...initial } : buildDefaults(def, ctx, rows, prefill))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const visible = useMemo(() => def.fields.filter((f) => !f.hidden?.(ctx, values, editing)), [def.fields, ctx, values, editing])
  const set = (name: string, v: unknown) => setValues((s) => ({ ...s, [name]: v }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    for (const f of visible) {
      const v = values[f.name]
      if (f.required && (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0))) errs[f.name] = `${f.label} is required`
      if ((f.type === 'number' || f.type === 'currency') && v !== '' && v != null && isNaN(Number(v))) errs[f.name] = 'Must be a number'
      if ((f.type === 'number' || f.type === 'currency') && f.min !== undefined && v !== '' && Number(v) < f.min) errs[f.name] = `Must be ≥ ${f.min}`
      if (f.type === 'email' && v && !/^\S+@\S+\.\S+$/.test(v)) errs[f.name] = 'Enter a valid email'
      if (f.type === 'medications' && Array.isArray(v) && v.some((m: Medication) => !m.name?.trim())) errs[f.name] = 'Every medicine needs a name'
      if (f.type === 'line_items' && Array.isArray(v) && v.some((m: LineItem) => !m.description?.trim())) errs[f.name] = 'Every line needs a description'
    }
    setErrors(errs)
    if (Object.keys(errs).length) return
    // normalise
    const out: Record<string, any> = {}
    for (const f of def.fields) {
      let v = values[f.name]
      if (f.type === 'number' || f.type === 'currency') v = v === '' || v == null ? (f.required ? 0 : null) : Number(v)
      else if (f.type === 'line_items') v = (v ?? []).map((it: LineItem) => ({ ...it, quantity: Number(it.quantity) || 0, unit_price: Number(it.unit_price) || 0 }))
      else if (v === '') v = null
      out[f.name] = v
    }
    onSubmit(out)
  }

  return (
    <Drawer open={open} onClose={onClose} width={def.drawerWidth}
      title={editing ? `Edit ${def.singular}` : `New ${def.singular}`}
      subtitle={editing ? 'Update the details below and save.' : 'Fill in the details below.'}
      footer={<>
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="resource-form" loading={saving}>{editing ? 'Save changes' : `Create ${def.singular.toLowerCase()}`}</Button>
      </>}>
      <form id="resource-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        {visible.map((f) => (
          <FieldInput key={f.name} f={f} ctx={ctx} values={values} value={values[f.name]} error={errors[f.name]} editing={editing} onChange={(v) => set(f.name, v)} />
        ))}
      </form>
    </Drawer>
  )
}

function FieldInput({ f, ctx, value, values, onChange, error, editing }: { f: FieldDef; ctx: ResourceCtx; value: any; values: Record<string, any>; onChange: (v: any) => void; error?: string; editing: boolean }) {
  const ro = f.readOnly?.(ctx, editing)
  const wide = f.span === 2 || ['textarea', 'medications', 'line_items', 'days'].includes(f.type)
  const common = { disabled: ro, placeholder: f.placeholder }
  let control
  switch (f.type) {
    case 'textarea':
      control = <Textarea {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      break
    case 'select':
      control = (
        <Select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      )
      break
    case 'relation': {
      const rel = f.relation!
      const opts = [...ctx.lk[rel.table].values()]
        .filter((r: any) => !rel.filter || rel.filter(r, ctx, values) || r.id === value)
        .map((r: any) => ({ value: r.id, label: rel.label(r, ctx) }))
        .sort((a, b) => a.label.localeCompare(b.label))
      control = (
        <Select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">{opts.length ? 'Select…' : 'No options available'}</option>
          {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      )
      break
    }
    case 'days':
      control = (
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d) => {
            const on = (value ?? []).includes(d)
            return (
              <button type="button" key={d} disabled={ro}
                onClick={() => onChange(on ? value.filter((x: string) => x !== d) : [...(value ?? []), d].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b)))}
                className={cn('h-8 rounded-lg border px-3 text-xs font-medium transition', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')}>
                {d}
              </button>
            )
          })}
        </div>
      )
      break
    case 'medications':
      control = <MedicationsEditor value={value ?? []} onChange={onChange} />
      break
    case 'line_items':
      control = <LineItemsEditor value={value ?? []} onChange={onChange} discount={Number(values.discount) || 0} tax={Number(values.tax) || 0} />
      break
    default:
      control = (
        <Input {...common}
          type={f.type === 'currency' ? 'number' : f.type}
          step={f.type === 'currency' ? '0.01' : undefined}
          min={f.min}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)} />
      )
  }
  return (
    <Field label={f.label} required={f.required} error={error} hint={f.hint} className={cn(wide && 'sm:col-span-2')}>
      {control}
    </Field>
  )
}

function MedicationsEditor({ value, onChange }: { value: Medication[]; onChange: (v: Medication[]) => void }) {
  const upd = (i: number, k: keyof Medication, v: string) => onChange(value.map((m, idx) => (idx === i ? { ...m, [k]: v } : m)))
  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">No medicines added yet</p>}
      {value.map((m, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 sm:grid-cols-[2fr_1fr_1.4fr_1fr_auto]">
          <Input placeholder="Medicine e.g. Paracetamol 650mg" value={m.name} onChange={(e) => upd(i, 'name', e.target.value)} className="col-span-2 sm:col-span-1" />
          <Input placeholder="Dosage" value={m.dosage} onChange={(e) => upd(i, 'dosage', e.target.value)} />
          <Input placeholder="Frequency" value={m.frequency} onChange={(e) => upd(i, 'frequency', e.target.value)} />
          <Input placeholder="Duration" value={m.duration} onChange={(e) => upd(i, 'duration', e.target.value)} />
          <Button type="button" variant="ghost" size="icon" onClick={() => onChange(value.filter((_, idx) => idx !== i))} aria-label="Remove"><Trash2 className="h-4 w-4 text-rose-500" /></Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />}
        onClick={() => onChange([...value, { name: '', dosage: '1 tab', frequency: 'Twice daily', duration: '5 days' }])}>Add medicine</Button>
    </div>
  )
}

function LineItemsEditor({ value, onChange, discount, tax }: { value: LineItem[]; onChange: (v: LineItem[]) => void; discount: number; tax: number }) {
  const upd = (i: number, k: keyof LineItem, v: string) => onChange(value.map((m, idx) => (idx === i ? { ...m, [k]: k === 'description' ? v : (v as unknown as number) } : m)))
  const subtotal = value.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0)
  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[1fr_70px_110px_90px_36px] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-slate-400 sm:grid">
        <span>Description</span><span>Qty</span><span>Unit price</span><span className="text-right">Amount</span><span />
      </div>
      {value.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">No line items yet</p>}
      {value.map((it, i) => (
        <div key={i} className="grid grid-cols-[1fr_70px_110px] items-center gap-2 sm:grid-cols-[1fr_70px_110px_90px_36px]">
          <Input placeholder="e.g. Consultation fee" value={it.description} onChange={(e) => upd(i, 'description', e.target.value)} className="col-span-3 sm:col-span-1" />
          <Input type="number" min={0} value={it.quantity} onChange={(e) => upd(i, 'quantity', e.target.value)} />
          <Input type="number" min={0} value={it.unit_price} onChange={(e) => upd(i, 'unit_price', e.target.value)} />
          <span className="text-right text-sm font-medium tabular-nums text-slate-700">{money((Number(it.quantity) || 0) * (Number(it.unit_price) || 0))}</span>
          <Button type="button" variant="ghost" size="icon" onClick={() => onChange(value.filter((_, idx) => idx !== i))} aria-label="Remove"><Trash2 className="h-4 w-4 text-rose-500" /></Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <Button type="button" variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => onChange([...value, { description: '', quantity: 1, unit_price: 0 }])}>Add line</Button>
        <div className="space-y-0.5 text-right text-sm">
          <div className="text-slate-500">Subtotal <span className="ml-3 font-medium tabular-nums text-slate-700">{money(subtotal)}</span></div>
          <div className="text-slate-500">− Discount + Tax <span className="ml-3 font-medium tabular-nums text-slate-700">{money(tax - discount)}</span></div>
          <div className="font-semibold text-slate-900">Total <span className="ml-3 tabular-nums">{money(subtotal - discount + tax)}</span></div>
        </div>
      </div>
    </div>
  )
}
