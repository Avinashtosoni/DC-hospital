import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Megaphone, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Textarea } from '../../../src/components/ui'
import { cp, friendly } from '../api'
import type { Announcement, AnnouncementSave } from '../types'
import { dateTime, ErrorBox, isAdmin, useMe } from '../ui'

const ROLES = [['owner', 'Owners'], ['doctor', 'Doctors'], ['receptionist', 'Receptionists'], ['accountant', 'Accountants'], ['staff', 'Staff']] as const
const LEVEL_TONE = { info: 'blue', warning: 'amber', critical: 'red' } as const
/** <input type="datetime-local"> works in local time without a zone */
const toLocal = (iso?: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '')
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null)
const BLANK: AnnouncementSave = { title: '', body: '', level: 'info', hospital_ids: null, roles: ['owner'], starts_at: null, ends_at: null, active: true }

/** Phase F: a banner inside the hospital app — maintenance, new features, payment reminders. */
export function AnnouncementsPage() {
  const { me } = useMe()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['cp-announcements'], queryFn: () => cp.announcements() })
  const [edit, setEdit] = useState<AnnouncementSave | null>(null)
  const [del, setDel] = useState<Announcement | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => cp.deleteAnnouncement(id),
    onSuccess: () => { toast.success('Announcement deleted'); setDel(null); qc.invalidateQueries({ queryKey: ['cp-announcements'] }) },
    onError: (e) => toast.error(friendly(e)),
  })
  const admin = isAdmin(me.role)
  return (
    <>
      <PageHeader title="Announcements" description="Shown at the top of the hospital app to the roles you choose. Info / warning can be dismissed; critical stays until it ends."
        actions={admin && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ ...BLANK })}>New announcement</Button>} />
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? <Skeleton className="h-40" /> : !q.data?.length ? (
        <Card><EmptyState icon={<Megaphone className="h-6 w-6" />} title="No announcements" description="Tell every hospital about planned maintenance or a new feature." /></Card>
      ) : (
        <div className="space-y-3">
          {q.data.map((a) => (
            <Card key={a.id} className="p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-brand-950">{a.title}</p>
                    <Badge tone={LEVEL_TONE[a.level]}>{a.level}</Badge>
                    {a.live ? <Badge tone="green" dot>Live</Badge> : <Badge>{a.active ? (Date.parse(a.starts_at) > Date.now() ? 'Scheduled' : 'Ended') : 'Off'}</Badge>}
                  </div>
                  {a.body && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{a.body}</p>}
                  <p className="mt-2 text-xs text-slate-500">
                    {a.hospital_ids?.length ? a.hospitals.map((x) => x.name).join(', ') : 'All hospitals'} · {a.roles.join(', ')} · {dateTime(a.starts_at)} → {a.ends_at ? dateTime(a.ends_at) : 'no end'}
                    {a.created_by_name ? ` · by ${a.created_by_name}` : ''}
                  </p>
                </div>
                {admin && <div className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit({ id: a.id, title: a.title, body: a.body, level: a.level, hospital_ids: a.hospital_ids, roles: a.roles, starts_at: a.starts_at, ends_at: a.ends_at, active: a.active })}>Edit</Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5 text-rose-600" />} onClick={() => setDel(a)}><span className="sr-only">Delete</span></Button>
                </div>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && <EditModal value={edit} onClose={() => setEdit(null)} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} loading={remove.isPending} title={`Delete “${del?.title}”?`} description="It disappears from every hospital right away."
        onConfirm={() => del && remove.mutate(del.id)} />
    </>
  )
}

function EditModal({ value, onClose }: { value: AnnouncementSave; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState(value)
  const hospitals = useQuery({ queryKey: ['cp-hospitals'], queryFn: () => cp.hospitals() })
  const save = useMutation({
    mutationFn: () => cp.saveAnnouncement({ ...f, hospital_ids: f.hospital_ids?.length ? f.hospital_ids : null }),
    onSuccess: () => { toast.success('Announcement saved'); qc.invalidateQueries({ queryKey: ['cp-announcements'] }); onClose() },
    onError: (e) => toast.error(friendly(e)),
  })
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  return (
    <Modal open onClose={onClose} size="max-w-xl" title={f.id ? 'Edit announcement' : 'New announcement'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={f.title.trim().length < 3 || !f.roles.length} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3">
        <Field label="Title"><Input value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Planned maintenance tonight 11 pm – 12 am" /></Field>
        <Field label="Message (optional)"><Textarea rows={3} maxLength={1000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Level"><Select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as AnnouncementSave['level'] })}><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></Select></Field>
          <Field label="From"><Input type="datetime-local" value={toLocal(f.starts_at)} onChange={(e) => setF({ ...f, starts_at: fromLocal(e.target.value) })} /></Field>
          <Field label="Until (optional)"><Input type="datetime-local" value={toLocal(f.ends_at)} onChange={(e) => setF({ ...f, ends_at: fromLocal(e.target.value) })} /></Field>
        </div>
        <Field label="Who sees it">
          <div className="flex flex-wrap gap-3 pt-1 text-sm">
            {ROLES.map(([r, l]) => <label key={r} className="inline-flex items-center gap-1.5"><input type="checkbox" className="accent-brand-700" checked={f.roles.includes(r)} onChange={() => setF({ ...f, roles: toggle(f.roles, r) })} />{l}</label>)}
          </div>
        </Field>
        <Field label="Hospitals" hint="None ticked = every hospital">
          <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 p-2 text-sm">
            {(hospitals.data ?? []).map((h) => (
              <label key={h.id} className="flex items-center gap-2 py-0.5"><input type="checkbox" className="accent-brand-700" checked={!!f.hospital_ids?.includes(h.id)} onChange={() => setF({ ...f, hospital_ids: toggle(f.hospital_ids ?? [], h.id) })} />{h.name}</label>
            ))}
          </div>
        </Field>
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-700" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Active</label>
      </div>
    </Modal>
  )
}
