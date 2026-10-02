import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, BedDouble, CalendarCheck, CalendarPlus, ChevronDown, Clock, Crown, HeartPulse, LockKeyhole, Mail, Receipt,
  ShieldCheck, Stethoscope, UserCog, Users, Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthProvider'
import { Button } from '../components/ui'
import { Logo } from '../components/layout/AppLayout'
import { FormError, IconInput, PasswordInput, friendlyAuthError } from '../components/auth/AuthFields'
import { CITY_USERS, DEMO_PASSWORD, DEMO_USERS } from '../data/demoUsers'
import { activeDemoTenant, DEMO_PROVIDERS, DEMO_TENANTS } from '../tenancy/demo'
import { PROVIDER_ROLE_LABEL } from '../tenancy/state'
import { ROLE_LABEL, type Role } from '../types'
import { isSupabaseConfigured } from '../lib/supabase'
import { cn } from '../lib/utils'
import { useSiteSettings } from '../site/cms/content'
import { LanguageSwitch, useT } from '../i18n'

const ROLE_ICON: Record<Role, typeof Crown> = { owner: Crown, doctor: Stethoscope, receptionist: CalendarCheck, accountant: Wallet, staff: UserCog, patient: HeartPulse }
const LAST_EMAIL = 'dch:last-email'

const FEATURES: [typeof Users, string, string][] = [
  [Users, 'Patient records', 'EMR & history'],
  [BedDouble, 'Bed management', 'Live occupancy'],
  [Receipt, 'Billing & payments', 'GST ready'],
  [ShieldCheck, 'Role-based access', '6 user roles'],
]

