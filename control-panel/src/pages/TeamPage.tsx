import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, UserCog, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton } from '../../../src/components/ui'
import { cn } from '../../../src/lib/utils'
import { cp, friendly } from '../api'
import type { CpMember, MemberSave, ProviderRole } from '../types'
import { date, dateTime, ErrorBox, ROLE_LABEL, ROLE_TONE, useMe } from '../ui'

const ROLE_HELP: Record<ProviderRole, string> = {
  admin: 'Every hospital, full access — this panel, billing, team and settings.',
  support: 'Assigned hospitals only. Acts as the owner inside them; patient records stay read-only.',
  finance: 'Assigned hospitals only. Payments and wallets; acts as the accountant inside them.',
}

export function TeamPage() {
  const { me } = useMe()
  const [edit, setEdit] = useState<MemberSave | null>(null)
  const [isNew, setIsNew] = useState(false)
  const q = useQuery({ queryKey: ['cp-team'], queryFn: () => cp.team() })
  const open = (m?: CpMember) => {
    setIsNew(!m)
    setEdit(m ? { email: m.email, role: m.role, active: m.active, hospitals: m.hospitals.map((h) => h.id) } : { email: '', role: 'support', active: true, hospitals: [] })
  }
  return (
    <>
      <PageHeader title="Team" description="People at Hospital Comrade who can work on hospitals. Every action they take is logged."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => open()}>Add member</Button>} />
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      <Card className="overflow-hidden">
        {q.isLoading ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          : !q.data?.length ? <EmptyState icon={<Users className="h-6 w-6" />} title="No team members" />
          : (
            <ul className="divide-y divide-slate-100">
              {q.data.map((m) => (
                <li key={m.user_id} className={cn('flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center', !m.active && 'opacity-60')}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={m.name} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{m.name}{m.email === me.email && <span className="ml-1.5 text-xs text-slate-400">(you)</span>}</p>
                      <p className="truncate text-xs text-slate-500">{m.email} · since {date(m.since)}{m.last_action && ` · last action ${dateTime(m.last_action)}`}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                    {!m.active && <Badge tone="red">No access</Badge>}
                    <span className="text-xs text-slate-500">{m.role === 'admin' ? 'All hospitals' : m.hospitals.length ? m.hospitals.map((h) => h.name).join(', ') : 'No hospitals assigned'}</span>
                    <Button size="sm" variant="outline" icon={<UserCog className="h-3.5 w-3.5" />} onClick={() => open(m)}>Edit</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Card>
      {edit && <MemberModal value={edit} isNew={isNew} onClose={() => setEdit(null)} />}
    </>
  )
}

function MemberModal({ value, isNew, onClose }: { value: MemberSave; isNew: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState(value)
  const hospitals = useQuery({ queryKey: ['cp-hospitals'], queryFn: () => cp.hospitals() })
  const save = useMutation({
    mutationFn: () => cp.saveMember(f),
    onSuccess: () => { toast.success(isNew ? 'Added to the team' : 'Saved'); qc.invalidateQueries({ queryKey: ['cp-team'] }); onClose() },
    onError: (e) => toast.error(friendly(e)),
  })
  const toggle = (id: string) => setF((x) => ({ ...x, hospitals: x.hospitals.includes(id) ? x.hospitals.filter((h) => h !== id) : [...x.hospitals, id] }))
  return (
    <Modal open onClose={onClose} title={isNew ? 'Add a team member' : `Edit ${value.email}`} size="max-w-lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()} disabled={!f.email}>{isNew ? 'Add member' : 'Save'}</Button></>}>
      <div className="space-y-4">
        {isNew && (
          <Field label="Their account’s e-mail" required hint="They create an account first (Sign up on the platform website) with a work e-mail that isn’t used at any hospital.">
            <Input id="tm-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoFocus />
          </Field>
        )}
        <Field label="Role">
          <Select id="tm-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as ProviderRole })}>
            {(['admin', 'support', 'finance'] as const).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
          <p className="mt-1.5 text-xs text-slate-500">{ROLE_HELP[f.role]}</p>
        </Field>
        {f.role !== 'admin' && (
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Hospitals</p>
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {(hospitals.data ?? []).map((h) => (
                <label key={h.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-brand-50/50">
                  <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={f.hospitals.includes(h.id)} onChange={() => toggle(h.id)} />
                  <span className="flex-1">{h.name}</span><span className="text-xs text-slate-400">{h.slug}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {!isNew && (
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
            Has access (untick to remove access — their history stays in the audit log)
          </label>
        )}
      </div>
    </Modal>
  )
}
