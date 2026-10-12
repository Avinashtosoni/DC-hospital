/** Building blocks shared by the sign-in, sign-up and password-reset screens. */
import { forwardRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { AlertCircle, ArrowUpFromLine, Eye, EyeOff, Lock } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useT } from '../../i18n'

type InputProps = InputHTMLAttributes<HTMLInputElement>

/** Text input with an icon on the left (and an optional control on the right). */
export const IconInput = forwardRef<HTMLInputElement, InputProps & { icon: ReactNode; right?: ReactNode }>(function IconInput({ icon, right, className, ...p }, ref) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-0 grid w-10 place-items-center text-slate-400 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <input ref={ref} className={cn('input h-11 pl-10', right ? 'pr-11' : '', className)} {...p} />
      {right && <span className="absolute inset-y-0 right-0 grid w-11 place-items-center">{right}</span>}
    </div>
  )
})

/** Password field: lock icon, show / hide toggle and a Caps Lock warning. */
export const PasswordInput = forwardRef<HTMLInputElement, InputProps>(function PasswordInput(p, ref) {
  const { t } = useT()
  const [show, setShow] = useState(false)
  const [caps, setCaps] = useState(false)
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false)
  return (
    <div>
      <IconInput ref={ref} icon={<Lock />} type={show ? 'text' : 'password'} {...p} onKeyUp={onKey} onKeyDown={onKey} onBlur={(e) => { setCaps(false); p.onBlur?.(e) }}
        right={
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? t('Hide password') : t('Show password')} aria-pressed={show}
            className="grid h-8 w-8 place-items-center rounded-md text-slate-400 transition hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        } />
      {caps && <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-amber-700"><ArrowUpFromLine className="h-3.5 w-3.5" />{t('Caps Lock is on')}</p>}
    </div>
  )
})

/** 0–4 score: length, mixed case, digits, symbols. */
export function passwordScore(pw: string) {
  if (!pw) return 0
  let s = 0
  if (pw.length >= 8) s++
  if (pw.length >= 12) s++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++
  if (pw.length < 8) s = Math.min(s, 1)
  return Math.min(4, s)
}
const LEVELS = [
  { label: 'Too short', bar: 'bg-rose-500', text: 'text-rose-600' },
  { label: 'Weak', bar: 'bg-rose-500', text: 'text-rose-600' },
  { label: 'Fair', bar: 'bg-amber-500', text: 'text-amber-700' },
  { label: 'Good', bar: 'bg-brand-500', text: 'text-brand-700' },
  { label: 'Strong', bar: 'bg-emerald-500', text: 'text-emerald-700' },
]
export function PasswordStrength({ value }: { value: string }) {
  const { t } = useT()
  if (!value) return <p className="mt-1.5 text-xs text-slate-400">{t('At least 8 characters. Mix letters, numbers and a symbol.')}</p>
  const s = passwordScore(value)
  const lvl = value.length < 8 ? LEVELS[0] : LEVELS[Math.max(1, s)]
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1">{[1, 2, 3, 4].map((i) => <span key={i} className={cn('h-1 flex-1 rounded-full transition-colors', i <= Math.max(1, s) ? lvl.bar : 'bg-slate-200')} />)}</div>
      <p className={cn('mt-1 text-xs font-medium', lvl.text)}>{t(lvl.label)}{value.length < 8 && ` · ${t('{n} more characters', { n: 8 - value.length })}`}</p>
    </div>
  )
}

/** Error box that shakes when a new message arrives. */
export function FormError({ message, className }: { message: string; className?: string }) {
  if (!message) return null
  return (
    <p key={message} role="alert" className={cn('flex animate-shake items-start gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200', className)}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{message}</span>
    </p>
  )
}

/** Turns backend wording into something a receptionist or patient understands. */
export function friendlyAuthError(raw: string): string {
  const m = raw.toLowerCase()
  if (/invalid (login )?credentials|invalid email or password/.test(m)) return 'Email or password is incorrect. Check for typos or reset your password.'
  if (/email not confirmed/.test(m)) return 'Please confirm your e-mail first — open the link we sent you, then sign in.'
  if (/user (is )?banned|banned/.test(m)) return 'This account has been locked. Please contact the hospital administrator.'
  if (/already (registered|exists)/.test(m)) return 'An account with this e-mail already exists. Sign in or reset your password instead.'
  if (/rate|too many|seconds/.test(m)) return 'Too many attempts. Please wait a minute and try again.'
  if (/failed to fetch|network|load failed/.test(m)) return 'Network problem — please check your internet connection and try again.'
  return raw
}
