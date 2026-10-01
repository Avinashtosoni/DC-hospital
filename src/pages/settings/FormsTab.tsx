/**
 * Settings → Forms: create, edit, switch off, duplicate and delete website forms (Contact form, Patient review,
 * custom forms). Every submission goes to the Enquiries inbox, filed under its form.
 * Saves on its own (not through the sticky settings bar): each form is saved with the "Save form" button.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import {
  ArrowDown, ArrowLeft, ArrowUp, Copy, ExternalLink, Eye, FilePlus2, Inbox, Link2, Lock, MoreHorizontal, Pencil, Plus, Save, Trash2, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, ConfirmDialog, EmptyState, Field, Input, Modal, Select, Skeleton, Textarea } from '../../components/ui'
import { db } from '../../data/adapter'
import { qk, useCreate, useRemove, useTable, useUpdate } from '../../hooks/useData'
import { cn, fmtDate } from '../../lib/utils'
import type { SiteForm } from '../../types'
import { FormRenderer } from '../../forms/FormRenderer'
import {
  COLOR_CLASS, FIELD_TYPES, FORM_COLORS, FORM_TEMPLATES, LIMITS, RESERVED_SLUGS, SLUG_RE, fieldKey, formTopic, hasOptions, slugify,
  type FieldType, type FormColor, type FormField, type FormSettings,
} from '../../forms/schema'
import { Section, Toggle } from './shared'

const MAX_FIELDS = 30
const KIND_LABEL: Record<SiteForm['kind'], string> = { contact: 'Contact page', review: 'Reviews', custom: 'Custom' }
const linkOf = (f: Pick<SiteForm, 'kind' | 'slug'>) => (f.kind === 'contact' ? '/contact' : `/forms/${f.slug}`)
const absolute = (path: string) => `${window.location.origin}${path}`
const colorOf = (f: Pick<SiteForm, 'settings'>) => COLOR_CLASS[((f.settings ?? {}) as FormSettings).color ?? 'brand'] ?? COLOR_CLASS.brand
const copyLink = (path: string) => navigator.clipboard?.writeText(absolute(path)).then(() => toast.success('Link copied'), () => toast.error('Could not copy'))

/** Unique link name: "callback" → "callback-2" when taken. */
function freeSlug(base: string, taken: string[]) {
  const b = slugify(base).slice(0, 36)
  let s = b, i = 2
  while (taken.includes(s) || RESERVED_SLUGS.includes(s)) s = `${b}-${i++}`
  return s
}

export function FormsTab({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const [params, setParams] = useSearchParams()
  const editing = params.get('form') // form id, or "new"
  const [template, setTemplate] = useState<string>('blank')
  const forms = useTable('site_forms')
  const list = useMemo(() => [...(forms.data ?? [])].sort((a, b) => a.sort - b.sort || (a.created_at ?? '').localeCompare(b.created_at ?? '')), [forms.data])
  const open = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('form', id); else n.delete('form'); return n }, { replace: false })

  useEffect(() => () => onDirty(false), [onDirty])

  if (editing) {
    if (forms.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /></div>
    const form = editing === 'new' ? null : list.find((f) => f.id === editing)
    if (editing !== 'new' && !form) {
      return <EmptyState className="card py-16" title="Form not found" description="It may have been deleted." action={<Button variant="outline" onClick={() => open(null)}>Back to forms</Button>} />
    }
    return <FormEditor key={editing} form={form ?? null} template={template} all={list} onDirty={onDirty} onClose={(id) => open(id ?? null)} />
  }
  return <FormList list={list} loading={forms.isPending} onEdit={open} onNew={(t) => { setTemplate(t); open('new') }} />
}