export function AuthShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  const site = useSiteSettings()
  const { t } = useT()
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_1fr]">
      {/* brand panel */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 lg:block">
        <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 animate-drift rounded-full bg-brand-300/25 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 right-0 h-[28rem] w-[28rem] animate-drift-slow rounded-full bg-brand-500/30 blur-3xl" />
        <div aria-hidden="true" className="absolute inset-0 opacity-[.06] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Link to="/" aria-label={t('Back to website')} className="self-start"><Logo light /></Link>
          <div className="max-w-lg">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-brand-100 ring-1 ring-white/15">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{site.name} · {t('Staff & patient portal')}
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-white">Run your entire hospital from one calm, connected workspace.</h1>
            <p className="mt-4 text-base text-brand-100/70">OPD scheduling, e-prescriptions, IPD & bed management, laboratory, pharmacy, billing and financial reporting — built for every role in your team.</p>
            <div className="mt-10 grid grid-cols-2 gap-3">
              {FEATURES.map(([I, title, sub]) => (
                <div key={title} className="rounded-xl border border-white/10 bg-white/[.05] p-4 backdrop-blur transition hover:bg-white/[.08]">
                  <I className="h-5 w-5 text-brand-200" />
                  <div className="mt-3 text-sm font-medium text-white">{title}</div>
                  <div className="text-xs text-brand-100/60">{sub}</div>
                </div>
              ))}
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-brand-100/70">
              <li className="inline-flex items-center gap-1.5"><LockKeyhole className="h-3.5 w-3.5" />{t('Encrypted sign-in')}</li>
              <li className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />{t('Every change is audited')}</li>
              <li className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{t('Auto sign-out on idle')}</li>
            </ul>
          </div>
          <p className="text-xs text-brand-100/50">© {new Date().getFullYear()} {site.name}{site.address ? ` · ${site.address}` : ''}</p>
        </div>
      </div>

      {/* form panel */}
      <div className="relative flex flex-col bg-gradient-to-b from-brand-50/60 via-white to-white lg:bg-none">
        <div className="flex items-center justify-between gap-3 px-5 pt-5 sm:px-10 sm:pt-7">
          <Link to="/" className="group inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-brand-50 hover:text-brand-800">
            <ArrowLeft className="h-4 w-4 transition group-hover:-translate-x-0.5" />{t('Back to website')}
          </Link>
          <LanguageSwitch />
        </div>
        <div className="flex flex-1 items-center justify-center px-5 py-8 sm:px-10">
          <div className={cn('w-full animate-rise', wide ? 'max-w-lg' : 'max-w-md')}>
            <Link to="/" aria-label={t('Back to website')} className="mb-8 inline-block lg:hidden"><Logo /></Link>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Login() {
  const { user, signIn } = useAuth()
  const nav = useNavigate()
  const loc = useLocation() as { state?: { from?: string; email?: string } }
  const [params] = useSearchParams()
  const remembered = typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_EMAIL) ?? '' : ''
  const [email, setEmail] = useState(loc.state?.email ?? remembered)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const site = useSiteSettings()
  const portal = site.portal
  const { t } = useT()
  const [demoOpen, setDemoOpen] = useState(!isSupabaseConfigured)

  // only same-app paths (never //evil.com or /\\evil.com)
  const next = typeof loc.state?.from === 'string' && /^\/(?![/\\])/.test(loc.state.from) && !loc.state.from.includes('\\') ? loc.state.from : '/'
  if (user) return <Navigate to={next} replace />

  const doLogin = async (e: string, p: string) => {
    setError('')
    try {
      const u = await signIn(e.trim(), p)
      if (remember) localStorage.setItem(LAST_EMAIL, e.trim()); else localStorage.removeItem(LAST_EMAIL)
      toast.success(t('Welcome back, {name}!', { name: u.full_name.replace(/^Dr\.?\s+/i, '').split(' ')[0] }))
      nav(next, { replace: true })
    } catch (err) {
      setError(t(friendlyAuthError((err as Error).message)))
      setPassword('')
    }
  }
  const submit = async (e: FormEvent) => { e.preventDefault(); setLoading(true); await doLogin(email, password); setLoading(false) }
  const quick = async (em: string) => { setEmail(em); setPassword(DEMO_PASSWORD); setPending(em); await doLogin(em, DEMO_PASSWORD); setPending(null) }
  const busy = loading || !!pending
  // demo mode: the logins of the hospital this website belongs to (?hospital=citycare → City Care Clinic)
  const demoUsers = isSupabaseConfigured || activeDemoTenant().is_primary ? DEMO_USERS : CITY_USERS

  return (
    <AuthShell>
      <h2 className="font-display text-3xl font-bold tracking-tight text-brand-950">{t('Welcome back')}</h2>
      <p className="mt-1.5 text-sm text-slate-500">{t('Sign in to your {hospital} account to continue.', { hospital: site.name })}</p>

      {params.get('reason') === 'idle' && (
        <p className="mt-5 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800 ring-1 ring-amber-200"><Clock className="mt-0.5 h-4 w-4 shrink-0" />{t('You were signed out after a period of inactivity. Please sign in again.')}</p>
      )}
      {portal.loginNotice.trim() && <p className="mt-5 rounded-lg bg-brand-50 px-3 py-2.5 text-sm text-brand-900 ring-1 ring-brand-200">{portal.loginNotice}</p>}

      <form onSubmit={submit} className="mt-7 space-y-4">
        <label className="block">
          <span className="label">{t('Email')}</span>
          <IconInput icon={<Mail />} type="email" required autoComplete="username" autoFocus={!email} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@dchospital.com" />
        </label>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="login-password" className="label !mb-0">{t('Password')}</label>
            <Link to="/forgot-password" state={{ email }} className="text-xs font-semibold text-brand-700 hover:text-brand-900 hover:underline">{t('Forgot password?')}</Link>
          </div>
          <PasswordInput id="login-password" required autoComplete="current-password" autoFocus={!!email} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded border-brand-200 text-brand-600 focus:ring-brand-400" />
          {t('Remember my e-mail on this device')}
        </label>
        <FormError message={error} />
        <Button type="submit" className="h-11 w-full text-[15px]" loading={loading} disabled={busy} icon={!loading && <ArrowRight className="h-4 w-4" />}>{loading ? t('Signing in…') : t('Sign in')}</Button>
      </form>

      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        {portal.allowSignup && (
          <Link to="/register" className="flex items-center justify-center gap-2 rounded-lg border border-brand-100 bg-white px-3 py-2.5 text-sm font-medium text-brand-800 shadow-sm transition hover:border-brand-300 hover:bg-brand-50">
            <HeartPulse className="h-4 w-4" />{t('Create patient account')}
          </Link>
        )}
        <Link to="/book" className={cn('flex items-center justify-center gap-2 rounded-lg border border-brand-100 bg-white px-3 py-2.5 text-sm font-medium text-brand-800 shadow-sm transition hover:border-brand-300 hover:bg-brand-50', !portal.allowSignup && 'sm:col-span-2')}>
          <CalendarPlus className="h-4 w-4" />{t('Book a visit online')}
        </Link>
      </div>
      <p className="mt-4 text-center text-xs text-slate-400">{t('Hospital staff? Ask the owner for an invitation link — it gives your account the right access.')}</p>

      {portal.showDemoLogins && <div className="mt-7 rounded-2xl border border-brand-100 bg-brand-50/40">
        <button type="button" onClick={() => setDemoOpen((o) => !o)} aria-expanded={demoOpen}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-brand-700">
          {t('One-click demo accounts')}<ChevronDown className={cn('h-4 w-4 transition', demoOpen && 'rotate-180')} />
        </button>
        {demoOpen && <div className="animate-fade-in px-4 pb-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {demoUsers.map((u) => {
              const Icon = ROLE_ICON[u.role]
              return (
                <button key={u.email} type="button" onClick={() => quick(u.email)} disabled={busy}
                  className={cn('group flex flex-col items-start gap-1.5 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md disabled:pointer-events-none disabled:opacity-60', pending === u.email && 'animate-pulse border-brand-400')}>
                  <Icon className="h-4 w-4 text-brand-600" />
                  <span className="text-xs font-semibold text-slate-800">{ROLE_LABEL[u.role]}</span>
                  <span className="w-full truncate text-[11px] text-slate-500">{u.full_name}</span>
                </button>
              )
            })}
          </div>
          {!isSupabaseConfigured && <MultiHospitalDemo busy={busy} pending={pending} onPick={quick} />}
          <p className="mt-3 text-center text-xs text-slate-500">
            Password for all demo accounts: <code className="rounded bg-white px-1.5 py-0.5 text-slate-700 ring-1 ring-slate-200">{DEMO_PASSWORD}</code>
            {isSupabaseConfigured ? ' · Supabase' : ' · local demo data'}
          </p>
        </div>}
      </div>}
    </AuthShell>
  )
}

