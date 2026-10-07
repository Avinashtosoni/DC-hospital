/**
 * Renders any website form (Settings → Forms) — on the Contact page, at /forms/:slug and as the live preview in the
 * form editor. Validates with the same rules as the database, then shows the form's own thank-you screen.
 */
import { Fragment, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Loader2, Send, Star } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../lib/utils'
import { useFormLists } from '../site/cms/content'
import type { SiteForm } from '../types'
import { submitForm } from './api'
import { LIMITS, validateAnswers, type Answers, type FieldErrors, type FormField, type FormSettings } from './schema'

/** Resolves option lists that come from the CMS (Contact topics, specialities). */
export function useOptionsFor() {
  const lists = useFormLists()
  return useMemo(() => (f: FormField): string[] => {
    if (f.optionsFrom === 'services') return lists.services
    if (f.role === 'topic' && !(f.options ?? []).length) return lists.topics.length ? lists.topics : ['General enquiry']
    return (f.options ?? []).filter((o) => o.trim())
  }, [lists])
}

const RATING_WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent']

function initialAnswers(fields: FormField[], optionsFor: (f: FormField) => string[]): Answers {
  const a: Answers = {}
  for (const f of fields) if (f.role === 'topic' && f.type === 'radio') a[f.id] = optionsFor(f)[0] ?? ''
  return a
}

/** "…accept the privacy policy." → the words "privacy policy" link to /privacy */
function ConsentText({ text }: { text: string }) {
  const m = text.match(/privacy policy/i)
  if (!m || m.index == null) return <>{text}</>
  return <>{text.slice(0, m.index)}<Link to="/privacy" target="_blank" className="font-semibold text-peri-700 underline-offset-2 hover:underline">{m[0]}</Link>{text.slice(m.index + m[0].length)}</>
}

export interface FormRendererProps {
  form: SiteForm
  /** prefix for input ids (focus targets) */
  idPrefix?: string
  title?: ReactNode
  note?: ReactNode
  /** editor preview: validates but never sends */
  preview?: boolean
  /** extra buttons on the thank-you screen */
  successActions?: ReactNode
  /** thank-you text when the form has none (the Contact form uses Website CMS → Contact page) */
  fallbackSuccessText?: string
  className?: string
}

