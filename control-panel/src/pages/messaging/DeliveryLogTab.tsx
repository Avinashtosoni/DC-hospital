import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MailX, RefreshCw, RotateCcw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, EmptyState, Input, Select, Skeleton, type Tone } from '../../../../src/components/ui'
import { cp, friendly } from '../../api'
import type { DeliveryFilter, DeliveryRow } from '../../types'
import { dateTime, ErrorBox } from '../../ui'

const STATUS_TONE: Record<DeliveryRow['status'], Tone> = { sent: 'green', pending: 'amber', sending: 'blue', failed: 'red', skipped: 'slate' }
const NO_RETRY = new Set(['otp', 'password_otp', 'test'])
export const canRetry = (r: Pick<DeliveryRow, 'status' | 'kind'>) => (r.status === 'failed' || r.status === 'skipped') && !NO_RETRY.has(r.kind)

/** Every message from every hospital plus the platform's own (alerts, broadcasts, tests), newest first. */
export function DeliveryLogTab() {
  const qc = useQueryClient()
  const [f, setF] = useState<DeliveryFilter>({ status: '', source: '', channel: '', hospital: '', q: '' })
  const [q, setQ] = useState('')
  const hospitals = useQuery({ queryKey: ['cp-hospitals'], queryFn: () => cp.hospitals() })
  const log = useQuery({ queryKey: ['cp-delivery', f], queryFn: () => cp.deliveryLog(f), refetchInterval: 30_000 })
  const retry = useMutation({
    mutationFn: (r: DeliveryRow) => cp.retryMessage(r.source, r.id),
    onSuccess: () => { toast.success('Queued again — it goes out within a minute'); qc.invalidateQueries({ queryKey: ['cp-delivery'] }) },
    onError: (e) => toast.error(friendly(e)),
  })
  const rows = log.data ?? []
  const failed = rows.filter((r) => r.status === 'failed' || r.status === 'skipped').length
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-2 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_repeat(4,auto)_auto]">
        <form className="relative" onSubmit={(e) => { e.preventDefault(); setF({ ...f, q }) }}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" value={q} placeholder="Number, e-mail, event or error… (Enter)" onChange={(e) => setQ(e.target.value)} onBlur={() => setF({ ...f, q })} />
        </form>
        <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Any status</option><option value="failed">Failed</option><option value="pending">Pending</option><option value="sent">Sent</option></Select>
        <Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}><option value="">Any channel</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option><option value="push">Push</option></Select>
        <Select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="">Hospitals + platform</option><option value="hospital">Hospitals</option><option value="platform">Platform (alerts, broadcasts)</option></Select>
        <Select value={f.hospital} onChange={(e) => setF({ ...f, hospital: e.target.value })}><option value="">All hospitals</option>{(hospitals.data ?? []).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</Select>
        <Button variant="ghost" onClick={() => log.refetch()} icon={<RefreshCw className={log.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />}><span className="sr-only">Refresh</span></Button>
      </div>
      {log.error ? <div className="p-4"><ErrorBox error={log.error} onRetry={() => log.refetch()} /></div> : log.isLoading ? <div className="p-4"><Skeleton className="h-48" /></div> : !rows.length ? (
        <EmptyState icon={<MailX className="h-6 w-6" />} title="No messages" description="Nothing matches these filters." />
      ) : (
        <>
          <p className="px-4 pt-3 text-xs text-slate-500">Latest {rows.length}{failed ? ` · ${failed} failed` : ''}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-2">When</th><th className="px-3 py-2">From</th><th className="px-3 py-2">Message</th><th className="px-3 py-2">To</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={`${r.source}:${r.id}`} className="align-top">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{dateTime(r.created_at)}</td>
                    <td className="px-3 py-2.5">{r.source === 'platform' ? <Badge tone="violet">Platform</Badge> : <span className="font-medium text-brand-950">{r.hospital ?? '—'}</span>}
                      {r.source === 'platform' && r.hospital && <p className="text-xs text-slate-500">{r.hospital}</p>}</td>
                    <td className="px-3 py-2.5"><p className="text-brand-950">{r.kind.replace(/_/g, ' ')} <span className="text-xs text-slate-500">· {r.channel}</span></p>{r.subject && <p className="max-w-xs truncate text-xs text-slate-500">{r.subject}</p>}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{r.recipient}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={STATUS_TONE[r.status]}>{r.status}{r.attempts > 1 ? ` · ${r.attempts} tries` : ''}</Badge>
                      {r.error && <p className="mt-1 max-w-xs break-words text-xs text-rose-600">{r.error}</p>}
                      {r.provider_ref && r.status === 'sent' && <p className="mt-1 max-w-xs truncate font-mono text-[11px] text-slate-400">{r.provider_ref}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-right">{canRetry(r) && <Button size="sm" variant="outline" loading={retry.isPending && retry.variables?.id === r.id} icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => retry.mutate(r)}>Retry</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}
