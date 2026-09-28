import { Link } from 'react-router-dom'
import { ArrowRight, KeyRound, LogIn, ShieldCheck, Timer } from 'lucide-react'
import { Field, Textarea } from '../../components/ui'
import { PERMISSIONS, type Action } from '../../auth/permissions'
import { cn, titleCase } from '../../lib/utils'
import { ROLES, ROLE_LABEL } from '../../types'
import { Section, Segmented, Toggle, type TabCtx } from './shared'

const IDLE = [0, 15, 30, 60, 120] as const
const ACT: Record<Action, string> = { read: 'R', create: 'C', update: 'U', delete: 'D' }

export function SecurityTab({ ctx }: { ctx: TabCtx }) {
  const { site, app, editSite, editApp } = ctx
  const p = site.portal
  return (
    <div className="space-y-6">
      <Section title="Session timeout" description="Automatically sign users out of shared front-desk and ward computers." icon={<Timer className="h-4 w-4" />}>
        <Segmented value={app.security.idleTimeoutMinutes} onChange={(v) => editApp((d) => { d.security.idleTimeoutMinutes = v })}
          options={IDLE.map((m) => ({ value: m, label: m === 0 ? 'Never' : m < 60 ? `${m} min` : `${m / 60} hour${m > 60 ? 's' : ''}` }))} />
        <p className="mt-2 text-xs text-slate-400">Counts mouse, keyboard and touch activity. Applies to every role, including patients.</p>
      </Section>

      <Section title="Sign-in & patient portal" icon={<LogIn className="h-4 w-4" />}>
        <div className="space-y-3">
          <Toggle label="Allow patients to create their own portal account" hint="Shows “Create account” on the sign-in page. New accounts always get the Patient role." checked={p.allowSignup} onChange={(v) => editSite((d) => { d.portal.allowSignup = v })} />
          <Toggle label="Show one-click demo accounts on the sign-in page" hint="Handy for demos. Turn OFF before going live." checked={p.showDemoLogins} onChange={(v) => editSite((d) => { d.portal.showDemoLogins = v })} />
          {p.showDemoLogins && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Demo accounts use the shared password <b>Demo@123</b>. Change those passwords, or remove the users, in production.</p>}
          <Field label="Sign-in page notice (optional)"><Textarea rows={2} maxLength={240} value={p.loginNotice} onChange={(e) => editSite((d) => { d.portal.loginNotice = e.target.value })} placeholder="e.g. Staff: use your hospital email. Patients: call the front desk for access." /></Field>
        </div>
      </Section>

      <Section title="Roles & permissions" description="What each role can do. Enforced in the database with Row Level Security, not just hidden in the UI."
        icon={<ShieldCheck className="h-4 w-4" />} action={<Link to="/users" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">Manage users<ArrowRight className="h-3.5 w-3.5" /></Link>}>
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead><tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wider text-slate-400">
              <th className="px-5 pb-2 font-semibold">Module</th>{ROLES.map((r) => <th key={r} className="px-2 pb-2 text-center font-semibold">{ROLE_LABEL[r]}</th>)}
            </tr></thead>
            <tbody>
              {Object.entries(PERMISSIONS).map(([table, m]) => (
                <tr key={table} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2 font-medium text-slate-700">{titleCase(table)}</td>
                  {ROLES.map((r) => {
                    const acts = m[r] ?? []
                    return (
                      <td key={r} className="px-2 py-2 text-center">
                        {acts.length ? <span className={cn('inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold', acts.includes('delete') ? 'bg-brand-100 text-brand-900' : acts.length > 1 ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500')} title={acts.join(', ')}>{acts.map((a) => ACT[a]).join('')}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400"><KeyRound className="h-3.5 w-3.5" />R read · C create · U update · D delete. Row rules also apply: doctors see their own patients, and patients see only their own records.</p>
      </Section>
    </div>
  )
}
