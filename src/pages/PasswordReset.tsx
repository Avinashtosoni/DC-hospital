/**
 * Forgot password → e-mail link → set a new password.
 *  /forgot-password  asks for the e-mail and sends a Supabase reset link (always shows the same answer, so it never reveals
 *                    whether an account exists)
 *  /reset-password   the link lands here with a one-time recovery session; the user chooses a new password
 * Supabase → Authentication → URL Configuration must list  https://<your-domain>/reset-password  as a redirect URL.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, KeyRound, MailCheck } from 'lucide-react'
import { toast } from 'sonner'
import { auth } from '../auth/AuthProvider'
import { Button, Field, Input, Spinner } from '../components/ui'
import { AuthShell } from './Login'
import { useT } from '../i18n'

const Back = () => {
  const { t } = useT()
  return <Link to="/login" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"><ArrowLeft className="h-4 w-4" />{t('Back to sign in')}</Link>
}

export function ForgotPassword() {
  const { t } = useT()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true)
    try { await auth.requestPasswordReset(email, `${window.location.origin}/reset-password`); setSent(true) }
    catch (err) { setError((err as Error).message) }
    finally { setLoading(false) }
  }
  return (
    <AuthShell>
      {sent ? (
        <div>
          <div className="grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-600"><MailCheck className="h-6 w-6" /></div>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">{t('Check your e-mail')}</h2>
          <p className="mt-2 text-sm text-slate-600">{t('If an account exists for {email}, we have sent a link to reset the password. The link works once and expires in 1 hour. Check your spam folder too.', { email })}</p>
          <Back />
        </div>
      ) : (
        <>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{t('Forgot your password?')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('Enter the e-mail you sign in with and we will send you a reset link.')}</p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <Field label={t('Email')}><Input type="email" required autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@hospital.com" /></Field>
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}
            <Button type="submit" className="w-full" loading={loading} icon={!loading && <KeyRound className="h-4 w-4" />}>{t('Send reset link')}</Button>
          </form>
          <Back />
        </>
      )}
    </AuthShell>
  )
}

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
    try { await auth.setNewPassword(pw); setState('done'); toast.success(t('Password updated')); setTimeout(() => nav('/', { replace: true }), 1200) }
    catch (err) { setError((err as Error).message) }
    finally { setLoading(false) }
  }
  return (
    <AuthShell>
      {state === 'checking' && <div className="grid h-40 place-items-center"><Spinner className="h-6 w-6" /></div>}
      {state === 'invalid' && (
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{t('This link has expired')}</h2>
          <p className="mt-2 text-sm text-slate-600">{t('Reset links work once and expire after an hour. Request a new one below.')}</p>
          <Link to="/forgot-password" className="mt-6 inline-flex"><Button icon={<KeyRound className="h-4 w-4" />}>{t('Send a new link')}</Button></Link>
          <div><Back /></div>
        </div>
      )}
      {state === 'done' && (
        <div className="text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <h2 className="mt-3 text-xl font-semibold text-slate-900">{t('Password updated')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('Taking you to your dashboard…')}</p>
        </div>
      )}
      {state === 'ready' && (
        <>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{t('Choose a new password')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('Use at least 8 characters. Avoid passwords you use on other sites.')}</p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <Field label={t('New password')}><Input type="password" required autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field label={t('Confirm password')}><Input type="password" required autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}
            <Button type="submit" className="w-full" loading={loading}>{t('Update password')}</Button>
          </form>
        </>
      )}
    </AuthShell>
  )
}
