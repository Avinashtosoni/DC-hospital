/**
 * Add / edit one plan: a form on the left, the website's pricing card (live preview) on the right. Saving a price change
 * for a plan hospitals are already on asks what they should pay; owners are told about price / message changes.
 */
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, Eye, Info, Plus, Save, Trash2, Users } from 'lucide-react'
import { Button, Drawer, Field, Input, Modal } from '../../../../src/components/ui'
import { Toggle } from '../../../../src/pages/cms/fields'
import { cn } from '../../../../src/lib/utils'
import { PlanCard } from '../../../../src/platform/pages/shared'
import type { Plan } from '../../../../src/platform/plans'
import type { PlanFields } from '../../types'
import { changeLines, planProblems, slugFor, type PlanStats } from './model'

export interface SaveRequest { id: string; fields: PlanFields; existing: 'apply' | 'keep'; notify: boolean }

const BLANK: PlanFields = { name: '', price: null, suffix: '', tagline: '', features: [''], highlight: false, cta: 'Get started',
  included: { sms: 0, whatsapp: 0, email: 0 }, public: true, archived: false, signup: false, order: 0 }

export function PlanEditor({ plan, start, taken, stats, saving, onSave, onClose }: {
  /** null = new plan */
  plan: Plan | null
  /** first values (a copy of another plan when duplicating) */
  start: PlanFields | null
  taken: string[]
  stats: PlanStats
  saving: boolean
  onSave: (r: SaveRequest) => void
  onClose: () => void
}) {
  const isNew = !plan
  const initial = useMemo<PlanFields>(() => structuredClone(start ?? BLANK), [start])
  const [f, setF] = useState<PlanFields>(initial)
  const [id, setId] = useState(isNew && start?.name ? slugFor(start.name, taken) : plan?.id ?? '')
  const [idTouched, setIdTouched] = useState(false)
  const [ask, setAsk] = useState(false)
  const [existing, setExisting] = useState<'apply' | 'keep'>('apply')
  const [notify, setNotify] = useState(true)
  const [showPreview, setShowPreview] = useState(false)
  const featRefs = useRef<(HTMLInputElement | null)[]>([])

  const set = (patch: Partial<PlanFields>) => setF((x) => ({ ...x, ...patch }))
  const setName = (name: string) => { set({ name }); if (isNew && !idTouched) setId(slugFor(name, taken)) }
  const clean: PlanFields = { ...f, name: f.name.trim(), tagline: f.tagline.trim(), cta: f.cta.trim(), features: f.features.map((x) => x.trim()).filter(Boolean) }
  const problems = planProblems(clean, id, isNew, taken)
  const dirty = isNew || JSON.stringify(clean) !== JSON.stringify({ ...initial, features: initial.features.filter(Boolean) })
  const lines = changeLines(isNew ? null : initial, clean)
  const affected = stats.hospitals
  const priceAffects = stats.hospitals - stats.ownPrice

  const setFeature = (i: number, v: string) => set({ features: f.features.map((x, j) => (j === i ? v : x)) })
  const addFeature = (at = f.features.length, focus = true) => {
    if (f.features.length >= 25) return
    const next = [...f.features]; next.splice(at, 0, ''); set({ features: next })
    if (focus) setTimeout(() => featRefs.current[at]?.focus(), 0)
  }
  const moveFeature = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= f.features.length) return
    const next = [...f.features]; [next[i], next[j]] = [next[j], next[i]]; set({ features: next })
  }
  const onFeatureKey = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); addFeature(i + 1) }
    if (e.key === 'Backspace' && !f.features[i] && f.features.length > 1) { e.preventDefault(); set({ features: f.features.filter((_, j) => j !== i) }); setTimeout(() => featRefs.current[Math.max(0, i - 1)]?.focus(), 0) }
  }
  // pasting several lines adds one feature per line
  const onFeaturePaste = (i: number) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const rows = e.clipboardData.getData('text').split(/\r?\n/).map((x) => x.replace(/^[\s•\-*✓]+/, '').trim()).filter(Boolean)
    if (rows.length < 2) return
    e.preventDefault()
    const next = [...f.features]; next.splice(i, f.features[i] ? 0 : 1, ...rows); set({ features: next.slice(0, 25) })
  }

  const save = () => {
    if (problems.length) return
    // hospitals on the plan and something they would hear about → ask first
    if (!isNew && affected > 0 && (lines.price || lines.other.length)) { setAsk(true); return }
    onSave({ id, fields: clean, existing: 'apply', notify: true })
  }
  const preview: Plan = { id: id || 'new', ...clean, features: clean.features.length ? clean.features : ['Your first feature'], name: clean.name || 'Plan name' }

  return (
    <Drawer open onClose={onClose} width="max-w-5xl" title={isNew ? 'New plan' : `Edit ${plan!.name}`}
      subtitle={isNew ? 'Shown on the website as soon as you save (unless you hide it).' : <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{affected ? `${affected} hospital${affected === 1 ? '' : 's'} on this plan · ${stats.paying} paying` : 'No hospital on this plan yet'}</span>}
      footer={<div className="flex w-full flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-rose-700">{problems[0] ?? ''}</p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon={<Save className="h-4 w-4" />} disabled={!dirty || problems.length > 0} loading={saving} onClick={save}>{isNew ? 'Add plan' : 'Save changes'}</Button>
        </div>
      </div>}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Basics</legend>
            <Field label="Name" required><Input value={f.name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Multi-branch" autoFocus={isNew} /></Field>
            <Field label="Plan ID" hint={isNew ? 'Used in links (/signup?plan=…). Can’t change later.' : 'Fixed — hospitals and invoices refer to it'}>
              <Input value={id} disabled={!isNew} maxLength={32} className="font-mono" onChange={(e) => { setIdTouched(true); setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')) }} />
            </Field>
            <Field label="Tagline" className="sm:col-span-2" hint={`${f.tagline.length}/160 · the line under the name`}><Input value={f.tagline} maxLength={160} onChange={(e) => set({ tagline: e.target.value })} placeholder="For growing multi-speciality hospitals" /></Field>
          </fieldset>

          <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Price</legend>
            <Field label="₹ / month" className="col-span-2" hint="Before GST · leave empty for “Let’s talk”">
              <Input type="number" inputMode="numeric" min={0} value={f.price ?? ''} placeholder="Let’s talk" onChange={(e) => set({ price: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
            <Field label="After price" hint="e.g. + for “from”"><Input value={f.suffix ?? ''} maxLength={3} placeholder="—" onChange={(e) => set({ suffix: e.target.value })} /></Field>
            <Field label="Button text"><Input value={f.cta} maxLength={40} onChange={(e) => set({ cta: e.target.value })} /></Field>
          </fieldset>

          <fieldset>
            <legend className="mb-2 flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span>Features <span className="font-normal normal-case text-slate-400">· {f.features.filter((x) => x.trim()).length}/25 · Enter adds a line, paste a list to add many</span></span>
            </legend>
            <ul className="space-y-1.5">
              {f.features.map((x, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-slate-400">{i + 1}</span>
                  <Input ref={(el) => { featRefs.current[i] = el }} value={x} maxLength={140} placeholder="Appointments & online booking" aria-label={`Feature ${i + 1}`}
                    onChange={(e) => setFeature(i, e.target.value)} onKeyDown={onFeatureKey(i)} onPaste={onFeaturePaste(i)} />
                  <div className="flex shrink-0">
                    <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => moveFeature(i, -1)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-900 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button type="button" aria-label="Move down" disabled={i === f.features.length - 1} onClick={() => moveFeature(i, 1)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-900 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                    <button type="button" aria-label="Remove" onClick={() => set({ features: f.features.length > 1 ? f.features.filter((_, j) => j !== i) : [''] })} className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} disabled={f.features.length >= 25} onClick={() => addFeature()}>Add feature</Button>
          </fieldset>

          <fieldset className="grid grid-cols-3 gap-3">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Messages included each month <span className="font-normal normal-case text-slate-400">· on the platform’s accounts; extra ones come from the wallet</span></legend>
            {(['whatsapp', 'sms', 'email'] as const).map((c) => (
              <Field key={c} label={c === 'whatsapp' ? 'WhatsApp' : c === 'sms' ? 'SMS' : 'E-mail'}>
                <Input type="number" inputMode="numeric" min={0} value={f.included[c]} onChange={(e) => set({ included: { ...f.included, [c]: Math.max(0, Math.round(Number(e.target.value) || 0)) } })} />
              </Field>
            ))}
          </fieldset>

          <fieldset className="grid gap-2 sm:grid-cols-3">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Where it shows</legend>
            <Toggle label="Show on website" hint="Pricing page & contact form" checked={f.public !== false} onChange={(v) => set({ public: v })} />
            <Toggle label="Most popular" hint="Only one plan at a time" checked={!!f.highlight} onChange={(v) => set({ highlight: v })} />
            <Toggle label="Free-trial sign-up" hint={f.price == null ? 'Needs a price' : 'Button opens sign-up'} checked={!!f.signup && f.price != null} onChange={(v) => set({ signup: v })} />
          </fieldset>

          {!isNew && (lines.price || lines.other.length > 0) && affected > 0 && (
            <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900"><Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{affected} hospital{affected === 1 ? '' : 's'} are on this plan. When you save you’ll choose what they pay{lines.price ? '' : ''} and whether to tell their owners (in-app + e-mail).</span></p>
          )}

          <button type="button" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 lg:hidden" onClick={() => setShowPreview((v) => !v)}>
            <Eye className="h-4 w-4" />{showPreview ? 'Hide preview' : 'Show website preview'}
          </button>
        </div>

        <aside className={cn('lg:block', showPreview ? 'block' : 'hidden')}>
          <div className="lg:sticky lg:top-0">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">On the website</p>
            <div className="rounded-2xl bg-[#f5f5fc] p-4 pt-6">
              <PlanCard p={preview} preview />
            </div>
            {!f.public && <p className="mt-2 text-xs text-slate-500">Hidden — only you can give this plan to a hospital.</p>}
          </div>
        </aside>
      </div>

      <Modal open={ask} onClose={() => setAsk(false)} size="max-w-lg" title={`Save changes to ${clean.name}?`}
        footer={<><Button variant="ghost" onClick={() => setAsk(false)}>Back</Button>
          <Button loading={saving} onClick={() => { onSave({ id, fields: clean, existing: lines.price ? existing : 'apply', notify }); setAsk(false) }}>Save</Button></>}>
        <div className="space-y-4 text-sm">
          {lines.price && (
            <div>
              <p className="font-medium text-brand-950">{lines.price.replace(', from your next renewal.', '')}</p>
              <p className="mt-0.5 text-xs text-slate-500">{priceAffects} of {affected} hospital{affected === 1 ? '' : 's'} pay the plan’s list price{stats.ownPrice ? ` (${stats.ownPrice} have their own agreed price and are not affected)` : ''}.</p>
              <div className="mt-3 space-y-2" role="radiogroup" aria-label="Hospitals already on the plan">
                {([['apply', 'New price for everyone', 'Existing hospitals pay it from their next renewal. New hospitals pay it straight away.'],
                  ['keep', 'Keep today’s price for existing hospitals', 'They keep the old price as their own agreed price (you can change it per hospital later). Only new hospitals pay the new price.']] as const).map(([v, t, h]) => (
                  <label key={v} className={cn('flex cursor-pointer gap-3 rounded-xl border p-3 transition', existing === v ? 'border-brand-400 bg-brand-50/60 ring-1 ring-brand-200' : 'border-slate-200 hover:bg-slate-50')}>
                    <input type="radio" name="existing" className="mt-0.5 accent-brand-700" checked={existing === v} onChange={() => setExisting(v)} />
                    <span><span className="block font-medium text-brand-950">{t}</span><span className="block text-xs text-slate-500">{h}</span></span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {lines.other.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-slate-700">{lines.other.map((l) => <li key={l}>{l}</li>)}</ul>}
          <label className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-3">
            <input type="checkbox" className="mt-0.5 accent-brand-700" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            <span><span className="block font-medium text-brand-950">Tell the owners (in-app bell + e-mail)</span>
              <span className="block text-xs text-slate-500">“{[existing === 'apply' ? lines.price : null, ...lines.other].filter(Boolean).join(' ') || 'No change they need to know about.'}” — their Billing page shows it for 30 days too.</span></span>
          </label>
        </div>
      </Modal>
    </Drawer>
  )
}
