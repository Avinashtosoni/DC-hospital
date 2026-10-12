/**
 * Platform settings → Demo hospital (scripts/sql/demo.sql): the public demo (DC Hospital). How its one-time codes
 * work (shown on screen or really sent), whether its other messages go out, the one-click sign-ins, the nightly reset
 * at 03:00 IST, "Reset now", and the baseline (its settings + website, restored after every reset).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FlaskConical, MonitorSmartphone, RotateCcw, Save, Send, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Skeleton } from '../../../../src/components/ui'
import { cn } from '../../../../src/lib/utils'
import { Toggle } from '../../../../src/pages/cms/fields'
import { hospitalUrl } from '../../../../src/tenancy/urls'
import { cp, friendly } from '../../api'
import type { CpDemo } from '../../types'
import { dateTime, ErrorBox } from '../../ui'

export function DemoTab() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['cp-demo'], queryFn: () => cp.demo() })
  const done = (d: CpDemo) => qc.setQueryData(['cp-demo'], d)
  const save = useMutation({ mutationFn: (p: Record<string, unknown>) => cp.saveDemo(p), onSuccess: (d) => { done(d); toast.success('Saved') }, onError: (e) => toast.error(friendly(e)) })
  const reset = useMutation({ mutationFn: () => cp.resetDemo(), onSuccess: (d) => { done(d); toast.success('Demo hospital reset', { description: 'Visitors’ data removed, demo data loaded again.' }) }, onError: (e) => toast.error(friendly(e)) })
  const baseline = useMutation({ mutationFn: () => cp.saveDemoBaseline(), onSuccess: (d) => { done(d); toast.success('Baseline saved', { description: 'Every reset now restores these settings and this website.' }) }, onError: (e) => toast.error(friendly(e)) })

  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  const d = q.data
  if (!d) return <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>

  if (!d.hospital || !d.seed_installed) return (
    <Card className="p-5">
      <p className="flex items-center gap-2 font-semibold text-slate-900"><TriangleAlert className="h-5 w-5 text-amber-500" />The demo hospital is not set up yet</p>
      <p className="mt-2 text-sm text-slate-600">Run <code className="rounded bg-slate-100 px-1">supabase/demo-hospital.sql</code> once in the Supabase SQL editor (after the upgrade).
        It makes the primary hospital (DC Hospital) the public demo, loads its demo doctors, staff, patients and appointments, and from then on it is reset every night at 03:00 IST.
        <b> Everything currently in the primary hospital is replaced.</b></p>
    </Card>
  )

  const c = d.config
  const busy = save.isPending || reset.isPending || baseline.isPending
  const url = hospitalUrl({ slug: d.hospital.slug })
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-semibold text-slate-900"><FlaskConical className="h-5 w-5 text-brand-600" />{d.hospital.name}<Badge tone="violet">Demo</Badge></p>
            <p className="mt-1 text-sm text-slate-600">Public demo with sample doctors, staff, patients and appointments. Sign-ins, booking and codes work and are saved — until the next reset. Every other hospital is real.</p>
            <p className="mt-2 text-xs text-slate-500">Last reset: <b>{d.last_reset_at ? dateTime(d.last_reset_at) : 'never'}</b>{d.last_reset_by ? ` by ${d.last_reset_by}` : d.last_reset_at ? ' (scheduled)' : ''}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={url} target="_blank" rel="noopener"><Button variant="ghost" icon={<ExternalLink className="h-4 w-4" />}>Open demo</Button></a>
            <Button variant="danger" loading={reset.isPending} disabled={busy} icon={<RotateCcw className="h-4 w-4" />}
              onClick={() => { if (confirm('Reset the demo hospital now? Everything visitors added (patients, bookings, sign-ups) is deleted and the demo data is loaded again.')) reset.mutate() }}>Reset now</Button>
          </div>
        </div>
        <div className="mt-4">
          <Toggle label="Reset every night at 03:00 IST" hint={d.scheduled ? 'Runs on the database scheduler (pg_cron).' : 'pg_cron is not on in this database — only “Reset now” works until it is.'}
            checked={c.nightly} onChange={(v) => save.mutate({ nightly: v })} />
        </div>
      </Card>

      <Card className="p-5">
        <p className="font-semibold text-slate-900">One-time codes (sign-in and booking)</p>
        <p className="mt-1 text-sm text-slate-600">The demo hospital’s own sign-in OTP and booking-code switches are in its Settings → Security.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {([['screen', MonitorSmartphone, 'Show on screen', 'Nothing is sent. The code appears on the page and is filled in — no SMS / WhatsApp cost.'],
            ['real', Send, 'Really send', 'Codes go out like in a real hospital, on the channels set up in the demo hospital (costs apply).']] as const).map(([v, I, label, hint]) => (
            <button key={v} type="button" disabled={busy} aria-pressed={c.otp === v} onClick={() => c.otp !== v && save.mutate({ otp: v })}
              className={cn('rounded-xl border p-3 text-left transition disabled:opacity-60', c.otp === v ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200' : 'border-slate-200 hover:border-brand-200')}>
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-900"><I className="h-4 w-4 text-brand-600" />{label}</span>
              <span className="mt-1 block text-xs text-slate-500">{hint}</span>
            </button>
          ))}
        </div>
        <div className="mt-3">
          <Toggle label="Send other messages too" hint="Booking confirmations, reminders, invitations… Off: they are recorded as skipped and never sent."
            checked={c.messages} onChange={(v) => save.mutate({ messages: v })} />
        </div>
      </Card>

      <Card className="p-5">
        <p className="font-semibold text-slate-900">One-click demo sign-ins</p>
        <Toggle label="Show the demo accounts on the demo’s sign-in page" hint="Buttons for every role, with the shared password shown."
          checked={c.logins} onChange={(v) => save.mutate({ logins: v })} />
        {d.logins.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 text-sm">
            {d.logins.map((l) => (
              <div key={l.email} className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 last:border-0">
                <span className="capitalize text-slate-700">{l.role}</span><span className="truncate text-slate-500">{l.name} · {l.email}</span>
              </div>
            ))}
            <p className="bg-slate-50 px-3 py-2 text-xs text-slate-500">Password: <code className="font-semibold text-slate-800">{d.password}</code> — visitors can’t change it; it comes back with every reset anyway.</p>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <p className="font-semibold text-slate-900">Baseline: settings and website</p>
        <p className="mt-1 text-sm text-slate-600">Set the demo up the way it should look (Open as Admin → Settings, Website), then save it here. Every reset restores it; without a baseline the defaults come back.
          Keys and custom domains are never touched by a reset.</p>
        <p className="mt-2 text-xs text-slate-500">{d.baseline ? <>Saved {d.baseline.at ? dateTime(d.baseline.at) : ''}{d.baseline.by ? ` by ${d.baseline.by}` : ''} — {d.baseline.settings} settings groups, {d.baseline.pages} website sections.</> : 'No baseline saved — resets load the defaults.'}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" loading={baseline.isPending} disabled={busy} icon={<Save className="h-4 w-4" />}
            onClick={() => { if (confirm('Save the demo hospital’s current settings and website as the baseline?')) baseline.mutate() }}>Save current setup as baseline</Button>
          {d.baseline && <Button variant="ghost" disabled={busy} onClick={() => { if (confirm('Forget the baseline? Resets load the defaults again.')) save.mutate({ clearBaseline: true }) }}>Forget baseline</Button>}
        </div>
      </Card>
    </div>
  )
}
