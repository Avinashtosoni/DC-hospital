import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CircleHelp, Clock3, ExternalLink, Mail, MessageCircle, Search, ShieldCheck, UserRound, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton, Tabs } from '../../../src/components/ui'
import { hospitalHost } from '../../../src/tenancy/urls'
import { cp, friendly } from '../api'
import type { CpOnboarding, CpOnboardingHospital, CpOnboardingHelp } from '../types'
import { dateTime, ErrorBox, planLabel, Section, useMe } from '../ui'

const STEP: Record<string, string> = {
  account: 'Owner account', details: 'Hospital details', doctors: 'Add doctors', team: 'Invite the team',
  appointment: 'First appointment', website: 'Review website', domain: 'Custom domain', plan: 'Choose a plan', complete: 'Complete',
}
const pct = (s: CpOnboardingHospital) => {
  const required = ['details', 'doctors', 'team', 'appointment', 'website', 'plan']
  return Math.round(required.filter((x) => s.completed_steps.includes(x)).length * 100 / required.length)
}

type PanelTab = 'hospitals' | 'help'

export function OnboardingPage() {
  const { me } = useMe()
  const qc = useQueryClient()
  const [tab, setTab] = useState<PanelTab>('hospitals')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('incomplete')
  const q = useQuery({ queryKey: ['cp-onboarding'], queryFn: () => cp.onboarding(), staleTime: 30_000 })
  const markHelp = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'open' | 'handled' }) => cp.updateOnboardingHelp(id, status),
    onSuccess: (r) => {
      qc.setQueryData<CpOnboarding>(['cp-onboarding'], (old) => old && ({ ...old, help: old.help.map((h) => h.id === r.id ? { ...h, status: r.status } : h) }))
      toast.success(r.status === 'handled' ? 'Help request marked handled' : 'Help request reopened')
    },
    onError: (e) => toast.error(friendly(e)),
  })
  const saveAi = useMutation({
    mutationFn: ({ id, override }: { id: string; override: boolean | null }) => cp.setAiAssistance(id, override),
    onSuccess: (r) => {
      qc.setQueryData<CpOnboarding>(['cp-onboarding'], (old) => old && ({ ...old, hospitals: old.hospitals.map((h) => h.id === r.tenant_id ? { ...h, ai_assistance_override: r.override, ai_assistance_enabled: r.enabled } : h) }))
      toast.success('AI page assistance updated')
    },
    onError: (e) => toast.error(friendly(e)),
  })
  const hospitals = useMemo(() => (q.data?.hospitals ?? []).filter((h) => {
    if (filter === 'incomplete' && h.current_step === 'complete') return false
    if (filter === 'complete' && h.current_step !== 'complete') return false
    if (filter === 'consented' && !h.followup_consent) return false
    if (filter === 'no-owner' && h.owner_joined) return false
    const needle = search.trim().toLowerCase()
    return !needle || [h.name, h.owner_name, h.owner_email, h.owner_phone, h.city, h.slug].some((x) => x?.toLowerCase().includes(needle))
  }), [q.data?.hospitals, filter, search])
  const openHelp = (q.data?.help ?? []).filter((h) => h.status === 'open').length

  return (
    <>
      <PageHeader title="Onboarding & setup help" description="Track each hospital’s persisted setup progress, follow-up eligibility and requests for help. AI access follows the selected plan unless overridden." />
      {q.error && <div className="mb-4"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'hospitals', label: 'Hospital progress', count: q.data?.hospitals.length ?? 0 }, { value: 'help', label: 'Help requests', count: openHelp }]} />
      {q.isLoading ? <div className="mt-5 grid gap-3 md:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
        : tab === 'hospitals' ? (
          <>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input className="pl-9" aria-label="Search hospitals or owners" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search hospital, owner, mobile or city" /></div>
              <Select className="sm:w-56" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter onboarding hospitals">
                <option value="incomplete">Needs setup</option><option value="complete">Setup complete</option><option value="consented">Follow-up consented</option><option value="no-owner">Owner not signed up</option><option value="all">All hospitals</option>
              </Select>
            </div>
            {!hospitals.length ? <Card className="mt-4"><EmptyState icon={<Users className="h-6 w-6" />} title="No hospitals match" description="Try another filter or search." /></Card> : (
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                {hospitals.map((h) => <HospitalCard key={h.id} hospital={h} isAdmin={me.role === 'admin'} busy={saveAi.isPending && saveAi.variables?.id === h.id}
                  onAi={(override) => saveAi.mutate({ id: h.id, override })} />)}
              </div>
            )}
          </>
        ) : (
          <div className="mt-5">
            {!q.data?.help.length ? <Card><EmptyState icon={<CircleHelp className="h-6 w-6" />} title="No help requests" description="Owner requests for help with setup will appear here." /></Card> : (
              <div className="grid gap-4 lg:grid-cols-2">
                {q.data.help.map((h) => <HelpCard key={h.id} help={h} busy={markHelp.isPending && markHelp.variables?.id === h.id} onStatus={(status) => markHelp.mutate({ id: h.id, status })} />)}
              </div>
            )}
          </div>
        )}
    </>
  )
}

