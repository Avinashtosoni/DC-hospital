import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ClipboardCheck, RefreshCw, XCircle } from 'lucide-react'
import { Badge, Button, Skeleton } from '../../../src/components/ui'
import { cn } from '../../../src/lib/utils'
import { cp } from '../api'
import type { LaunchCheck } from '../types'
import { dateTime, ErrorBox, Section } from '../ui'

/** things the database can't see — ticked here by the admin (kept in this browser), explained in docs/GO_LIVE.md */
export const MANUAL_CHECKS: { id: string; title: string; detail: string }[] = [
  { id: 'region', title: 'Supabase project in Mumbai (ap-south-1), Pro plan', detail: 'Patient data stays in India; Pro gives daily backups and no pausing.' },
  { id: 'smtp', title: 'Auth e-mails through your own SMTP', detail: 'Supabase → Auth → SMTP (e.g. Resend / SES). The built-in sender allows only a few e-mails per hour.' },
  { id: 'auth_urls', title: 'Auth Site URL and redirect URLs', detail: 'Site URL = the product domain; add https://*.your-domain and every hospital domain pattern to the redirect list.' },
  { id: 'razorpay', title: 'Razorpay live keys + webhook', detail: 'billing function secrets RAZORPAY_KEY_ID / _SECRET / _WEBHOOK_SECRET; webhook → …/functions/v1/billing?webhook=razorpay. Make a ₹1 test payment.' },
  { id: 'messaging', title: 'Platform messaging sender', detail: 'E-mail, SMS / WhatsApp keys in the notify function; send yourself a test from the main hospital.' },
  { id: 'backup', title: 'Off-site backup tested', detail: 'GitHub Action “Database backup” has SUPABASE_DB_URL + BACKUP_PASSPHRASE and a restore was tried on a scratch project.' },
  { id: 'legal', title: 'Company details on the legal pages', detail: 'PLATFORM_LEGAL_NAME / ADDRESS / EMAIL / PHONE / GRIEVANCE_OFFICER set; the texts reviewed by a lawyer.' },
  { id: 'csp', title: 'Security headers enforced', detail: 'CSP_MODE=enforce (default) and no CSP errors in the browser console on the site, dashboard, payment and push.' },
  { id: 'domains', title: 'Custom domains', detail: 'domains function secrets CF_API_TOKEN / CF_ZONE_ID / CF_CNAME_TARGET; connect one test domain end to end.' },
  { id: 'monitoring', title: 'Error reporting (optional)', detail: 'SENTRY_DSN set and an uptime monitor on https://your-domain/healthz.' },
]
const KEY = 'cp-launch-manual'
const ICON = { ok: <CheckCircle2 className="h-5 w-5 text-emerald-600" />, warn: <AlertTriangle className="h-5 w-5 text-amber-600" />, fail: <XCircle className="h-5 w-5 text-rose-600" /> }

export function LaunchChecklist() {
  const q = useQuery({ queryKey: ['cp-launch'], queryFn: () => cp.launchCheck() })
  const [done, setDone] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} } })
  const toggle = (id: string) => setDone((d) => { const n = { ...d, [id]: !d[id] }; try { localStorage.setItem(KEY, JSON.stringify(n)) } catch { /* private mode */ } return n })
  const checks = q.data?.checks ?? []
  const fails = checks.filter((c) => c.status === 'fail').length
  const warns = checks.filter((c) => c.status === 'warn').length
  const manual = MANUAL_CHECKS.filter((m) => done[m.id]).length
  const ready = q.data && fails === 0 && manual === MANUAL_CHECKS.length

  return (
    <Section title={<span className="inline-flex items-center gap-2"><ClipboardCheck className="h-4 w-4" />Launch checklist</span>}
      subtitle={q.data ? `Checked ${dateTime(q.data.at)} · ${fails} to fix · ${warns} to review · ${manual}/${MANUAL_CHECKS.length} manual steps ticked` : 'Is the platform ready for paying hospitals?'}
      action={<div className="flex items-center gap-2">{q.data && <Badge tone={ready ? 'green' : fails ? 'red' : 'amber'}>{ready ? 'Ready to launch' : fails ? 'Not ready' : 'Almost there'}</Badge>}
        <Button variant="outline" icon={<RefreshCw className={cn('h-4 w-4', q.isFetching && 'animate-spin')} />} onClick={() => q.refetch()}>Re-check</Button></div>}>
      {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-48" /> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Checked in the database</p>
            <ul className="divide-y divide-slate-100">
              {[...checks].sort((a, b) => rank(a) - rank(b)).map((c) => (
                <li key={c.id} className="flex gap-3 py-2.5">
                  <span className="mt-0.5 shrink-0">{ICON[c.status]}</span>
                  <span className="min-w-0"><span className="block text-sm font-medium text-brand-950">{c.title}</span><span className="block text-xs text-slate-500">{c.detail}</span></span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Manual — tick when done (docs/GO_LIVE.md)</p>
            <ul className="divide-y divide-slate-100">
              {MANUAL_CHECKS.map((m) => (
                <li key={m.id}>
                  <label className="flex cursor-pointer gap-3 py-2.5">
                    <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[#5C5C99]" checked={!!done[m.id]} onChange={() => toggle(m.id)} />
                    <span className="min-w-0"><span className={cn('block text-sm font-medium', done[m.id] ? 'text-slate-400 line-through' : 'text-brand-950')}>{m.title}</span><span className="block text-xs text-slate-500">{m.detail}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Section>
  )
}
const rank = (c: LaunchCheck) => ({ fail: 0, warn: 1, ok: 2 }[c.status])
