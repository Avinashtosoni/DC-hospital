/**
 * Incident register (DPDP Rules 2025: personal-data breaches go to the Data Protection Board within 72 hours, and
 * to the affected people without delay). Admin records and updates; support can read. Every change is timestamped.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertOctagon, CheckCircle2, Clock, Mail, Plus, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Textarea } from '../../../src/components/ui'
import { cn } from '../../../src/lib/utils'
import { cp, friendly } from '../api'
import type { CpIncident, IncidentSave, IncidentStatus, Severity } from '../types'
import { dateTime, ErrorBox, isAdmin, Section, useMe } from '../ui'

const SEV: Record<Severity, { label: string; tone: 'slate' | 'amber' | 'red' | 'violet' }> = {
  low: { label: 'Low', tone: 'slate' }, medium: { label: 'Medium', tone: 'amber' }, high: { label: 'High', tone: 'red' }, critical: { label: 'Critical', tone: 'violet' },
}
const STATUS: Record<IncidentStatus, { label: string; tone: 'red' | 'amber' | 'green' }> = {
  open: { label: 'Open', tone: 'red' }, contained: { label: 'Contained', tone: 'amber' }, resolved: { label: 'Resolved', tone: 'green' },
}

function hoursLeft(deadline: string) { return Math.round((Date.parse(deadline) - Date.now()) / 3600_000) }

function Deadline({ i }: { i: CpIncident }) {
  if (!i.personal_data) return <span className="text-xs text-slate-400">No personal data involved</span>
  if (i.board_reported_at) return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Reported to the Board {dateTime(i.board_reported_at)}</span>
  const h = hoursLeft(i.deadline)
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', h < 0 ? 'text-rose-700' : h < 24 ? 'text-amber-700' : 'text-slate-600')}>
      <Clock className="h-3.5 w-3.5" />{h < 0 ? `Board report overdue by ${-h} h` : `Report to the Board within ${h} h`} ({dateTime(i.deadline)})
    </span>
  )
}

const noticeTemplate = (i: CpIncident) => `On ${dateTime(i.detected_at)} we found a security incident: ${i.title}.

What data: ${i.personal_data ? 'personal data of your patients may be involved' : 'no personal data is involved'}.
What we have done: ${i.status === 'open' ? 'we are investigating and will update you' : 'the problem is contained'}.
What you should do: nothing for now — we will contact you if your patients need to be told.

For questions, reply to this e-mail.`

export function IncidentsPage() {
  const { me } = useMe()
  const admin = isAdmin(me.role)
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['cp-incidents'], queryFn: () => cp.incidents() })
  const hospitals = useQuery({ queryKey: ['cp-hospitals'], queryFn: () => cp.hospitals() })
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const open = q.data?.find((i) => i.id === openId) ?? null
  const done = () => { qc.invalidateQueries({ queryKey: ['cp-incidents'] }); qc.invalidateQueries({ queryKey: ['cp-health'] }) }

  return (
    <>
      <PageHeader title="Incidents" description="Security incidents and personal-data breaches. Personal-data breaches must reach the Data Protection Board within 72 hours."
        actions={admin && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Record incident</Button>} />
      {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
        : q.data.length === 0 ? <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No incidents recorded" description="Good. If something goes wrong — a lost laptop, a leaked export, a wrong e-mail — record it here straight away; the 72-hour clock starts when you find it." />
        : (
          <div className="space-y-3">
            {q.data.map((i) => (
              <button key={i.id} type="button" onClick={() => setOpenId(i.id)} className="block w-full rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition hover:border-brand-200">
                <div className="flex flex-wrap items-center gap-2">
                  <AlertOctagon className={cn('h-4 w-4', i.status === 'resolved' ? 'text-slate-400' : 'text-rose-600')} />
                  <p className="font-semibold text-brand-950">{i.title}</p>
                  <Badge tone={SEV[i.severity].tone}>{SEV[i.severity].label}</Badge>
                  <Badge tone={STATUS[i.status].tone} dot>{STATUS[i.status].label}</Badge>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>Found {dateTime(i.detected_at)}</span>
                  {i.hospitals.length > 0 && <span>{i.hospitals.map((h) => h.name).join(', ')}</span>}
                  {i.affected_people != null && <span>{i.affected_people.toLocaleString('en-IN')} people</span>}
                  {i.status !== 'resolved' && <Deadline i={i} />}
                </div>
              </button>
            ))}
          </div>
        )}
      {creating && <IncidentForm hospitals={hospitals.data ?? []} onClose={() => setCreating(false)} onSaved={(i) => { done(); setCreating(false); setOpenId(i.id) }} />}
      {open && <IncidentDetail i={open} admin={admin} onClose={() => setOpenId(null)} onChanged={done} />}
    </>
  )
}

function IncidentForm({ hospitals, onClose, onSaved }: { hospitals: { id: string; name: string }[]; onClose: () => void; onSaved: (i: CpIncident) => void }) {
  const [f, setF] = useState<IncidentSave & { detected_local: string }>({ title: '', description: '', severity: 'medium', personal_data: true, affected_tenants: [], affected_people: null,
    detected_local: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) })
  const save = useMutation({
    mutationFn: () => cp.saveIncident({ title: f.title, description: f.description, severity: f.severity, personal_data: f.personal_data, affected_tenants: f.affected_tenants,
      affected_people: f.affected_people, detected_at: new Date(f.detected_local).toISOString() }),
    onSuccess: (i) => { toast.success('Incident recorded'); onSaved(i) },
    onError: (e) => toast.error(friendly(e)),
  })
  return (
    <Modal open onClose={onClose} title="Record an incident" size="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Record</Button></>}>
      <div className="grid gap-3">
        <Field label="What happened (short)" required><Input value={f.title} maxLength={200} autoFocus onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Export file e-mailed to the wrong address" /></Field>
        <Field label="Details"><Textarea rows={3} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Found at" hint="The 72-hour clock starts here"><Input type="datetime-local" value={f.detected_local} onChange={(e) => setF({ ...f, detected_local: e.target.value })} /></Field>
          <Field label="Severity"><Select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value as Severity })}>{Object.entries(SEV).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={!!f.personal_data} onChange={(e) => setF({ ...f, personal_data: e.target.checked })} /> Personal data involved (a breach under the DPDP Act)</label>
        <Field label="Affected hospitals">
          <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
            {hospitals.map((h) => {
              const on = f.affected_tenants?.includes(h.id)
              return <button key={h.id} type="button" onClick={() => setF({ ...f, affected_tenants: on ? f.affected_tenants!.filter((x) => x !== h.id) : [...(f.affected_tenants ?? []), h.id] })}
                className={cn('rounded-full border px-3 py-1 text-xs font-medium transition', on ? 'border-brand-700 bg-brand-900 text-white' : 'border-slate-200 text-slate-600 hover:border-brand-300')}>{h.name}</button>
            })}
          </div>
        </Field>
        <Field label="People affected (estimate)"><Input type="number" min={0} value={f.affected_people ?? ''} onChange={(e) => setF({ ...f, affected_people: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
      </div>
    </Modal>
  )
}

function IncidentDetail({ i, admin, onClose, onChanged }: { i: CpIncident; admin: boolean; onClose: () => void; onChanged: () => void }) {
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const timeline = useMemo(() => [...i.timeline].reverse(), [i.timeline])
  const save = useMutation({
    mutationFn: (p: IncidentSave) => cp.saveIncident({ id: i.id, ...p }),
    onSuccess: () => { setNote(''); onChanged(); toast.success('Incident updated') },
    onError: (e) => toast.error(friendly(e)),
  })
  const notify = useMutation({
    mutationFn: () => cp.notifyIncident(i.id, notice ?? ''),
    onSuccess: (r) => {
      setNotice(null); onChanged()
      const manual = r.filter((x) => !x.queued)
      if (manual.length) toast.warning(`Notice queued for ${r.length - manual.length}; contact by hand: ${manual.map((x) => x.name).join(', ')}`, { duration: 10_000 })
      else toast.success(`Notice sent to ${r.length} hospital owner${r.length === 1 ? '' : 's'}`)
    },
    onError: (e) => toast.error(friendly(e)),
  })

  return (
    <Modal open onClose={onClose} size="max-w-2xl" title={i.title}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={SEV[i.severity].tone}>{SEV[i.severity].label}</Badge>
          <Badge tone={STATUS[i.status].tone} dot>{STATUS[i.status].label}</Badge>
          {i.status !== 'resolved' && <Deadline i={i} />}
        </div>
        {i.description && <p className="whitespace-pre-line text-slate-700">{i.description}</p>}
        <dl className="grid gap-2 rounded-xl bg-slate-50 p-3 text-xs sm:grid-cols-2">
          <div><dt className="text-slate-500">Found</dt><dd className="font-medium text-slate-800">{dateTime(i.detected_at)}</dd></div>
          <div><dt className="text-slate-500">Recorded by</dt><dd className="font-medium text-slate-800">{i.created_by_name ?? '—'}</dd></div>
          <div><dt className="text-slate-500">Hospitals</dt><dd className="font-medium text-slate-800">{i.hospitals.map((h) => h.name).join(', ') || '—'}</dd></div>
          <div><dt className="text-slate-500">Hospitals notified</dt><dd className="font-medium text-slate-800">{i.hospitals_notified_at ? dateTime(i.hospitals_notified_at) : 'Not yet'}</dd></div>
        </dl>

        {admin && (
          <div className="space-y-3 rounded-xl border border-slate-100 p-3">
            <div className="flex flex-wrap gap-2">
              {(['open', 'contained', 'resolved'] as IncidentStatus[]).filter((s) => s !== i.status).map((s) => (
                <Button key={s} size="sm" variant="outline" loading={save.isPending && save.variables?.status === s} onClick={() => save.mutate({ status: s, note })}>Mark {STATUS[s].label.toLowerCase()}</Button>
              ))}
              {i.personal_data && !i.board_reported_at && <Button size="sm" variant="secondary" onClick={() => save.mutate({ board_reported: true, note: note || 'Reported to the Data Protection Board' })}>Reported to the Board</Button>}
              {i.hospitals.length > 0 && <Button size="sm" variant="outline" icon={<Mail className="h-3.5 w-3.5" />} onClick={() => setNotice(noticeTemplate(i))}>Notify hospital owners</Button>}
            </div>
            <div className="flex gap-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to the timeline (what you found / did)" />
              <Button size="md" disabled={!note.trim()} loading={save.isPending && !save.variables?.status && !save.variables?.board_reported} onClick={() => save.mutate({ note })}>Add</Button>
            </div>
          </div>
        )}

        <Section title="Timeline">
          <ol className="space-y-2">
            {timeline.map((t, k) => (
              <li key={k} className="flex gap-3 text-xs">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                <div><p className="text-slate-800">{t.note}</p><p className="text-slate-400">{dateTime(t.at)}{t.by ? ` · ${t.by}` : ''}</p></div>
              </li>
            ))}
          </ol>
        </Section>
      </div>

      <Modal open={notice !== null} onClose={() => setNotice(null)} size="max-w-lg" title="Notice to hospital owners"
        footer={<><Button variant="ghost" onClick={() => setNotice(null)}>Cancel</Button><Button loading={notify.isPending} icon={<Mail className="h-4 w-4" />} onClick={() => notify.mutate()}>Send to {i.hospitals.length}</Button></>}>
        <p className="mb-2 text-xs text-slate-500">E-mailed (and pushed) to the owner of {i.hospitals.map((h) => h.name).join(', ')}. Platform notices are never blocked by plan limits.</p>
        <Textarea rows={10} value={notice ?? ''} onChange={(e) => setNotice(e.target.value)} />
      </Modal>
    </Modal>
  )
}
