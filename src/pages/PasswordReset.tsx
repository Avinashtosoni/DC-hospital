/**
 * Forgot password — two ways back in:
 *  • E-mail link   /forgot-password → Supabase e-mails a one-time link → /reset-password sets the new password
 *                  (the answer is always the same, so it never reveals whether an account exists)
 *  • Mobile OTP    /forgot-password?method=mobile → 6-digit code on WhatsApp / SMS → new password, right here
 *                  (the e-mail AND mobile must belong to the same account; see scripts/sql/auth.sql)
 * Supabase → Authentication → URL Configuration must list  https://<your-domain>/reset-password  as a redirect URL.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Check, CheckCircle2, KeyRound, Mail, MailCheck, MessageCircle, MessageSquareText, Pencil, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { auth } from '../auth/AuthProvider'
import { mobileReset, phone10, ResetError, validEmail, validMobile, type OtpChannel } from '../auth/passwordReset'
import { Button, Spinner } from '../components/ui'
import { FormError, IconInput, PasswordInput, PasswordStrength } from '../components/auth/AuthFields'
import { AuthShell } from './Login'
import { cn } from '../lib/utils'
import { useT } from '../i18n'

const Back = ({ email }: { email?: string }) => {
  const { t } = useT()
  return <Link to="/login" state={email ? { email } : undefined} className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"><ArrowLeft className="h-4 w-4" />{t('Back to sign in')}</Link>
}

/** seconds left before "Resend" is allowed again */
function useCountdown() {
  const [left, setLeft] = useState(0)
  useEffect(() => { if (left <= 0) return; const id = setTimeout(() => setLeft((s) => s - 1), 1000); return () => clearTimeout(id) }, [left])
  return [left, setLeft] as const
}

function MethodCard({ active, disabled, icon, title, sub, onClick }: { active: boolean; disabled?: boolean; icon: ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={active} disabled={disabled} onClick={onClick}
      className={cn('relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300/40',
        active ? 'border-brand-500 bg-brand-50 shadow-sm ring-1 ring-brand-500' : 'border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/40',
        disabled && 'cursor-not-allowed opacity-50 hover:border-slate-200 hover:bg-white')}>
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', active ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700')}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-slate-500">{sub}</span>
      </span>
      {active && <Check className="absolute right-3 top-3 h-4 w-4 text-brand-600" />}
    </button>
  )
}

export function ForgotPassword() {
  const { t } = useT()
  const loc = useLocation() as { state?: { email?: string } }
  const [params, setParams] = useSearchParams()
  const method = params.get('method') === 'mobile' ? 'mobile' : 'email'
  const [email, setEmail] = useState(loc.state?.email ?? '')
  const channelsQ = useQuery({ queryKey: ['password-otp-channels'], queryFn: () => mobileReset.channels(), staleTime: 60_000, retry: false })
  const mobileOff = channelsQ.isSuccess && channelsQ.data.length === 0
  const setMethod = (m: 'email' | 'mobile') => setParams((p) => { const n = new URLSearchParams(p); if (m === 'mobile') n.set('method', 'mobile'); else n.delete('method'); return n }, { replace: true })

  return (
    <AuthShell>
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-100 text-brand-700"><KeyRound className="h-6 w-6" /></div>
      <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-brand-950">{t('Forgot your password?')}</h2>
      <p className="mt-1.5 text-sm text-slate-500">{t("No worries — choose how you'd like to reset it.")}</p>

      <div role="radiogroup" aria-label={t('Reset method')} className="mt-6 grid gap-2 sm:grid-cols-2">
        <MethodCard active={method === 'email'} icon={<Mail className="h-4 w-4" />} title={t('E-mail link')} sub={t('A secure link to the e-mail you sign in with')} onClick={() => setMethod('email')} />
        <MethodCard active={method === 'mobile'} disabled={mobileOff} icon={<Smartphone className="h-4 w-4" />} title={t('Mobile OTP')}
          sub={mobileOff ? t('Not set up at this hospital yet') : t('A 6-digit code on WhatsApp or SMS')} onClick={() => setMethod('mobile')} />
      </div>

      <div key={method} className="animate-rise">
        {method === 'email' || mobileOff
          ? <EmailReset email={email} setEmail={setEmail} />
          : <MobileReset email={email} setEmail={setEmail} channels={channelsQ.data ?? []} loadingChannels={channelsQ.isLoading} />}
      </div>
    </AuthShell>
  )
}