function HospitalCard({ hospital: h, isAdmin, busy, onAi }: { hospital: CpOnboardingHospital; isAdmin: boolean; busy: boolean; onAi: (v: boolean | null) => void }) {
  const value = h.ai_assistance_override === true ? 'enabled' : h.ai_assistance_override === false ? 'disabled' : 'plan'
  return (
    <Section title={<span className="flex flex-wrap items-center gap-2"><Link to={`/hospitals/${h.id}`} className="text-brand-900 hover:underline">{h.name}</Link><Badge tone={h.owner_joined ? 'green' : 'amber'}>{h.owner_joined ? 'Owner joined' : 'Awaiting owner'}</Badge></span>}
      subtitle={`${planLabel(h.plan)} · created ${dateTime(h.created_at)}`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 text-sm">
          <p className="flex items-center gap-2 text-slate-700"><UserRound className="h-3.5 w-3.5 text-slate-400" />{h.owner_name || 'Owner name not set'}</p>
          {h.owner_email && <a href={`mailto:${h.owner_email}`} className="flex items-center gap-2 text-brand-700 hover:underline"><Mail className="h-3.5 w-3.5" />{h.owner_email}</a>}
          {h.owner_phone && <a href={`tel:${h.owner_phone}`} className="flex items-center gap-2 text-brand-700 hover:underline"><MessageCircle className="h-3.5 w-3.5" />{h.owner_phone}</a>}
          {h.city && <p className="text-xs text-slate-500">{h.city}</p>}
          <a className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-700" href={`${location.protocol}//${hospitalHost({ slug: h.slug })}`} target="_blank" rel="noreferrer">Hospital website <ExternalLink className="h-3 w-3" /></a>
        </div>
        <div>
          <div className="flex items-center justify-between text-xs"><span className="font-semibold text-slate-700">{pct(h)}% complete</span><span className="text-slate-500">Next: {STEP[h.current_step] ?? h.current_step}</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-700" style={{ width: `${pct(h)}%` }} /></div>
          <p className="mt-2 text-xs text-slate-500">Last activity {dateTime(h.last_activity_at)} · {h.reminder_count}/3 follow-ups sent</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs"><Clock3 className="h-3 w-3 text-slate-400" />Next check {h.next_followup_at ? dateTime(h.next_followup_at) : 'not scheduled'}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center gap-2 text-xs"><Badge tone={h.followup_consent ? 'green' : 'slate'}>{h.followup_consent ? 'External follow-ups consented' : 'No external consent'}</Badge>
          <Badge tone={h.ai_assistance_enabled ? 'violet' : 'slate'}><ShieldCheck className="mr-1 h-3 w-3" />AI {h.ai_assistance_enabled ? 'enabled' : 'off'}</Badge></div>
        {isAdmin && <Select aria-label={`AI assistance for ${h.name}`} className="max-w-[210px] text-xs" value={value} disabled={busy} onChange={(e) => onAi(e.target.value === 'plan' ? null : e.target.value === 'enabled')}>
          <option value="plan">AI: use plan setting</option><option value="enabled">AI: enable override</option><option value="disabled">AI: disable override</option>
        </Select>}
      </div>
    </Section>
  )
}

function HelpCard({ help: h, busy, onStatus }: { help: CpOnboardingHelp; busy: boolean; onStatus: (s: 'open' | 'handled') => void }) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><Link to={`/hospitals/${h.hospital_id}`} className="font-display font-semibold text-brand-950 hover:underline">{h.hospital}</Link>
          <p className="mt-1 text-xs text-slate-500">{h.owner_name || 'Owner'} · {h.owner_email || 'No e-mail'} · {dateTime(h.created_at)}</p></div>
        <Badge tone={h.status === 'open' ? 'amber' : 'green'}>{h.status}</Badge>
      </div>
      <p className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">{h.message}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {h.owner_email && <a href={`mailto:${h.owner_email}`}><Button size="sm" variant="outline" icon={<Mail className="h-3.5 w-3.5" />}>E-mail owner</Button></a>}
        <Button size="sm" variant={h.status === 'open' ? 'primary' : 'outline'} loading={busy} icon={<Check className="h-3.5 w-3.5" />} onClick={() => onStatus(h.status === 'open' ? 'handled' : 'open')}>{h.status === 'open' ? 'Mark handled' : 'Reopen'}</Button>
      </div>
    </Card>
  )
}
