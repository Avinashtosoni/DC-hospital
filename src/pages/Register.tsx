import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, MailCheck, Mail, Phone, UserRound } from 'lucide-react'
import { lookupInvite } from '../auth/invites'
import { ROLE_LABEL } from '../types'
import { toast } from 'sonner'
import { useSiteSettings } from '../site/cms/content'
import { useAuth } from '../auth/AuthProvider'
import { Button } from '../components/ui'
import { FormError, IconInput, PasswordInput, PasswordStrength, friendlyAuthError } from '../components/auth/AuthFields'
import { ConfirmEmailError, OtpRequiredError } from '../data/errors'
import { validMobile } from '../auth/passwordReset'
import { AuthShell } from './Login'
import { ConfirmField } from './PasswordReset'
import { useT } from '../i18n'

export default function Register() {
  const { user, signUp } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  // ?email= from the free-trial sign-up page: the hospital's owner e-mail
  const [form, setForm] = useState({ full_name: '', email: (params.get('email') ?? '').trim().slice(0, 150), phone: '', password: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [agree, setAgree] = useState(false)
  const [confirmFor, setConfirmFor] = useState<string | null>(null)
  const site = useSiteSettings()
  const { t } = useT()
  const token = params.get('invite') ?? ''
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => lookupInvite(token), enabled: !!token, staleTime: Infinity })
  const inv = invite.data?.ok ? invite.data : null
  useEffect(() => {
    if (inv) setForm((f) => ({ ...f, full_name: f.full_name || inv.full_name, email: inv.email, phone: f.phone || inv.phone || '' }))
  }, [inv])
  if (user) return <Navigate to="/" replace />
  if (confirmFor) return (
    <AuthShell>
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><MailCheck className="h-7 w-7" /></div>
      <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-brand-950">{t('Confirm your e-mail')}</h2>
      <p className="mt-2 text-sm text-slate-600">{t('Your account is created. We sent a confirmation link to {email} — open it, then sign in. Check your spam folder too.', { email: confirmFor })}</p>
      <Link to="/login" state={{ email: confirmFor }} className="mt-6 inline-flex"><Button className="h-11">{t('Go to sign in')}</Button></Link>
    </AuthShell>
  )
  if (token && invite.isLoading) return <AuthShell><p className="text-sm text-slate-500">{t('Checking your invitation…')}</p></AuthShell>
  if (token && invite.data && !invite.data.ok) return (
    <AuthShell>
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Invitation not valid</h2>
      <p className="mt-2 text-sm text-slate-500">{invite.data.error}</p>
      <p className="mt-6"><Link to="/login" className="font-medium text-brand-700 hover:underline">Go to sign in</Link></p>
    </AuthShell>
  )
  if (!site.portal.allowSignup && !inv) return (
    <AuthShell>
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{t('Registration is closed')}</h2>
      <p className="mt-2 text-sm text-slate-500">{t('New portal accounts are created by the hospital. Please contact reception on {phone} — or book a visit online.', { phone: site.phone || '—' })}</p>
      <div className="mt-6 flex gap-3"><Link to="/book" className="font-medium text-brand-700 hover:underline">{t('Book an appointment')}</Link><span className="text-slate-300">·</span><Link to="/login" className="font-medium text-brand-700 hover:underline">{t('Sign in')}</Link></div>
    </AuthShell>
  )
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (form.full_name.trim().length < 2) return setError(t('Please enter your full name.'))
    if (form.phone.trim() && !validMobile(form.phone)) return setError(t('Please enter a valid 10-digit Indian mobile number.'))
    if (form.password.length < 8) return setError(t('Use at least 8 characters.'))
    if (form.password !== form.confirm) return setError(t('Passwords do not match'))
    if (!agree) return setError(t('Please accept the terms and privacy policy to continue.'))
    setLoading(true)
    try {
      await signUp({ full_name: form.full_name.trim(), email: form.email.trim(), phone: form.phone.trim(), password: form.password, ...(inv ? { invite_token: token } : {}) })
      toast.success(t('Account created — welcome to {hospital}!', { hospital: site.name }))
      nav('/', { replace: true })
    } catch (err) {
      if (err instanceof ConfirmEmailError) setConfirmFor(err.email)
      else if (err instanceof OtpRequiredError) nav('/login', { replace: true })   // account made; the sign-in code screen is there
      else setError(t(friendlyAuthError((err as Error).message)))
    } finally { setLoading(false) }
  }

  return (
    <AuthShell wide>
      {inv ? <>
        <h2 className="font-display text-3xl font-bold tracking-tight text-brand-950">Join {site.name}</h2>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-800 ring-1 ring-brand-100">
          <BadgeCheck className="h-4 w-4" />You're invited as {ROLE_LABEL[inv.role]}
        </p>
      </> : <>
        <h2 className="font-display text-3xl font-bold tracking-tight text-brand-950">{t('Create your patient account')}</h2>
        <p className="mt-1.5 text-sm text-slate-500">{t('Book appointments, view prescriptions, lab reports and bills online.')}</p>
      </>}
      <form onSubmit={submit} className="mt-7 grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="label">{t('Full name')} <span className="text-rose-500">*</span></span>
          <IconInput icon={<UserRound />} required autoComplete="name" autoFocus value={form.full_name} onChange={set('full_name')} placeholder="Anita Sharma" /></label>
        <label className="block"><span className="label">{t('Email')} <span className="text-rose-500">*</span></span>
          <IconInput icon={<Mail />} type="email" required autoComplete="email" value={form.email} onChange={set('email')} placeholder="you@example.com" readOnly={!!inv} className={inv ? 'bg-slate-50' : undefined} /></label>
        <label className="block"><span className="label">{t('Mobile')}</span>
          <IconInput icon={<Phone />} type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} placeholder="+91 98xxx xxxxx" />
          <span className="mt-1 block text-xs text-slate-400">{t('Lets you reset your password by OTP')}</span></label>
        <div className="sm:col-span-2">
          <span className="label">{t('Password')} <span className="text-rose-500">*</span></span>
          <PasswordInput required autoComplete="new-password" value={form.password} onChange={set('password')} />
          <PasswordStrength value={form.password} />
        </div>
        <div className="sm:col-span-2"><ConfirmField value={form.confirm} onChange={(v) => setForm((f) => ({ ...f, confirm: v }))} match={!!form.confirm && form.password === form.confirm} /></div>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-600 sm:col-span-2">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-brand-200 text-brand-600 focus:ring-brand-400" />
          <span>{t('I agree to the')} <Link to="/terms" target="_blank" className="font-medium text-brand-700 hover:underline">{t('Terms')}</Link> {t('and')} <Link to="/privacy" target="_blank" className="font-medium text-brand-700 hover:underline">{t('Privacy Policy')}</Link></span>
        </label>
        <FormError message={error} className="sm:col-span-2" />
        <Button type="submit" className="h-11 sm:col-span-2" loading={loading}>{loading ? t('Creating account…') : inv ? `Create ${ROLE_LABEL[inv.role].toLowerCase()} account` : t('Create account')}</Button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">{t('Already registered?')} <Link to="/login" className="font-medium text-brand-700 hover:underline">{t('Sign in')}</Link></p>
      {!inv && <p className="mt-6 rounded-lg bg-slate-50 p-3 text-xs text-slate-500 ring-1 ring-slate-200">Hospital staff: ask the owner for an invitation link (Users &amp; Roles → Invite staff) so your account gets the right access.</p>}
    </AuthShell>
  )
}
