import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox, Mail, MapPin, Phone } from 'lucide-react'
import { toast } from 'sonner'
import { Card, EmptyState, PageHeader, Select, Skeleton, Tabs, Textarea } from '../../../src/components/ui'
import { cp, friendly } from '../api'
import type { CpLead, LeadStatus } from '../types'
import { dateTime, ErrorBox, planLabel } from '../ui'

const LABEL: Record<LeadStatus, string> = { new: 'New', contacted: 'Contacted', won: 'Won', lost: 'Lost' }

export function LeadsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'all' | LeadStatus>('new')
  const q = useQuery({ queryKey: ['cp-leads'], queryFn: () => cp.leads() })
  const upd = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { status?: LeadStatus; notes?: string | null } }) => cp.updateLead(id, patch),
    // optimistic: the list changes at once, rolled back if the save fails
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['cp-leads'] })
      const before = qc.getQueryData<CpLead[]>(['cp-leads'])
      qc.setQueryData<CpLead[]>(['cp-leads'], (l) => l?.map((x) => (x.id === id ? { ...x, ...patch } : x)))
      return { before }
    },
    onError: (e, _v, ctx) => { qc.setQueryData(['cp-leads'], ctx?.before); toast.error(friendly(e)) },
    onSettled: () => qc.invalidateQueries({ queryKey: ['cp-overview'] }),
  })
  const all = q.data ?? []
  const rows = tab === 'all' ? all : all.filter((l) => l.status === tab)
  const count = (s: LeadStatus) => all.filter((l) => l.status === s).length

  return (
    <>
      <PageHeader title="Leads" description="Hospitals that filled in “Talk to us” on the product website." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'new', label: 'New', count: count('new') }, { value: 'contacted', label: 'Contacted', count: count('contacted') },
        { value: 'won', label: 'Won', count: count('won') }, { value: 'lost', label: 'Lost', count: count('lost') }, { value: 'all', label: 'All', count: all.length }]} />
      <div className="mt-4">
        {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
        {q.isLoading ? <div className="grid gap-3 md:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
          : !rows.length ? <Card><EmptyState icon={<Inbox className="h-6 w-6" />} title="No leads here" description="New enquiries from the product website appear in “New”." /></Card>
          : (
            <div className="grid gap-4 md:grid-cols-2">
              {rows.map((l) => (
                <Card key={l.id} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display font-semibold text-brand-950">{l.organisation}</p>
                      <p className="text-sm text-slate-600">{l.name}{l.plan && <> · interested in <span className="font-medium">{l.plan === 'unsure' ? 'not sure yet' : planLabel(l.plan)}</span></>}</p>
                    </div>
                    <Select aria-label="Lead status" value={l.status} onChange={(e) => upd.mutate({ id: l.id, patch: { status: e.target.value as LeadStatus } })} className="w-32">
                      {Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                    <a href={`tel:${l.phone}`} className="inline-flex items-center gap-1.5 hover:text-brand-800"><Phone className="h-3.5 w-3.5" />{l.phone}</a>
                    {l.email && <a href={`mailto:${l.email}`} className="inline-flex items-center gap-1.5 hover:text-brand-800"><Mail className="h-3.5 w-3.5" />{l.email}</a>}
                    {l.city && <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{l.city}</span>}
                  </div>
                  {l.message && <p className="mt-3 rounded-lg bg-brand-50/60 px-3 py-2 text-sm text-slate-700">{l.message}</p>}
                  <Textarea rows={2} className="mt-3" placeholder="Notes (only your team sees these)" defaultValue={l.notes ?? ''} aria-label="Notes"
                    onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (l.notes ?? null)) upd.mutate({ id: l.id, patch: { notes: v } }) }} />
                  <p className="mt-2 text-xs text-slate-400">{dateTime(l.created_at)}{l.source && ` · ${l.source}`}</p>
                </Card>
              ))}
            </div>
          )}
      </div>
    </>
  )
}
