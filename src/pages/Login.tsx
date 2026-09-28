import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, BedDouble, CalendarCheck, Crown, HeartPulse, Receipt, ShieldCheck, Stethoscope, UserCog, Users, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthProvider'
import { Button, Field, Input } from '../components/ui'
import { Logo } from '../components/layout/AppLayout'
import { DEMO_PASSWORD, DEMO_USERS } from '../data/seed'
import { ROLE_LABEL, type Role } from '../types'
import { isSupabaseConfigured } from '../lib/supabase'
import { HOSPITAL, cn } from '../lib/utils'

const ROLE_ICON: Record<Role, typeof Crown> = { owner: Crown, doctor: Stethoscope, receptionist: CalendarCheck, accountant: Wallet, staff: UserCog, patient: HeartPulse }

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-brand-950 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(204,204,255,.35),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(92,92,153,.45),transparent_50%)]" />
        <div className="absolute inset-0 opacity-[.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Link to="/" aria-label="Back to home" className="self-start"><Logo light /></Link>
          <div className="max-w-lg">
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-white">Run your entire hospital from one calm, connected workspace.</h1>
            <p className="mt-4 text-base text-slate-400">OPD scheduling, e-prescriptions, IPD & bed management, laboratory, pharmacy, billing and financial reporting — built for every role in your team.</p>
            <div className="mt-10 grid grid-cols-2 gap-3">
              {[[Users, 'Patient records', 'EMR & history'], [BedDouble, 'Bed management', 'Live occupancy'], [Receipt, 'Billing & payments', 'GST ready'], [ShieldCheck, 'Role-based access', '6 user roles']].map(([Icon, t, s]) => {
                const I = Icon as typeof Users
                return (
                  <div key={t as string} className="rounded-xl border border-white/10 bg-white/[.04] p-4 backdrop-blur">
                    <I className="h-5 w-5 text-brand-300" />
                    <div className="mt-3 text-sm font-medium text-white">{t as string}</div>
                    <div className="text-xs text-slate-400">{s as string}</div>
                  </div>
                )
              })}
            </div>
          </div>
          <p className="text-xs text-slate-500">© {new Date().getFullYear()} {HOSPITAL.name} · {HOSPITAL.address}</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <Link to="/" aria-label="Back to home" className="mb-8 inline-block lg:hidden"><Logo /></Link>
          {children}
        </div>
      </div>
    </div>
  )
}

export default function Login() {
  const { user, signIn } = useAuth()
  const nav = useNavigate()
  const loc = useLocation() as { state?: { from?: string } }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')

  if (user) return <Navigate to={loc.state?.from ?? '/'} replace />

  const doLogin = async (e: string, p: string) => {
    setError('')
    try {
      const u = await signIn(e, p)
      toast.success(`Welcome back, ${u.full_name.replace(/^Dr\.?\s+/i, '').split(' ')[0]}!`)
      nav(loc.state?.from ?? '/', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    }
  }
  const submit = async (e: FormEvent) => { e.preventDefault(); setLoading(true); await doLogin(email, password); setLoading(false) }
  const quick = async (em: string) => { setEmail(em); setPassword(DEMO_PASSWORD); setPending(em); await doLogin(em, DEMO_PASSWORD); setPending(null) }

  return (
    <AuthShell>
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h2>
      <p className="mt-1 text-sm text-slate-500">Welcome back. Enter your credentials to continue.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label="Email"><Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@dchospital.com" /></Field>
        <Field label="Password"><Input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /></Field>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}
        <Button type="submit" className="w-full" loading={loading} icon={!loading && <ArrowRight className="h-4 w-4" />}>Sign in</Button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">New patient? <Link to="/register" className="font-medium text-brand-700 hover:underline">Create an account</Link></p>

      <div className="mt-8">
        <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400"><span className="h-px flex-1 bg-slate-200" />One-click demo accounts<span className="h-px flex-1 bg-slate-200" /></div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {DEMO_USERS.map((u) => {
            const Icon = ROLE_ICON[u.role]
            return (
              <button key={u.email} onClick={() => quick(u.email)} disabled={!!pending}
                className={cn('group flex flex-col items-start gap-1.5 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md disabled:opacity-60', pending === u.email && 'animate-pulse border-brand-400')}>
                <Icon className="h-4 w-4 text-brand-600" />
                <span className="text-xs font-semibold text-slate-800">{ROLE_LABEL[u.role]}</span>
                <span className="w-full truncate text-[11px] text-slate-500">{u.full_name}</span>
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-center text-xs text-slate-400">
          Password for all demo accounts: <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{DEMO_PASSWORD}</code>
          {isSupabaseConfigured ? ' · Supabase' : ' · local demo data'}
        </p>
      </div>
    </AuthShell>
  )
}