// ------------------------------------------------------------------ option 1: e-mail link
function EmailReset({ email, setEmail }: { email: string; setEmail: (v: string) => void }) {
  const { t } = useT()
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [left, setLeft] = useCountdown()
  const send = async () => {
    setError('')
    if (!validEmail(email)) return setError(t('Please enter a valid e-mail address.'))
    setLoading(true)
    try {
      await auth.requestPasswordReset(email.trim(), `${window.location.origin}/reset-password`)
      setSent(true); setLeft(60)
    } catch (err) { setError((err as Error).message) } finally { setLoading(false) }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); send() }

  if (sent) return (
    <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-600"><MailCheck className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-900">{t('Check your e-mail')}</h3>
          <p className="mt-1 text-sm text-slate-600">{t('If an account exists for {email}, we have sent a link to reset the password. The link works once and expires in 1 hour. Check your spam folder too.', { email: email.trim() })}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <button type="button" onClick={send} disabled={left > 0 || loading} className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />{left > 0 ? t('Resend in {s}s', { s: left }) : t('Resend link')}
        </button>
        <button type="button" onClick={() => setSent(false)} className="inline-flex items-center gap-1.5 font-medium text-slate-500 hover:text-slate-800"><Pencil className="h-3.5 w-3.5" />{t('Use a different e-mail')}</button>
      </div>
      <Back email={email.trim()} />
    </div>
  )
  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block">
        <span className="label">{t('Email')}</span>
        <IconInput icon={<Mail />} type="email" required autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@hospital.com" />
      </label>
      <FormError message={error} />
      <Button type="submit" className="h-11 w-full" loading={loading} icon={!loading && <Mail className="h-4 w-4" />}>{t('Send reset link')}</Button>
      <Back email={email.trim()} />
    </form>
  )
}

// ------------------------------------------------------------------ option 2: mobile OTP
type Step = 'details' | 'code' | 'password' | 'done'
const STEPS: { id: Step; label: string }[] = [{ id: 'details', label: 'Verify' }, { id: 'code', label: 'Enter code' }, { id: 'password', label: 'New password' }]

function Steps({ step }: { step: Step }) {
  const { t } = useT()
  const idx = step === 'done' ? 3 : STEPS.findIndex((s) => s.id === step)
  return (
    <ol className="mt-6 flex items-center gap-2" aria-label={t('Progress')}>
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex flex-1 items-center gap-2">
          <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold transition',
            i < idx ? 'bg-emerald-500 text-white' : i === idx ? 'bg-brand-600 text-white ring-4 ring-brand-200' : 'bg-slate-100 text-slate-400')}>
            {i < idx ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={cn('hidden text-xs font-medium sm:inline', i === idx ? 'text-brand-900' : 'text-slate-400')}>{t(s.label)}</span>
          {i < STEPS.length - 1 && <span className={cn('h-px flex-1', i < idx ? 'bg-emerald-300' : 'bg-slate-200')} />}
        </li>
      ))}
    </ol>
  )
}

