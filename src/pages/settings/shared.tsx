import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Eye, EyeOff, ImageIcon, ImagePlus, KeyRound, Loader2, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Input, Modal } from '../../components/ui'
import { MediaLibrary } from '../cms/MediaLibrary'
import { cn, fmtDate } from '../../lib/utils'
import type { AppSettings } from '../../settings/types'
import type { SiteSettings } from '../../site/cms/types'
import { settingsStore, type SecretStatus } from '../../settings/store'
import { SECRET_FIELDS } from '../../settings/types'

export { Toggle } from '../cms/fields'

/** Everything a tab needs: the two drafts and their editors. */
export interface TabCtx {
  site: SiteSettings
  app: AppSettings
  savedApp: AppSettings
  editSite: (fn: (d: SiteSettings) => void) => void
  editApp: (fn: (d: AppSettings) => void) => void
  dirty: boolean
}

// ------------------------------------------------------------------ layout
export function Section({ title, description, icon, action, children, className }: {
  title: ReactNode; description?: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={cn('card overflow-hidden', className)}>
      <header className="flex flex-wrap items-start gap-3 border-b border-slate-100 px-5 py-4">
        {icon && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-brand-100">{icon}</span>}
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-brand-950">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}

/** Pill-style single choice. */
export function Segmented<T extends string | number>({ value, onChange, options, className, size = 'md' }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; hint?: string }[]; className?: string; size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" className={cn('inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1', className)}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} title={o.hint} onClick={() => onChange(o.value)}
          className={cn('rounded-lg font-medium transition', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === o.value ? 'bg-white text-brand-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Issues({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      {items.map((i) => <li key={i} className="flex gap-1.5"><span aria-hidden="true">•</span>{i}</li>)}
    </ul>
  )
}

// ------------------------------------------------------------------ image picker (media library)
export function ImagePicker({ label, value, onChange, hint, square = true }: { label: string; value: string; onChange: (v: string) => void; hint?: string; square?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex gap-3">
        <button type="button" onClick={() => setOpen(true)} aria-label={`Choose ${label}`}
          className={cn('group relative grid h-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:14px_14px] transition hover:border-brand-400', square ? 'w-20' : 'w-40')}>
          {value ? <img src={value} alt="" className="max-h-full max-w-full object-contain p-1.5" /> : <ImageIcon className="h-6 w-6 text-slate-300" />}
          <span className="absolute inset-0 grid place-items-center bg-slate-900/50 text-white opacity-0 transition group-hover:opacity-100"><ImagePlus className="h-5 w-5" /></span>
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <Input value={value.startsWith('data:') ? '(uploaded image)' : value} readOnly={value.startsWith('data:')} placeholder="https://… or upload" onChange={(e) => onChange(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-md bg-brand-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-800"><ImagePlus className="h-3.5 w-3.5" />Upload / choose</button>
            {value && <button type="button" onClick={() => onChange('')} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100"><X className="h-3.5 w-3.5" />Use default</button>}
          </div>
        </div>
      </div>
      {hint && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>}
      <Modal open={open} onClose={() => setOpen(false)} title={label} size="max-w-4xl">
        <MediaLibrary selected={value} onPick={(url) => { onChange(url); setOpen(false) }} />
      </Modal>
    </div>
  )
}

// ------------------------------------------------------------------ write-only credential input
export const SECRETS_QK = ['app-secrets'] as const

export function SecretInput({ name, secrets }: { name: string; secrets: SecretStatus[] | undefined }) {
  const qc = useQueryClient()
  const meta = SECRET_FIELDS[name]
  const saved = secrets?.find((s) => s.key === name)
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const [editing, setEditing] = useState(false)
  const m = useMutation({
    mutationFn: (v: string | null) => settingsStore.setSecret(name, v),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: SECRETS_QK })
      toast.success(v ? `${meta.label} saved` : `${meta.label} removed`)
      setValue(''); setEditing(false); setShow(false)
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const open = editing || !saved
  return (
    <div>
      <span className="label flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5 text-slate-400" />{meta.label}</span>
      {open ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (value.trim()) m.mutate(value.trim()) }}>
          <div className="relative min-w-0 flex-1">
            <Input type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} placeholder={meta.placeholder} className="pr-9 font-mono text-xs" aria-label={meta.label} />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide' : 'Show'} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
          </div>
          <Button type="submit" size="sm" disabled={!value.trim() || m.isPending} icon={m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}>Save</Button>
          {saved && <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(false); setValue('') }}>Cancel</Button>}
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
          <Check className="h-4 w-4 text-emerald-600" />
          <span className="font-mono text-xs text-slate-700">{saved!.hint}</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">saved {fmtDate(saved!.updated_at)}{saved!.updated_by_name ? ` by ${saved!.updated_by_name}` : ''}</span>
          <button type="button" onClick={() => setEditing(true)} className="rounded px-2 py-1 text-xs font-medium text-brand-700 hover:bg-white">Replace</button>
          <button type="button" onClick={() => m.mutate(null)} disabled={m.isPending} aria-label={`Remove ${meta.label}`} className="rounded p-1 text-slate-400 hover:bg-white hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      )}
    </div>
  )
}
