import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Inbox, Loader2, X } from 'lucide-react'
import { cn, initials, titleCase } from '../../lib/utils'

// ------------------------------------------------------------------ Button
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/20',
  secondary: 'bg-slate-900 text-white hover:bg-slate-800',
  outline: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
}
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'icon'
  loading?: boolean
  icon?: ReactNode
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-9 px-4 text-sm',
        size === 'icon' && 'h-9 w-9',
        variants[variant], className)}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  )
})

// ------------------------------------------------------------------ Inputs
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn('input', className)} {...p} />
})
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn('input min-h-[84px] resize-y', className)} {...p} />
})
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return <select ref={ref} className={cn('input pr-8', className)} {...p}>{children}</select>
})
export function Field({ label, error, hint, required, children, className }: { label: string; error?: string; hint?: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="label">{label}{required && <span className="text-rose-500"> *</span>}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-rose-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  )
}

// ------------------------------------------------------------------ Badge
export type Tone = 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'teal' | 'pink'
const tones: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-500/10',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/15',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/15',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/15',
  teal: 'bg-brand-50 text-brand-700 ring-brand-600/15',
  pink: 'bg-pink-50 text-pink-700 ring-pink-600/15',
}
export function Badge({ tone = 'slate', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  )
}
const STATUS_TONE: Record<string, Tone> = {
  active: 'green', completed: 'green', paid: 'green', available: 'green', confirmed: 'teal', discharged: 'slate',
  scheduled: 'blue', requested: 'blue', outpatient: 'blue', draft: 'slate', routine: 'slate', normal: 'slate',
  checked_in: 'violet', in_progress: 'violet', sample_collected: 'violet', inpatient: 'violet', admitted: 'violet', reserved: 'violet',
  partial: 'amber', pending: 'amber', on_leave: 'amber', unpaid: 'amber', urgent: 'amber', maintenance: 'amber', important: 'amber', follow_up: 'teal',
  cancelled: 'red', no_show: 'red', overdue: 'red', inactive: 'red', occupied: 'red', stat: 'red', emergency: 'red',
  consultation: 'blue', checkup: 'green',
}
export function StatusBadge({ value }: { value?: string | null }) {
  if (!value) return <span className="text-slate-400">—</span>
  return <Badge tone={STATUS_TONE[value] ?? 'slate'} dot>{titleCase(value)}</Badge>
}

// ------------------------------------------------------------------ Card
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('card', className)}>{children}</div>
}
export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div className="flex items-center gap-3">
        {icon && <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-600">{icon}</div>}
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

// ------------------------------------------------------------------ Avatar
const avatarColors = ['bg-sky-100 text-sky-700', 'bg-emerald-100 text-emerald-700', 'bg-violet-100 text-violet-700', 'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700', 'bg-brand-100 text-brand-700', 'bg-indigo-100 text-indigo-700']
export function Avatar({ name, size = 'md', className }: { name?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const hash = [...(name ?? '')].reduce((a, c) => a + c.charCodeAt(0), 0)
  return (
    <div className={cn('grid shrink-0 place-items-center rounded-full font-semibold', avatarColors[hash % avatarColors.length],
      size === 'sm' && 'h-7 w-7 text-[10px]', size === 'md' && 'h-9 w-9 text-xs', size === 'lg' && 'h-12 w-12 text-sm', size === 'xl' && 'h-16 w-16 text-lg', className)}>
      {initials(name)}
    </div>
  )
}

// ------------------------------------------------------------------ Skeleton / Spinner / Empty
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200/70', className)} />
}
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-brand-600', className)} />
}
export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-50 to-slate-100 text-brand-600 ring-1 ring-slate-200/70">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

// ------------------------------------------------------------------ Overlay (Modal / Drawer)
function useEsc(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', h)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = prev }
  }, [open, onClose])
}

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-xl' }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEsc(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn('relative flex h-full w-full animate-slide-in flex-col bg-white shadow-2xl', width)}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Modal({ open, onClose, title, children, footer, size = 'max-w-md' }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; size?: string }) {
  useEsc(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn('relative w-full animate-pop-in rounded-2xl bg-white shadow-2xl', size)}>
        {title && (
          <div className="flex items-center justify-between px-5 pt-5">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 rounded-b-2xl border-t border-slate-100 bg-slate-50/60 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Delete', loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; description?: string; confirmLabel?: string; loading?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button variant="danger" onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
    </>}>
      <div className="flex gap-4 pt-2">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600"><AlertTriangle className="h-5 w-5" /></div>
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ Tabs
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="scrollbar-thin flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={cn('-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition',
            value === t.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
          {t.label}
          {t.count !== undefined && <span className={cn('rounded-full px-1.5 text-[11px]', value === t.value ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500')}>{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ Page header / Stat card
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function StatCard({ label, value, icon, hint, tone = 'teal', loading }: { label: string; value: ReactNode; icon: ReactNode; hint?: ReactNode; tone?: Tone; loading?: boolean }) {
  const bg: Record<Tone, string> = {
    teal: 'from-brand-500 to-brand-600', blue: 'from-sky-500 to-sky-600', violet: 'from-violet-500 to-violet-600', amber: 'from-amber-400 to-amber-500',
    green: 'from-emerald-500 to-emerald-600', red: 'from-rose-500 to-rose-600', slate: 'from-slate-500 to-slate-600', pink: 'from-pink-500 to-pink-600',
  }
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          {loading ? <Skeleton className="mt-2 h-7 w-24" /> : <p className="mt-1.5 truncate text-xl font-semibold sm:text-2xl tracking-tight text-slate-900">{value}</p>}
          {hint && !loading && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
        <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm', bg[tone])}>{icon}</div>
      </div>
    </Card>
  )
}