function MobileReset({ email, setEmail, channels, loadingChannels }: { email: string; setEmail: (v: string) => void; channels: OtpChannel[]; loadingChannels: boolean }) {
  const { t } = useT()
  const nav = useNavigate()
  const [step, setStep] = useState<Step>('details')
  const [phone, setPhone] = useState('')
  const [channel, setChannel] = useState<OtpChannel>('whatsapp')
  const [sentVia, setSentVia] = useState<OtpChannel[]>([])
  const [code, setCode] = useState('')
  const [token, setToken] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [left, setLeft] = useCountdown()
  const codeRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (channels.length && !channels.includes(channel)) setChannel(channels[0]) }, [channels, channel])
  useEffect(() => { if (step === 'code') codeRef.current?.focus() }, [step])

  const send = async () => {
    setError('')
    if (!validEmail(email)) return setError(t('Please enter the e-mail you sign in with.'))
    if (!validMobile(phone)) return setError(t('Please enter a valid 10-digit Indian mobile number.'))
    setLoading(true)
    try {
      const r = await mobileReset.request(email, phone, channel)
      setSentVia(r.channels); setCode(''); setStep('code'); setLeft(30)
    } catch (err) { setError((err as Error).message) } finally { setLoading(false) }
  }
  const verify = async (c = code) => {
    if (c.length !== 6) return setError(t('Enter the 6-digit code.'))
    setError(''); setLoading(true)
    try { setToken(await mobileReset.verify(email, phone, c)); setStep('password') }
    catch (err) { setError((err as Error).message); setCode('') }
    finally { setLoading(false) }
  }
  const save = async (e: FormEvent) => {
    e.preventDefault(); setError('')
    if (pw.length < 8) return setError(t('Use at least 8 characters.'))
    if (pw !== pw2) return setError(t('Passwords do not match'))
    setLoading(true)
    try { await mobileReset.reset(token, pw); setStep('done'); toast.success(t('Password updated')) }
    catch (err) {
      setError((err as Error).message)
      if (err instanceof ResetError && err.code === 'OTP_REQUIRED') { setStep('details'); setToken('') }
    } finally { setLoading(false) }
  }
  const via = sentVia.includes('whatsapp') ? 'WhatsApp' : 'SMS'
  const masked = `+91 ••••• ${phone10(phone).slice(-5)}`

  if (step === 'done') return (
    <div className="mt-8 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50"><CheckCircle2 className="h-9 w-9 text-emerald-500" /></div>
      <h3 className="mt-4 text-xl font-semibold text-slate-900">{t('Password updated')}</h3>
      <p className="mt-1 text-sm text-slate-500">{t('You have been signed out on other devices. Sign in with your new password.')}</p>
      <Button className="mt-6 h-11 w-full" onClick={() => nav('/login', { replace: true, state: { email: email.trim() } })} icon={<ArrowLeft className="h-4 w-4 rotate-180" />}>{t('Continue to sign in')}</Button>
    </div>
  )

  return (
    <div>
      <Steps step={step} />
      {step === 'details' && (
        <form onSubmit={(e) => { e.preventDefault(); send() }} className="mt-5 space-y-4">
          <label className="block">
            <span className="label">{t('Email')}</span>
            <IconInput icon={<Mail />} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@hospital.com" />
          </label>
          <label className="block">
            <span className="label">{t('Mobile number on your account')}</span>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center gap-1.5 pl-3 text-sm font-medium text-slate-500"><Smartphone className="h-4 w-4 text-slate-400" />+91</span>
              <input className="input h-11 pl-[4.25rem] tracking-wide" type="tel" inputMode="numeric" required autoComplete="tel-national" autoFocus={!!email}
                value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d\s+-]/g, ''))} placeholder="98xxx xxxxx" maxLength={16} />
            </div>
          </label>
          {channels.length > 1 && (
            <div>
              <span className="label">{t('Send the code by')}</span>
              <div className="grid grid-cols-2 gap-2">
                {channels.map((c) => (
                  <button key={c} type="button" onClick={() => setChannel(c)} aria-pressed={channel === c}
                    className={cn('flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition',
                      channel === c ? 'border-brand-500 bg-brand-50 text-brand-900 ring-1 ring-brand-500' : 'border-slate-200 text-slate-600 hover:border-brand-300')}>
                    {c === 'whatsapp' ? <MessageCircle className="h-4 w-4 text-emerald-600" /> : <MessageSquareText className="h-4 w-4 text-brand-600" />}{c === 'whatsapp' ? 'WhatsApp' : 'SMS'}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="flex items-start gap-2 text-xs text-slate-500"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />{t('For your security the code is only sent when this e-mail and mobile number belong to the same account.')}</p>
          <FormError message={error} />
          <Button type="submit" className="h-11 w-full" loading={loading} disabled={loadingChannels}>{t('Send code')}</Button>
          <Back email={email.trim()} />
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={(e) => { e.preventDefault(); verify() }} className="mt-5 space-y-4">
          <p className="text-sm text-slate-600">{t('We sent a 6-digit code by {via} to {phone} — if it belongs to the account for {email}.', { via, phone: masked, email: email.trim() })}</p>
          <label className="block">
            <span className="label">{t('Verification code')}</span>
            <input ref={codeRef} className="input h-14 text-center font-mono text-2xl font-semibold tracking-[.6em] placeholder:tracking-[.6em]" inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} placeholder="••••••" value={code} aria-label={t('6-digit code')}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); if (v.length === 6 && !loading) verify(v) }} />
          </label>
          <FormError message={error} />
          <Button type="submit" className="h-11 w-full" loading={loading} disabled={code.length !== 6}>{t('Verify code')}</Button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button type="button" onClick={send} disabled={left > 0 || loading} className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline">
              <RefreshCw className="h-3.5 w-3.5" />{left > 0 ? t('Resend in {s}s', { s: left }) : t('Resend code')}
            </button>
            <button type="button" onClick={() => { setStep('details'); setError('') }} className="inline-flex items-center gap-1.5 font-medium text-slate-500 hover:text-slate-800"><Pencil className="h-3.5 w-3.5" />{t('Change number')}</button>
          </div>
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={save} className="mt-5 space-y-4">
          <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200"><CheckCircle2 className="h-4 w-4" />{t('Mobile verified. Choose a new password.')}</p>
          <div>
            <span className="label">{t('New password')}</span>
            <PasswordInput required autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
            <PasswordStrength value={pw} />
          </div>
          <ConfirmField value={pw2} onChange={setPw2} match={!!pw2 && pw === pw2} />
          <FormError message={error} />
          <Button type="submit" className="h-11 w-full" loading={loading}>{t('Update password')}</Button>
        </form>
      )}
    </div>
  )
}