// ====================================================================================== list
function FormList({ list, loading, onEdit, onNew }: { list: SiteForm[]; loading: boolean; onEdit: (id: string) => void; onNew: (template: string) => void }) {
  const [picker, setPicker] = useState(false)
  const [del, setDel] = useState<SiteForm | null>(null)
  const update = useUpdate('site_forms', { silent: true })
  const create = useCreate('site_forms', { label: 'Form' })
  const remove = useRemove('site_forms', { label: 'Form' })
  // submissions per form (total + unread), counted in the database
  const counts = useQueries({
    queries: list.map((f) => ({
      queryKey: [...qk('site_enquiries'), 'form-count', f.id],
      queryFn: async () => {
        const [all, unread] = await Promise.all([
          db.query('site_enquiries', { where: [['form_id', 'eq', f.id], ['status', 'neq', 'spam']], head: true }),
          db.query('site_enquiries', { where: [['form_id', 'eq', f.id], ['status', 'neq', 'spam'], ['read_at', 'is_null']], head: true }),
        ])
        return { total: all.count ?? 0, unread: unread.count ?? 0 }
      },
      staleTime: 30_000,
    })),
  })

  const duplicate = (f: SiteForm) => {
    const taken = list.map((x) => x.slug)
    create.mutate({
      slug: freeSlug(`${f.slug}-copy`, taken), name: `${f.name} (copy)`.slice(0, 80), description: f.description, kind: f.kind === 'contact' ? 'custom' : f.kind,
      enabled: false, fields: structuredClone(f.fields), settings: structuredClone(f.settings), sort: Math.max(0, ...list.map((x) => x.sort)) + 1,
    })
  }
  const toggle = (f: SiteForm) => update.mutate({ id: f.id, patch: { enabled: !f.enabled } }, {
    onSuccess: () => toast.success(f.enabled ? `${f.name} switched off` : `${f.name} is live`, { description: f.enabled ? 'Visitors can no longer send it.' : absolute(linkOf(f)) }),
  })

  return (
    <div className="space-y-6">
      <Section icon={<Inbox className="h-4 w-4" />} title="Website forms"
        description="Forms on your website. Every submission arrives in Enquiries, filed under its form — new and old messages together."
        action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setPicker(true)}>New form</Button>}>
        {loading ? (
          <div className="grid gap-3 md:grid-cols-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
        ) : list.length === 0 ? (
          <EmptyState title="No forms yet" description="Create your first form from a template." action={<Button onClick={() => setPicker(true)}>New form</Button>} />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {list.map((f, i) => {
              const c = counts[i]?.data
              const fields = f.fields as FormField[]
              return (
                <li key={f.id} className={cn('group relative flex flex-col rounded-xl border bg-white p-4 transition hover:shadow-md', f.enabled ? 'border-slate-200' : 'border-dashed border-slate-300 bg-slate-50/60')}>
                  <div className="flex items-start gap-3">
                    <span className={cn('mt-1 h-3 w-3 shrink-0 rounded-full', colorOf(f).dot)} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => onEdit(f.id)} className="truncate text-left font-semibold text-brand-950 hover:underline">{f.name}</button>
                        <Badge tone={f.kind === 'custom' ? 'slate' : 'violet'}>{KIND_LABEL[f.kind]}</Badge>
                        {!f.enabled && <Badge tone="amber">Off</Badge>}
                      </div>
                      <button type="button" onClick={() => copyLink(linkOf(f))} title="Copy link" className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-slate-500 hover:text-brand-700">
                        <Link2 className="h-3 w-3 shrink-0" />{linkOf(f)}
                      </button>
                    </div>
                    <button type="button" role="switch" aria-checked={f.enabled} aria-label={`${f.name} ${f.enabled ? 'on' : 'off'}`} onClick={() => toggle(f)}
                      className={cn('relative h-5 w-9 shrink-0 rounded-full transition', f.enabled ? 'bg-brand-600' : 'bg-slate-300')}>
                      <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', f.enabled ? 'left-[18px]' : 'left-0.5')} />
                    </button>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-slate-50 px-2 py-1.5"><dt className="text-[11px] text-slate-500">Fields</dt><dd className="font-semibold text-brand-950">{fields.length}</dd></div>
                    <Link to={`/enquiries?form=${f.id}`} className="rounded-lg bg-slate-50 px-2 py-1.5 transition hover:bg-brand-50">
                      <dt className="text-[11px] text-slate-500">Submissions</dt><dd className="font-semibold text-brand-950">{c ? c.total : '…'}</dd>
                    </Link>
                    <Link to={`/enquiries?form=${f.id}&folder=unread`} className={cn('rounded-lg px-2 py-1.5 transition', c?.unread ? 'bg-amber-50 hover:bg-amber-100' : 'bg-slate-50 hover:bg-brand-50')}>
                      <dt className="text-[11px] text-slate-500">Unread</dt><dd className={cn('font-semibold', c?.unread ? 'text-amber-700' : 'text-brand-950')}>{c ? c.unread : '…'}</dd>
                    </Link>
                  </dl>
                  <p className="mt-3 text-[11px] text-slate-400">Inbox label: <span className="font-medium text-slate-600">{f.kind === 'contact' ? 'the visitor’s topic' : formTopic(f)}</span> · edited {fmtDate(f.updated_at)}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
                    <Button size="sm" variant="outline" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onEdit(f.id)}>Edit</Button>
                    <Link to={`/enquiries?form=${f.id}`}><Button size="sm" variant="ghost" icon={<Inbox className="h-3.5 w-3.5" />}>Submissions</Button></Link>
                    <a href={linkOf(f)} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost" icon={<ExternalLink className="h-3.5 w-3.5" />} disabled={!f.enabled} title={f.enabled ? 'Open on the website' : 'Switch it on to open it'}>Open</Button></a>
                    <Button size="sm" variant="ghost" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => duplicate(f)} disabled={create.isPending}>Duplicate</Button>
                    {f.kind !== 'contact' && <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDel(f)}>Delete</Button>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Modal open={picker} onClose={() => setPicker(false)} title="New form" size="max-w-lg">
        <p className="mb-3 text-sm text-slate-500">Start from a template — you can change every field afterwards.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {FORM_TEMPLATES.map((t) => (
            <button key={t.key} type="button" onClick={() => { setPicker(false); onNew(t.key) }}
              className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-brand-300 hover:bg-brand-50/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><FilePlus2 className="h-4 w-4" /></span>
              <span><span className="block text-sm font-semibold text-brand-950">{t.label}</span><span className="block text-xs text-slate-500">{t.hint}</span></span>
            </button>
          ))}
        </div>
      </Modal>

      <ConfirmDialog open={!!del} onClose={() => setDel(null)} loading={remove.isPending} title={`Delete “${del?.name}”?`}
        description="The form disappears from your website. Messages already sent with it stay in Enquiries (filed under its name)."
        onConfirm={() => del && remove.mutate(del.id, { onSettled: () => setDel(null) })} />
    </div>
  )
}

// ====================================================================================== editor
type Draft = { slug: string; name: string; description: string; kind: SiteForm['kind']; enabled: boolean; fields: FormField[]; settings: FormSettings; sort: number }
const toDraft = (f: Pick<SiteForm, 'slug' | 'name' | 'description' | 'kind' | 'enabled' | 'fields' | 'settings' | 'sort'>): Draft => ({
  slug: f.slug, name: f.name, description: f.description ?? '', kind: f.kind, enabled: f.enabled,
  fields: structuredClone(f.fields as FormField[]), settings: structuredClone((f.settings ?? {}) as FormSettings), sort: f.sort,
})
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function problems(d: Draft, others: SiteForm[]): Record<string, string> {
  const e: Record<string, string> = {}
  if (d.name.trim().length < 2 || d.name.length > 80) e.name = 'Give the form a name (2–80 characters)'
  if (d.kind !== 'contact') {
    if (!SLUG_RE.test(d.slug)) e.slug = 'Use lowercase letters, numbers and dashes (e.g. health-camp)'
    else if (RESERVED_SLUGS.includes(d.slug)) e.slug = 'This link name is reserved'
    else if (others.some((o) => o.slug === d.slug)) e.slug = 'Another form already uses this link'
  }
  if (d.description.length > 500) e.description = 'Keep it under 500 characters'
  if (!d.fields.some((f) => f.role === 'name') || !d.fields.some((f) => f.role === 'phone')) e.fields = 'A form needs its name and mobile fields so the team can reply'
  for (const f of d.fields) {
    if (!f.label.trim()) e[`f:${f.id}`] = 'Every field needs a question / label'
    else if (hasOptions(f.type) && !f.optionsFrom && !(f.role === 'topic' && d.kind === 'contact') && !(f.options ?? []).some((o) => o.trim())) e[`f:${f.id}`] = 'Add at least one option'
    else if ((f.options ?? []).length > LIMITS.options) e[`f:${f.id}`] = `At most ${LIMITS.options} options`
  }
  return e
}

function FormEditor({ form, template, all, onDirty, onClose }: {
  form: SiteForm | null; template: string; all: SiteForm[]; onDirty: (d: boolean) => void; onClose: (id?: string) => void
}) {
  const base = useMemo<Draft>(() => {
    if (form) return toDraft(form)
    const t = (FORM_TEMPLATES.find((x) => x.key === template) ?? FORM_TEMPLATES[0]).make()
    return toDraft({ ...t, slug: freeSlug(t.slug, all.map((f) => f.slug)), sort: Math.max(0, ...all.map((f) => f.sort)) + 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.id, form?.updated_at])
  const [d, setD] = useState<Draft>(base)
  const [saved, setSaved] = useState<Draft>(base)
  const [showErrors, setShowErrors] = useState(false)
  const [openField, setOpenField] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [slugTouched, setSlugTouched] = useState(!!form)
  const create = useCreate('site_forms', { silent: true })
  const update = useUpdate('site_forms', { silent: true })
  const dirty = !same(d, saved) || !form
  useEffect(() => { onDirty(!same(d, saved)) }, [d, saved, onDirty])

  const others = all.filter((f) => f.id !== form?.id)
  const errs = problems(d, others)
  const shown = showErrors ? errs : {}
  const edit = (fn: (x: Draft) => void) => setD((p) => { const n = structuredClone(p); fn(n); return n })
  const editField = (id: string, fn: (f: FormField) => void) => edit((x) => { const f = x.fields.find((y) => y.id === id); if (f) fn(f) })
  const move = (i: number, by: number) => edit((x) => { const j = i + by; if (j < 0 || j >= x.fields.length) return; [x.fields[i], x.fields[j]] = [x.fields[j], x.fields[i]] })
  const removeField = (id: string) => edit((x) => { x.fields = x.fields.filter((f) => f.id !== id) })

  const addField = (type: FieldType) => {
    setAdding(false)
    const label = FIELD_TYPES.find((t) => t.type === type)!.label
    const f: FormField = { id: fieldKey(label, d.fields.map((x) => x.id)), type, label: type === 'consent' ? 'I agree to be contacted about this.' : type === 'rating' ? 'How would you rate us?' : label, width: 'full' }
    if (hasOptions(type)) f.options = ['Option 1', 'Option 2']
    // first email / long-text field fills the inbox's email / message columns
    if (type === 'email' && !d.fields.some((x) => x.role === 'email')) { f.role = 'email'; f.width = 'half' }
    if (type === 'textarea' && !d.fields.some((x) => x.role === 'message')) f.role = 'message'
    edit((x) => { x.fields.push(f) })
    setOpenField(f.id)
  }

  const save = async () => {
    setShowErrors(true)
    if (Object.keys(errs).length) { toast.error('Please fix the highlighted fields', { description: Object.values(errs)[0] }); return }
    const row = {
      slug: d.kind === 'contact' ? 'contact' : d.slug, name: d.name.trim(), description: d.description.trim() || null, kind: d.kind, enabled: d.enabled,
      fields: d.fields.map((f) => ({ ...f, label: f.label.trim(), options: hasOptions(f.type) ? (f.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined })),
      settings: Object.fromEntries(Object.entries(d.settings).filter(([, v]) => v !== '' && v != null)), sort: d.sort,
    }
    try {
      if (form) await update.mutateAsync({ id: form.id, patch: row })
      else {
        const created = await create.mutateAsync(row)
        setSaved(d)
        toast.success('Form created', { description: d.enabled ? absolute(linkOf(row)) : 'It is off — switch it on when it is ready.' })
        onDirty(false)
        onClose(created.id)
        return
      }
      setSaved(d)
      toast.success('Form saved', { description: d.enabled ? 'Live on the website now.' : 'The form is off.' })
    } catch { /* toast shown by the hook */ }
  }

  // live preview gets the draft; re-mounted only when fields are added / removed / reordered
  const preview = useMemo(() => ({ id: form?.id ?? 'preview', created_at: '', updated_at: '', ...d, description: d.description || null } as SiteForm), [d, form?.id])
  const s = d.settings
  const isContact = d.kind === 'contact'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => { if (!same(d, saved) && !window.confirm('Discard your unsaved changes to this form?')) return; onDirty(false); onClose() }}>All forms</Button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold text-brand-950">{d.name.trim() || (form ? 'Untitled form' : 'New form')}</h3>
          <p className="text-xs text-slate-500">{form ? <>Link: <a href={linkOf(d)} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">{linkOf(d)}</a></> : 'Not saved yet'}</p>
        </div>
        {form && <Link to={`/enquiries?form=${form.id}`}><Button variant="outline" size="sm" icon={<Inbox className="h-4 w-4" />}>Submissions</Button></Link>}
        {form && !same(d, saved) && <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} onClick={() => setD(saved)}>Discard</Button>}
        <Button icon={<Save className="h-4 w-4" />} loading={create.isPending || update.isPending} disabled={!dirty} onClick={save}>{form ? 'Save form' : 'Create form'}</Button>
      </div>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="min-w-0 space-y-5">
          <Section title="Details" description="Name, link and what visitors see after sending.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Form name" required error={shown.name}>
                <Input value={d.name} maxLength={80} onChange={(e) => { const v = e.target.value; edit((x) => { x.name = v; if (!slugTouched && !isContact) x.slug = freeSlug(v || 'form', others.map((o) => o.slug)) }) }} />
              </Field>
              <Field label="Link" error={shown.slug} hint={isContact ? 'The Contact page form always lives at /contact' : absolute(`/forms/${d.slug || '…'}`)}>
                <div className="flex items-center rounded-lg border border-[#e0e0f2] bg-slate-50 pl-3 text-sm text-slate-400 focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-100">
                  {isContact ? <span className="flex items-center gap-1.5 py-2 text-slate-500"><Lock className="h-3.5 w-3.5" />/contact</span> : <>/forms/
                    <input value={d.slug} maxLength={40} onChange={(e) => { setSlugTouched(true); edit((x) => { x.slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }) }} onBlur={() => edit((x) => { x.slug = slugify(x.slug) })}
                      className="min-w-0 flex-1 rounded-r-lg bg-white px-1 py-2 text-slate-800 outline-none" aria-label="Link name" /></>}
                </div>
              </Field>
              <Field label="Description" className="sm:col-span-2" error={shown.description} hint="Shown under the title on the form page">
                <Textarea rows={2} maxLength={500} value={d.description} onChange={(e) => edit((x) => { x.description = e.target.value })} />
              </Field>
              <Field label="Inbox label" hint={isContact ? 'The Contact form uses the topic the visitor picks' : `Shown on messages in Enquiries (empty = “${d.name || 'form name'}”)`}>
                <Input value={s.topic ?? ''} maxLength={60} disabled={isContact} placeholder={isContact ? 'Visitor’s topic' : d.name} onChange={(e) => edit((x) => { x.settings.topic = e.target.value })} />
              </Field>
              <div>
                <span className="label">Colour in the inbox</span>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
                  {FORM_COLORS.map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={(s.color ?? 'brand') === c} aria-label={c} onClick={() => edit((x) => { x.settings.color = c as FormColor })}
                      className={cn('grid h-8 w-8 place-items-center rounded-full ring-offset-2 transition', COLOR_CLASS[c].solid, (s.color ?? 'brand') === c ? 'ring-2 ring-brand-900' : 'hover:scale-110')} />
                  ))}
                </div>
              </div>
              <Field label="Submit button"><Input value={s.submitLabel ?? ''} maxLength={40} placeholder="Submit" onChange={(e) => edit((x) => { x.settings.submitLabel = e.target.value })} /></Field>
              <Field label="Thank-you title"><Input value={s.successTitle ?? ''} maxLength={80} placeholder="Thank you, <first name>!" onChange={(e) => edit((x) => { x.settings.successTitle = e.target.value })} /></Field>
              <Field label="Thank-you message" className="sm:col-span-2" hint={isContact ? 'Empty = the text in Website CMS → Contact page' : undefined}>
                <Textarea rows={2} maxLength={300} value={s.successText ?? ''} onChange={(e) => edit((x) => { x.settings.successText = e.target.value })} />
              </Field>
              <div className="sm:col-span-2"><Toggle label="Live on the website" hint={d.enabled ? 'Visitors can open and send this form' : 'Hidden — the link shows “page not found”'} checked={d.enabled} onChange={(v) => edit((x) => { x.enabled = v })} /></div>
            </div>
          </Section>

          <Section title={`Fields (${d.fields.length})`} description="Name and mobile are always asked so the team can reply. Click a field to edit it."
            action={<Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} disabled={d.fields.length >= MAX_FIELDS} onClick={() => setAdding((v) => !v)}>Add field</Button>}>
            {shown.fields && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{shown.fields}</p>}
            {adding && (
              <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-brand-100 bg-brand-50/50 p-3 sm:grid-cols-3 lg:grid-cols-4">
                {FIELD_TYPES.map((t) => (
                  <button key={t.type} type="button" onClick={() => addField(t.type)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-brand-300 hover:shadow-sm">
                    <span className="block text-sm font-medium text-brand-950">{t.label}</span><span className="block text-[11px] text-slate-500">{t.hint}</span>
                  </button>
                ))}
              </div>
            )}
            <ol className="space-y-2">
              {d.fields.map((f, i) => (
                <FieldRow key={f.id} f={f} index={i} count={d.fields.length} open={openField === f.id} error={shown[`f:${f.id}`]} contact={isContact}
                  onToggle={() => setOpenField((o) => (o === f.id ? null : f.id))} onMove={(by) => move(i, by)} onRemove={() => removeField(f.id)} onEdit={(fn) => editField(f.id, fn)} />
              ))}
            </ol>
          </Section>
        </div>

        <div className="min-w-0">
          <div className="2xl:sticky 2xl:top-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-600"><Eye className="h-4 w-4" />Live preview <span className="text-xs font-normal text-slate-400">— try it, nothing is sent</span></div>
            <div className="rounded-2xl border border-slate-200 bg-[#fbfbff] p-5 sm:p-7">
              <FormRenderer key={d.fields.map((f) => f.id).join('|')} form={preview} idPrefix="pv" preview />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ one field in the builder
const TYPE_LABEL = Object.fromEntries(FIELD_TYPES.map((t) => [t.type, t.label])) as Record<FieldType, string>
const ROLE_LABEL: Record<string, string> = { name: 'Name', phone: 'Mobile', email: 'Email column', message: 'Message column', topic: 'Topic', speciality: 'Speciality' }

function FieldRow({ f, index, count, open, error, contact, onToggle, onMove, onRemove, onEdit }: {
  f: FormField; index: number; count: number; open: boolean; error?: string; contact: boolean
  onToggle: () => void; onMove: (by: number) => void; onRemove: () => void; onEdit: (fn: (f: FormField) => void) => void
}) {
  const locked = f.role === 'name' || f.role === 'phone'
  const typeChoices = FIELD_TYPES.filter((t) => (f.role === 'email' ? t.type === 'email' : f.role === 'message' ? t.type === 'textarea' || t.type === 'text' : true))
  const cmsTopics = contact && f.role === 'topic'
  return (
    <li className={cn('rounded-xl border bg-white transition', open ? 'border-brand-300 shadow-sm' : error ? 'border-rose-300' : 'border-slate-200')}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-slate-100 text-[11px] font-semibold text-slate-500">{index + 1}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-slate-800">{f.label || <em className="text-slate-400">No label</em>}{(f.required || locked) && <span className="text-rose-500"> *</span>}</span>
            <span className="flex flex-wrap items-center gap-1 text-[11px] text-slate-400">{TYPE_LABEL[f.type]}{f.width === 'half' && ' · half width'}
              {f.role && <span className="rounded bg-violet-50 px-1.5 text-violet-700">{ROLE_LABEL[f.role]}</span>}
              {locked && <Lock className="h-3 w-3" aria-label="Always asked" />}</span>
          </span>
        </button>
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
        {!locked && <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-500 hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove ${f.label}`} onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>}
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Edit field" onClick={onToggle}><MoreHorizontal className="h-3.5 w-3.5" /></Button>
      </div>
      {error && !open && <p className="px-3 pb-2 text-xs text-rose-600">{error}</p>}
      {open && (
        <div className="grid gap-3 border-t border-slate-100 p-3 sm:grid-cols-2">
          <Field label={f.type === 'consent' ? 'Agreement text' : 'Question / label'} className="sm:col-span-2" error={error}>
            {f.type === 'consent'
              ? <Textarea rows={2} maxLength={300} value={f.label} onChange={(e) => onEdit((x) => { x.label = e.target.value })} />
              : <Input value={f.label} maxLength={120} onChange={(e) => onEdit((x) => { x.label = e.target.value })} />}
          </Field>
          <Field label="Type" hint={locked ? 'Name and mobile can’t change type' : undefined}>
            <Select value={f.type} disabled={locked} onChange={(e) => onEdit((x) => { x.type = e.target.value as FieldType; if (hasOptions(x.type) && !x.options?.length) x.options = ['Option 1', 'Option 2'] })}>
              {typeChoices.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Width">
            <Select value={f.width ?? 'full'} onChange={(e) => onEdit((x) => { x.width = e.target.value as 'full' | 'half' })}>
              <option value="full">Full width</option><option value="half">Half width</option>
            </Select>
          </Field>
          {!['radio', 'checkboxes', 'rating', 'consent'].includes(f.type) && (
            <Field label="Placeholder"><Input value={f.placeholder ?? ''} maxLength={80} onChange={(e) => onEdit((x) => { x.placeholder = e.target.value || undefined })} /></Field>
          )}
          {f.type !== 'consent' && <Field label="Help text"><Input value={f.help ?? ''} maxLength={160} onChange={(e) => onEdit((x) => { x.help = e.target.value || undefined })} /></Field>}
          {hasOptions(f.type) && (
            <div className="space-y-2 sm:col-span-2">
              {f.type !== 'checkboxes' && !cmsTopics && (
                <Toggle label="Use the hospital’s specialities" hint="From Website CMS → Services, always up to date" checked={f.optionsFrom === 'services'}
                  onChange={(v) => onEdit((x) => { x.optionsFrom = v ? 'services' : undefined })} />
              )}
              {f.optionsFrom !== 'services' && (
                <Field label="Options (one per line)" hint={cmsTopics ? 'Leave empty to use the topics from Website CMS → Contact page' : `Up to ${LIMITS.options}`}>
                  <Textarea rows={4} value={(f.options ?? []).join('\n')} onChange={(e) => onEdit((x) => { x.options = e.target.value.split('\n').map((o) => o.slice(0, 80)).slice(0, LIMITS.options) })} />
                </Field>
              )}
            </div>
          )}
          <div className="sm:col-span-2">
            <Toggle label="Required" hint={locked ? 'Always required' : f.type === 'consent' ? 'Visitors must tick it to send' : 'Visitors must answer this'}
              checked={!!f.required || locked} onChange={(v) => { if (!locked) onEdit((x) => { x.required = v }) }} />
          </div>
        </div>
      )}
    </li>
  )
}
