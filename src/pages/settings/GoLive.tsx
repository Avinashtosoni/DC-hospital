import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, CircleAlert, Rocket } from 'lucide-react'
import { Button, ConfirmDialog, Skeleton } from '../../components/ui'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { Section, type TabCtx } from './shared'

interface DemoStatus { demo_accounts_active: number; owner_is_demo_email: boolean; owner_has_demo_password: boolean; demo_rows: number }
const QK = ['demo-status']

async function rpc<T>(fn: string): Promise<T> {
  const { data, error } = await supabase!.rpc(fn)
  if (error) throw new Error(error.message)
  return data as T
}

function Item({ ok, title, hint, action, loading }: { ok: boolean | null; title: string; hint: string; action?: React.ReactNode; loading?: boolean }) {
  return (
    <li className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
      {loading ? <Skeleton className="mt-0.5 h-5 w-5 rounded-full" />
        : ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-label="Done" />
          : <CircleAlert className={cn('mt-0.5 h-5 w-5 shrink-0', ok === null ? 'text-slate-300' : 'text-amber-500')} aria-label="To do" />}
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium', ok ? 'text-slate-500' : 'text-slate-800')}>{title}</p>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      {!ok && action}
    </li>
  )
}

/** Owner checklist for switching a demo install into a real hospital: no shared demo logins, no fake data. */
export function GoLiveChecklist({ ctx }: { ctx: TabCtx }) {
  const { site, app, editSite } = ctx
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState<'lock' | 'clear' | null>(null)
  const status = useQuery({ queryKey: QK, queryFn: () => rpc<DemoStatus>('demo_status'), enabled: isSupabaseConfigured, retry: false })
  const done = () => { qc.invalidateQueries({ queryKey: QK }); qc.invalidateQueries(); setConfirm(null) }
  const lock = useMutation({ mutationFn: () => rpc<number>('lock_demo_accounts'), onSuccess: (n) => { toast.success(`${n} demo account${n === 1 ? '' : 's'} locked`); done() }, onError: (e) => toast.error((e as Error).message) })
  const clear = useMutation({ mutationFn: () => rpc<number>('clear_demo_data'), onSuccess: (n) => { toast.success(`${n.toLocaleString('en-IN')} demo records deleted`); done() }, onError: (e) => toast.error((e as Error).message) })

  const s = status.data
  const live = isSupabaseConfigured
  const messaging = app.notifications.sms.enabled || app.notifications.whatsapp.enabled
  const items = [
    !site.portal.showDemoLogins, !site.booking.showDemoOtp, messaging, !!site.siteUrl,
    ...(live && s ? [s.demo_accounts_active === 0, !s.owner_is_demo_email && !s.owner_has_demo_password, s.demo_rows === 0] : []),
  ]
  const left = items.filter((x) => !x).length

  return (
    <Section title="Go-live checklist" icon={<Rocket className="h-4 w-4" />}
      description={left ? `${left} step${left === 1 ? '' : 's'} left before real patients use the system.` : 'All set — no demo logins or demo data remain.'}>
      <ul className="divide-y divide-slate-100">
        <Item ok={!site.portal.showDemoLogins} title="Hide the demo sign-in buttons" hint="The one-click demo accounts on the sign-in page."
          action={<Button size="sm" variant="outline" onClick={() => editSite((d) => { d.portal.showDemoLogins = false })}>Hide</Button>} />
        <Item ok={!site.booking.showDemoOtp} title="Never show the booking OTP on screen" hint="Codes must arrive by SMS / WhatsApp only."
          action={<Button size="sm" variant="outline" onClick={() => editSite((d) => { d.booking.showDemoOtp = false })}>Turn off</Button>} />
        <Item ok={messaging} title="Connect SMS or WhatsApp" hint="Needed for booking OTPs, confirmations, reminders and feedback links."
          action={<Link to="/settings?tab=notifications" className="text-sm font-medium text-brand-700 hover:underline">Set up</Link>} />
        <Item ok={!!site.siteUrl} title="Set the website address" hint="Links in messages (feedback, staff invites) point here."
          action={<Button size="sm" variant="outline" onClick={() => editSite((d) => { d.siteUrl = window.location.origin })}>Use {window.location.host}</Button>} />
        {live ? <>
          <Item loading={status.isLoading} ok={s ? s.demo_accounts_active === 0 : null} title="Lock the demo accounts"
            hint={s ? `${s.demo_accounts_active} demo login${s.demo_accounts_active === 1 ? '' : 's'} (…@dchospital.com, password Demo@123) can still sign in.` : status.error ? (status.error as Error).message : 'Checking…'}
            action={<Button size="sm" variant="danger" onClick={() => setConfirm('lock')}>Lock now</Button>} />
          <Item loading={status.isLoading} ok={s ? !s.owner_is_demo_email && !s.owner_has_demo_password : null} title="Use your own owner login"
            hint={s?.owner_has_demo_password ? 'Your account still uses the demo password Demo@123.' : s?.owner_is_demo_email ? 'You are signed in with the demo owner e-mail. Change it in My profile (or create your own owner account from Users & Roles, then lock this one).' : 'Your owner account has its own e-mail and password.'}
            action={<Link to="/profile" className="text-sm font-medium text-brand-700 hover:underline">My profile</Link>} />
          <Item loading={status.isLoading} ok={s ? s.demo_rows === 0 : null} title="Delete the demo patients, visits and bills"
            hint={s ? `${s.demo_rows.toLocaleString('en-IN')} demo records. Doctors, departments, holidays and your own records are kept.` : ''}
            action={<Button size="sm" variant="danger" onClick={() => setConfirm('clear')}>Delete demo data</Button>} />
        </> : (
          <li className="pt-3 text-xs text-slate-500">
            This browser is running in <b>demo mode</b>. With Supabase connected, this list also locks the demo logins and deletes the demo data.
            For a brand-new project use <code className="rounded bg-slate-100 px-1">supabase/production.sql</code>, which has no demo accounts or data at all.
          </li>
        )}
      </ul>
      <ConfirmDialog open={confirm === 'lock'} onClose={() => setConfirm(null)} onConfirm={() => lock.mutate()} loading={lock.isPending} confirmLabel="Lock demo accounts"
        title="Lock all demo accounts?" description="The demo doctor, reception, accounts, staff and patient logins get a random password and are blocked. Your own account is not touched. Records they created stay." />
      <ConfirmDialog open={confirm === 'clear'} onClose={() => setConfirm(null)} onConfirm={() => clear.mutate()} loading={clear.isPending} confirmLabel="Delete demo data"
        title="Delete all demo data?" description="Demo patients with their appointments, prescriptions, lab tests, admissions, invoices, payments, expenses, stock, notices and enquiries are permanently deleted. This cannot be undone — download a backup first (Data & backup)." />
    </Section>
  )
}