export function ConfirmField({ value, onChange, match }: { value: string; onChange: (v: string) => void; match: boolean }) {
  const { t } = useT()
  return (
    <div>
      <span className="label">{t('Confirm password')}</span>
      <PasswordInput required autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} />
      {value && <p className={cn('mt-1.5 text-xs font-medium', match ? 'text-emerald-600' : 'text-rose-600')}>{match ? `✓ ${t('Passwords match')}` : t('Passwords do not match')}</p>}
    </div>
  )
}

// ------------------------------------------------------------------ landing page of the e-mail link
export function ResetPassword() {
  const { t } = useT()
  const nav = useNavigate()
  const [state, setState] = useState<'checking' | 'ready' | 'invalid' | 'done'>('checking')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    // Supabase puts errors in the hash, e.g. #error=access_denied&error_code=otp_expired
    if (/error_code=|error=/.test(window.location.hash)) { setState('invalid'); return }
    auth.hasRecoverySession().then((ok) => { if (live) setState(ok ? 'ready' : 'invalid') })
    return () => { live = false }
  }, [])
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('')
    if (pw.length < 8) return setError(t('Use at least 8 characters.'))
    if (pw !== pw2) return setError(t('Passwords do not match'))
    setLoading(true)
    try {
      await auth.setNewPassword(pw); setState('done'); toast.success(t('Password updated'))
      // Supabase signs the user in with the recovery session
      setTimeout(() => nav('/', { replace: true }), 1400)
    }
    catch (err) { setError((err as Error).message) }
    finally { setLoading(false) }
  }
  return (
    <AuthShell>
      {state === 'checking' && <div className="grid h-40 place-items-center"><Spinner className="h-6 w-6" /></div>}
      {state === 'invalid' && (
        <div>
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-600"><KeyRound className="h-6 w-6" /></div>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-brand-950">{t('This link has expired')}</h2>
          <p className="mt-2 text-sm text-slate-600">{t('Reset links work once and expire after an hour. Request a new one below.')}</p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Link to="/forgot-password"><Button className="w-full" icon={<Mail className="h-4 w-4" />}>{t('Send a new link')}</Button></Link>
            <Link to="/forgot-password?method=mobile"><Button variant="outline" className="w-full" icon={<Smartphone className="h-4 w-4" />}>{t('Use mobile OTP')}</Button></Link>
          </div>
          <div><Back /></div>
        </div>
      )}
      {state === 'done' && (
        <div className="text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50"><CheckCircle2 className="h-9 w-9 text-emerald-500" /></div>
          <h2 className="mt-4 text-xl font-semibold text-slate-900">{t('Password updated')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('Taking you to your dashboard…')}</p>
        </div>
      )}
      {state === 'ready' && (
        <>
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-100 text-brand-700"><KeyRound className="h-6 w-6" /></div>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-brand-950">{t('Choose a new password')}</h2>
          <p className="mt-1.5 text-sm text-slate-500">{t('Use at least 8 characters. Avoid passwords you use on other sites.')}</p>
          <form onSubmit={submit} className="mt-7 space-y-4">
            <div>
              <span className="label">{t('New password')}</span>
              <PasswordInput required autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
              <PasswordStrength value={pw} />
            </div>
            <ConfirmField value={pw2} onChange={setPw2} match={!!pw2 && pw === pw2} />
            <FormError message={error} />
            <Button type="submit" className="h-11 w-full" loading={loading}>{t('Update password')}</Button>
          </form>
        </>
      )}
    </AuthShell>
  )
}