/** demo mode only: the second hospital and the Hospital Comrade team logins */
function MultiHospitalDemo({ busy, pending, onPick }: { busy: boolean; pending: string | null; onPick: (email: string) => void }) {
  const here = activeDemoTenant()
  const other = DEMO_TENANTS.find((t) => t.id !== here.id)!
  return (
    <div className="mt-4 border-t border-brand-100 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">Multi-hospital demo</span>
        {/* a full page load: the website's hospital is decided before the app starts */}
        <a href={`/login?hospital=${other.slug}`} className="text-xs font-semibold text-brand-700 hover:text-brand-900 hover:underline">
          {other.is_primary ? `Back to ${other.name}` : `Open ${other.name} (second hospital)`} →
        </a>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        You are on <b className="font-semibold text-slate-700">{here.name}</b>&apos;s site — its accounts only work here. Platform team logins work on any hospital:
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {DEMO_PROVIDERS.map((p) => (
          <button key={p.email} type="button" onClick={() => onPick(p.email)} disabled={busy}
            className={cn('flex flex-col items-start gap-1 rounded-xl border border-brand-200 bg-brand-950 p-2.5 text-left text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-brand-900 disabled:pointer-events-none disabled:opacity-60', pending === p.email && 'animate-pulse')}>
            <span className="text-[11px] font-semibold">{PROVIDER_ROLE_LABEL[p.role]}</span>
            <span className="w-full truncate text-[10px] text-brand-200">{p.tenants === null ? 'All hospitals' : `${p.tenants.length} hospital${p.tenants.length > 1 ? 's' : ''}`}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