export function FormRenderer({ form, idPrefix = 'f', title, note, preview, successActions, fallbackSuccessText, className }: FormRendererProps) {
  const fields = form.fields as FormField[]
  const s = (form.settings ?? {}) as FormSettings
  const optionsFor = useOptionsFor()
  const [a, setA] = useState<Answers>(() => initialAnswers(fields, optionsFor))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [ref, setRef] = useState('')

  const up = (id: string, v: Answers[string]) => {
    const next = { ...a, [id]: v }
    setA(next)
    if (touched) setErrors(validateAnswers(fields, next, optionsFor))
  }
  const fid = (f: FormField) => `${idPrefix}-${f.id}`

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    const errs = validateAnswers(fields, a, optionsFor)
    setErrors(errs)
    const first = fields.find((f) => errs[f.id])
    if (first) {
      toast.error('Please fix the highlighted fields')
      document.getElementById(fid(first))?.focus()
      return
    }
    if (preview) { toast.success('Looks good — this is a preview, nothing was sent'); return }
    setState('sending')
    try {
      setRef(await submitForm(form, a, optionsFor))
    } catch (err) {
      setState('idle')
      toast.error('Could not send', { description: err instanceof Error ? err.message : 'Please try again' })
      return
    }
    setState('done')
    toast.success(s.successTitle || 'Sent — thank you!')
  }

  const reset = () => { setA(initialAnswers(fields, optionsFor)); setErrors({}); setTouched(false); setState('idle') }
  const nameField = fields.find((f) => f.role === 'name')
  const phoneField = fields.find((f) => f.role === 'phone')
  const firstName = nameField ? String(a[nameField.id] ?? '').trim().split(/\s+/)[0] : ''

  if (state === 'done') {
    return (
      <div className={cn('relative flex min-h-[420px] animate-pop-in flex-col items-center justify-center text-center', className)} role="status">
        <span className="relative grid h-20 w-20 place-items-center">
          <span className="motion-safe-only absolute inset-0 animate-pulse-ring rounded-full bg-emerald-300" />
          <span className="relative grid h-20 w-20 place-items-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30"><CheckCircle2 className="h-10 w-10" /></span>
        </span>
        <h2 className="mt-8 font-display text-2xl font-bold text-peri-900 sm:text-3xl">{s.successTitle?.trim() || `Thank you${firstName ? `, ${firstName}` : ''}!`}</h2>
        <p className="mt-3 max-w-sm text-slate-600">
          {s.successText?.trim() || fallbackSuccessText || 'We have received your details and will get back to you soon.'}
          {phoneField && a[phoneField.id] && <span className="mt-1 block text-sm">We’ll reach you on <strong className="text-peri-900">{String(a[phoneField.id])}</strong>.</span>}
        </p>
        {ref && <p className="mt-6 rounded-full bg-peri-50 px-4 py-2 text-sm text-peri-800">Reference: <strong>{ref}</strong></p>}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={reset} className="btn-ghost">Send another</button>
          {successActions}
        </div>
      </div>
    )
  }

  const input = (f: FormField) => cn(
    'block w-full rounded-2xl border bg-white px-4 py-3 text-sm text-peri-900 outline-none transition placeholder:text-slate-400 focus:ring-4',
    errors[f.id] ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100' : 'border-peri-200 focus:border-peri-500 focus:ring-peri-200/60',
  )
  const aria = (f: FormField) => ({ 'aria-invalid': !!errors[f.id] || undefined, 'aria-describedby': errors[f.id] ? `${fid(f)}-err` : f.help ? `${fid(f)}-help` : undefined })
  const required = (f: FormField) => !!f.required || f.role === 'name' || f.role === 'phone'
  const Label = ({ f, as = 'label', extra }: { f: FormField; as?: 'label' | 'legend'; extra?: ReactNode }) => {
    const Tag = as
    return (
      <Tag {...(as === 'label' ? { htmlFor: fid(f) } : {})} className="mb-1.5 flex justify-between gap-2 text-xs font-semibold text-peri-900">
        <span>{f.label}{required(f) ? ' *' : <span className="font-normal text-slate-400"> (optional)</span>}</span>{extra}
      </Tag>
    )
  }
  const Foot = ({ f }: { f: FormField }) => (
    <>
      {f.help && !errors[f.id] && <p id={`${fid(f)}-help`} className="mt-1.5 text-xs text-slate-500">{f.help}</p>}
      {errors[f.id] && <p id={`${fid(f)}-err`} className="mt-1.5 animate-fade-in text-xs font-medium text-rose-600">{errors[f.id]}</p>}
    </>
  )
  const chip = (on: boolean) => cn('cursor-pointer rounded-full border px-4 py-2 text-xs font-semibold transition focus-within:ring-4 focus-within:ring-peri-200',
    on ? 'border-peri-800 bg-peri-800 text-white' : 'border-peri-200 bg-white text-slate-600 hover:border-peri-400')

  const renderField = (f: FormField) => {
    const v = a[f.id]
    const str = v == null ? '' : String(v)
    switch (f.type) {
      case 'textarea':
        return <><Label f={f} extra={<span className="font-normal text-slate-400">{str.length}/{LIMITS.textarea}</span>} />
          <textarea id={fid(f)} rows={5} maxLength={LIMITS.textarea} value={str} onChange={(e) => up(f.id, e.target.value)} placeholder={f.placeholder} className={cn(input(f), 'resize-y')} {...aria(f)} /></>
      case 'phone':
        return <><Label f={f} />
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-500">+91</span>
            <input id={fid(f)} value={str} onChange={(e) => up(f.id, e.target.value.replace(/[^\d\s+-]/g, ''))} inputMode="tel" autoComplete={f.role === 'phone' ? 'tel-national' : 'off'} placeholder={f.placeholder} maxLength={16} className={cn(input(f), 'pl-12')} {...aria(f)} />
          </div></>
      case 'select': {
        const opts = optionsFor(f)
        return <><Label f={f} />
          <select id={fid(f)} value={str} onChange={(e) => up(f.id, e.target.value)} className={cn(input(f), 'cursor-pointer')} {...aria(f)}>
            <option value="">{f.placeholder || 'Select…'}</option>
            {opts.map((o) => <option key={o}>{o}</option>)}
          </select></>
      }
      case 'radio':
        return <fieldset><Label f={f} as="legend" />
          <div className="flex flex-wrap gap-2">
            {optionsFor(f).map((o, i) => (
              <label key={o} className={chip(str === o)}>
                <input id={i === 0 ? fid(f) : undefined} type="radio" name={fid(f)} value={o} checked={str === o} onChange={() => up(f.id, o)} className="sr-only" />{o}
              </label>
            ))}
          </div></fieldset>
      case 'checkboxes': {
        const list = Array.isArray(v) ? v : []
        return <fieldset><Label f={f} as="legend" />
          <div className="flex flex-wrap gap-2">
            {optionsFor(f).map((o, i) => (
              <label key={o} className={chip(list.includes(o))}>
                <input id={i === 0 ? fid(f) : undefined} type="checkbox" checked={list.includes(o)} onChange={(e) => up(f.id, e.target.checked ? [...list, o] : list.filter((x) => x !== o))} className="sr-only" />{o}
              </label>
            ))}
          </div></fieldset>
      }
      case 'rating': {
        const n = Number(v) || 0
        return <fieldset><Label f={f} as="legend" />
          <div className="flex items-center gap-1" role="radiogroup" aria-label={f.label}>
            {[1, 2, 3, 4, 5].map((i) => (
              <button key={i} id={i === 1 ? fid(f) : undefined} type="button" role="radio" aria-checked={n === i} aria-label={`${i} star${i > 1 ? 's' : ''} — ${RATING_WORDS[i]}`}
                onClick={() => up(f.id, i)} className="rounded-lg p-1 transition hover:scale-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-peri-200">
                <Star className={cn('h-8 w-8', i <= n ? 'fill-amber-400 text-amber-400' : 'text-peri-200')} />
              </button>
            ))}
            <span className="ml-2 text-sm font-semibold text-peri-800">{RATING_WORDS[n]}</span>
          </div></fieldset>
      }
      case 'consent':
        return <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-600">
          <input id={fid(f)} type="checkbox" checked={v === true} onChange={(e) => up(f.id, e.target.checked)} className="mt-0.5 h-4 w-4 cursor-pointer rounded border-peri-300 accent-peri-800" {...aria(f)} />
          <span><ConsentText text={f.label} />{required(f) ? ' *' : ''}</span>
        </label>
      default: {
        const type = f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'
        const auto = f.role === 'name' ? 'name' : f.role === 'email' ? 'email' : undefined
        return <><Label f={f} />
          <input id={fid(f)} type={type} value={str} onChange={(e) => up(f.id, e.target.value)} placeholder={f.placeholder} autoComplete={auto}
            maxLength={f.type === 'text' || f.type === 'email' ? LIMITS.text : undefined} inputMode={f.type === 'number' ? 'decimal' : undefined} className={input(f)} {...aria(f)} /></>
      }
    }
  }

  return (
    <form onSubmit={submit} noValidate className={cn('relative', className)} aria-label={form.name}>
      {title !== undefined ? title : <h2 className="font-display text-2xl font-bold text-peri-900 sm:text-3xl">{form.name}</h2>}
      {note !== undefined ? note : form.description && <p className="mt-2 text-sm text-slate-500">{form.description}</p>}
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        {fields.map((f) => (
          <Fragment key={f.id}>
            <div className={f.width === 'half' && f.type !== 'consent' ? '' : 'sm:col-span-2'}>
              {renderField(f)}
              <Foot f={f} />
            </div>
          </Fragment>
        ))}
      </div>
      <button type="submit" disabled={state === 'sending'} className="btn-peri mt-8 w-full sm:w-auto disabled:opacity-70">
        {state === 'sending' ? <><Loader2 className="h-4 w-4 animate-spin" />Sending…</> : <><Send className="h-4 w-4" />{s.submitLabel?.trim() || 'Submit'}</>}
      </button>
    </form>
  )
}
