import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BadgeCheck } from 'lucide-react'
import { lookupInvite } from '../auth/invites'
import { ROLE_LABEL } from '../types'
import { toast } from 'sonner'
import { useSiteSettings } from '../site/cms/content'
import { useAuth } from '../auth/AuthProvider'
import { Button, Field, Input } from '../components/ui'
import { AuthShell } from './Login'
import { useT } from '../i18n'

export default function Register() {
  const { user, signUp } = useAuth()
  const nav = useNavigate()
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const site = useSiteSettings()
  const { t } = useT()
  const token = useSearchParams()[0].get('invite') ?? ''
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => lookupInvite(token), enabled: !!token, staleTime: Infinity })
  const inv = invite.data?.ok ? invite.data : null
  useEffect(() => {
    if (inv) setForm((f) => ({ ...f, full_name: f.full_name || inv.full_name, email: inv.email, phone: f.phone || inv.phone || '' }))
  }, [inv])
  if (user) return <Navigate to="/" replace />
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
    if (form.password.length < 6) return setError(t('Password must be at least 6 characters'))
    if (form.password !== form.confirm) return setError(t('Passwords do not match'))
    setLoading(true)
    try {
      await signUp({ full_name: form.full_name.trim(), email: form.email.trim(), phone: form.phone.trim(), password: form.password, ...(inv ? { invite_token: token } : {}) })
      toast.success(t('Account created — welcome to {hospital}!', { hospital: site.name }))
      nav('/', { replace: true })
    } catch (err) { setError((err as Error).message) } finally { setLoading(false) }
  }

  return (
    <AuthShell>
      {inv ? <>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Join {site.name}</h2>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-800 ring-1 ring-brand-100">
          <BadgeCheck className="h-4 w-4" />You're invited as {ROLE_LABEL[inv.role]}
        </p>
      </> : <>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{t('Create your patient account')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('Book appointments, view prescriptions, lab reports and bills online.')}</p>
      </>}
      <form onSubmit={submit} className="mt-8 grid gap-4 sm:grid-cols-2">
        <Field label={t('Full name')} required className="sm:col-span-2"><Input required value={form.full_name} onChange={set('full_name')} placeholder="Anita Sharma" /></Field>
        <Field label={t('Email')} required><Input type="email" required value={form.email} onChange={set('email')} placeholder="you@example.com" readOnly={!!inv} className={inv ? 'bg-slate-50' : undefined} /></Field>
        <Field label={t('Phone')}><Input type="tel" value={form.phone} onChange={set('phone')} placeholder="+91 98xxx xxxxx" /></Field>
        <Field label={t('Password')} required><Input type="password" required value={form.password} onChange={set('password')} /></Field>
        <Field label={t('Confirm password')} required><Input type="password" required value={form.confirm} onChange={set('confirm')} /></Field>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200 sm:col-span-2">{error}</p>}
        <Button type="submit" className="sm:col-span-2" loading={loading}>{inv ? `Create ${ROLE_LABEL[inv.role].toLowerCase()} account` : t('Create account')}</Button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">{t('Already registered?')} <Link to="/login" className="font-medium text-brand-700 hover:underline">{t('Sign in')}</Link></p>
      {!inv && <p className="mt-6 rounded-lg bg-slate-50 p-3 text-xs text-slate-500 ring-1 ring-slate-200">Hospital staff: ask the owner for an invitation link (Users &amp; Roles → Invite staff) so your account gets the right access.</p>}
    </AuthShell>
  )
}
