import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, MessageCircle, MessageSquare, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Input, Select, Skeleton } from '../../../../src/components/ui'
import { cp, friendly } from '../../api'
import type { Channel, CpHospitalDetail, HospitalMessaging } from '../../types'
import { ErrorBox, isAdmin, paise, Section, useMe } from '../../ui'

const CH: { id: Channel; label: string; icon: typeof Mail }[] = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle }, { id: 'sms', label: 'SMS', icon: MessageSquare }, { id: 'email', label: 'E-mail', icon: Mail },
]
type Draft = Record<Channel, { enabled: boolean; source: 'own' | 'platform'; limit: string }>
const toDraft = (m: HospitalMessaging): Draft => Object.fromEntries(CH.map(({ id }) => [id, {
  enabled: m.channels[id]?.enabled ?? false, source: m.channels[id]?.source ?? 'own', limit: m.monthlyLimit[id] != null ? String(m.monthlyLimit[id]) : '',
}])) as Draft

/** Phase D: channels on/off, own vs shared (platform) accounts, and a monthly cap on the shared accounts. */
export function MessagingTab({ h }: { h: CpHospitalDetail }) {
  const { me } = useMe()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['cp-messaging', h.id], queryFn: () => cp.messaging(h.id) })
  const [d, setD] = useState<Draft | null>(null)
  useEffect(() => { if (q.data) setD(toDraft(q.data)) }, [q.data])
  const save = useMutation({
    mutationFn: () => cp.saveMessaging(h.id, {
      channels: Object.fromEntries(CH.map(({ id }) => [id, { enabled: d![id].enabled, source: d![id].source }])),
      monthlyLimit: Object.fromEntries(CH.map(({ id }) => [id, d![id].limit.trim() === '' ? null : Number(d![id].limit)])),
    }),
    onSuccess: (r) => { qc.setQueryData(['cp-messaging', h.id], r); qc.invalidateQueries({ queryKey: ['cp-hospital'] }); toast.success('Messaging saved') },
    onError: (e) => toast.error(friendly(e)),
  })
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  if (!q.data || !d) return <Skeleton className="h-72" />
  const m = q.data
  const admin = isAdmin(me.role)
  const dirty = JSON.stringify(d) !== JSON.stringify(toDraft(m))

  return (
    <Section title="Messages" subtitle={`This month · wallet ${paise(m.wallet_paise)}. “Shared” = the ${'Hospital Comrade'} accounts (plan includes some, extra paid from the wallet); “Own” = the hospital’s own provider keys.`}
      action={admin && <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-5 py-2">Channel</th><th className="px-5 py-2">On</th><th className="px-5 py-2">Account</th><th className="px-5 py-2 text-right">Sent (shared · own)</th><th className="px-5 py-2 text-right">Queued</th><th className="px-5 py-2">Monthly cap (shared)</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {CH.map(({ id, label, icon: Icon }) => {
              const shared = m.usage[`${id}:platform`]?.sent ?? 0, own = m.usage[`${id}:own`]?.sent ?? 0
              const cap = m.monthlyLimit[id]
              const row = d[id]
              const set = (p: Partial<Draft[Channel]>) => setD({ ...d, [id]: { ...row, ...p } })
              return (
                <tr key={id}>
                  <td className="px-5 py-3"><span className="inline-flex items-center gap-2 font-medium text-slate-800"><Icon className="h-4 w-4 text-brand-600" />{label}</span>
                    {m.included[id] != null && <p className="text-[11px] text-slate-500">{Number(m.included[id]).toLocaleString('en-IN')} included in the plan</p>}</td>
                  <td className="px-5 py-3"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={row.enabled} disabled={!admin} onChange={(e) => set({ enabled: e.target.checked })} aria-label={`${label} on`} /></td>
                  <td className="px-5 py-3"><Select value={row.source} disabled={!admin} className="h-8 w-32 py-0 text-xs" onChange={(e) => set({ source: e.target.value as 'own' | 'platform' })} aria-label={`${label} account`}>
                    <option value="platform">Shared</option><option value="own">Own</option></Select></td>
                  <td className="px-5 py-3 text-right tabular-nums">{shared.toLocaleString('en-IN')} · {own.toLocaleString('en-IN')}
                    {cap != null && shared >= cap && <div><Badge tone="red">cap reached</Badge></div>}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{(m.pending[id] ?? 0).toLocaleString('en-IN')}</td>
                  <td className="px-5 py-3"><Input type="number" min={0} className="h-8 w-28 text-xs" placeholder="no cap" value={row.limit} disabled={!admin} onChange={(e) => set({ limit: e.target.value })} aria-label={`${label} monthly cap`} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">When the cap is reached, further messages on the shared account this month are skipped (including OTPs) — the hospital can switch to its own account or you can raise the cap.
        {!admin && ' Only admins can change these.'}</p>
    </Section>
  )
}
