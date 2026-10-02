import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider'
import { CheckCircle2, CircleAlert, CircleDashed, Power, RefreshCw, Timer } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Field, Input, Skeleton } from '../../../components/ui'
import { cn, ago } from '../../../lib/utils'
import { supabaseUrl } from '../../../lib/supabase'
import { cronSetup, cronStatus, type CronStatus } from '../../../settings/messaging'
import type { SecretStatus } from '../../../settings/store'
import { SecretInput, Section, type TabCtx } from '../shared'

const QK = ['notify-cron'] as const
const JOBS: Record<string, string> = {
  'dch-notify-flush': 'Deliver queued messages — every minute',
  'dch-scheduled-messages': 'Send due custom / birthday messages — every 5 minutes',
  'dch-appointment-reminders': 'Queue tomorrow’s appointment reminders — daily 6:00 PM IST',
  'dch-outbox-cleanup': 'Delete delivery log older than 400 days — weekly',
}

export function CronCard({ secrets }: { ctx: TabCtx; secrets: SecretStatus[] | undefined }) {
  const qc = useQueryClient()
  const tenant = useAuth().context?.tenant ?? null
  const st = useQuery({ queryKey: QK, queryFn: cronStatus, refetchInterval: 60_000 })
  const defaultUrl = supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1/notify` : ''
  const [url, setUrl] = useState(defaultUrl)
  const keySaved = !!secrets?.some((s) => s.key === 'service_role_key')
  const m = useMutation({
    mutationFn: (on: boolean) => cronSetup(on, url.trim()),
    onSuccess: (s, on) => { qc.setQueryData(QK, s); toast.success(on ? 'Automatic delivery is on' : 'Automatic delivery is off') },
    onError: (e) => toast.error((e as Error).message.replace(/^CRON_MISSING:\s*/, '')),
  })
  const s = st.data as CronStatus | undefined
  const on = !!s?.jobs?.some((j) => j.active)
  const step = (done: boolean, label: React.ReactNode) => (
    <li className="flex gap-2.5">{done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />}<div className="min-w-0 flex-1">{label}</div></li>
  )
  // one scheduler (set up on the main hospital) delivers every hospital's messages
  if (tenant && tenant.is_primary === false) return (
    <Section title={<span className="flex items-center gap-2">Automatic delivery<Badge tone="green" dot>Managed</Badge></span>} icon={<Timer className="h-4 w-4" />}
      description="Delivers the queue every minute, sends scheduled messages and queues tomorrow's reminders every evening — no browser needs to be open.">
      <p className="text-sm text-slate-600">The platform runs this for your hospital — nothing to set up. Your messages go out with your own providers and credentials above.</p>
    </Section>
  )
  return (
    <Section title={<span className="flex items-center gap-2">Automatic delivery (Supabase cron)<Badge tone={s?.demo ? 'slate' : on ? 'green' : 'amber'} dot>{s?.demo ? 'Demo' : on ? 'On' : 'Off'}</Badge></span>} icon={<Timer className="h-4 w-4" />}
      description="Delivers the queue every minute, sends scheduled messages and queues tomorrow's reminders every evening — no browser needs to be open."
      action={!s?.demo && <Button size="icon" variant="ghost" aria-label="Refresh status" onClick={() => st.refetch()}><RefreshCw className={cn('h-4 w-4', st.isFetching && 'animate-spin')} /></Button>}>
      {st.isPending ? <Skeleton className="h-32" /> : st.isError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{(st.error as Error).message}</p> : s?.demo ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Demo mode — nothing runs in the background here. With Supabase connected, this card switches on <b>pg_cron</b> jobs that call the notify function for you.</p>
      ) : s && (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <ol className="space-y-3 text-sm text-slate-700">
            {step(s.pg_cron && s.pg_net, <>Extensions <b>pg_cron</b> and <b>pg_net</b> {s.pg_cron && s.pg_net ? 'are on.' : <>— turned on automatically when you press <i>Turn on</i>; if that is not allowed, enable them in Supabase → Database → Extensions.</>}</>)}
            {step(keySaved, <><span className="block pb-1.5">Service-role key, so the scheduler may call the function:</span><SecretInput name="service_role_key" secrets={secrets} /></>)}
            {step(s.url_set, <Field label="Notify function address" hint="Deploy once: supabase functions deploy notify"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://<project>.supabase.co/functions/v1/notify" className="font-mono text-xs" /></Field>)}
          </ol>
          <div className="space-y-3 rounded-xl bg-slate-50 p-4">
            <div className="flex items-center justify-between text-xs text-slate-500"><span>{s.pending} message{s.pending === 1 ? '' : 's'} waiting</span><span>{s.scheduled} scheduled</span></div>
            {on ? <Button variant="outline" className="w-full" icon={<Power className="h-4 w-4" />} loading={m.isPending} onClick={() => m.mutate(false)}>Turn off</Button>
              : <Button className="w-full" icon={<Power className="h-4 w-4" />} loading={m.isPending} disabled={!keySaved || !/^https:\/\//.test(url)} onClick={() => m.mutate(true)}>Turn on automatic delivery</Button>}
            {s.jobs.length > 0 && <ul className="space-y-2 text-xs">{s.jobs.map((j) => (
              <li key={j.name} className="rounded-lg bg-white p-2.5 ring-1 ring-slate-100">
                <p className="flex items-center gap-1.5 font-medium text-slate-700">{j.last_status === 'failed' ? <CircleAlert className="h-3.5 w-3.5 text-rose-500" /> : <CheckCircle2 className={cn('h-3.5 w-3.5', j.last_status ? 'text-emerald-600' : 'text-slate-300')} />}{JOBS[j.name] ?? j.name}</p>
                <p className="mt-0.5 text-slate-400"><code>{j.schedule}</code> · {j.last_run ? `ran ${ago(j.last_run)}${j.last_status ? ` (${j.last_status})` : ''}` : 'not run yet'}</p>
                {j.last_status === 'failed' && j.last_message && <p className="mt-1 break-words text-rose-600">{j.last_message}</p>}
              </li>
            ))}</ul>}
          </div>
        </div>
      )}
    </Section>
  )
}
