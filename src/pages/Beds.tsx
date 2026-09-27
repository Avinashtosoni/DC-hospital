import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BedDouble, Pencil, Plus, Trash2, UserPlus, Wrench } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { can } from '../auth/permissions'
import { useCreate, useRemove, useTable, useUpdate } from '../hooks/useData'
import { useResourceCtx } from '../resources/useResourceCtx'
import { defineResource } from '../resources/types'
import { ResourceFormDrawer } from '../components/ResourceForm'
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, Modal, PageHeader, Skeleton, StatCard, StatusBadge } from '../components/ui'
import { cn, fmtDate, money, titleCase } from '../lib/utils'
import type { Bed, Ward } from '../types'

const wardsRes = defineResource({
  table: 'wards', path: '/beds', title: 'Wards', singular: 'Ward', icon: BedDouble, columns: [], searchText: (r) => r.name,
  fields: [
    { name: 'name', label: 'Ward name', type: 'text', required: true, span: 2 },
    { name: 'type', label: 'Type', type: 'select', required: true, options: ['general', 'icu', 'private', 'semi_private', 'maternity', 'pediatric', 'emergency'].map((v) => ({ value: v, label: titleCase(v) })), default: () => 'general' },
    { name: 'floor', label: 'Floor', type: 'text', required: true, default: () => 'Ground Floor' },
    { name: 'daily_rate', label: 'Daily rate (₹)', type: 'currency', required: true, min: 0, default: () => 1500 },
  ],
})
const bedsRes = defineResource({
  table: 'beds', path: '/beds', title: 'Beds', singular: 'Bed', icon: BedDouble, columns: [], searchText: (r) => r.bed_number, relations: ['wards'],
  fields: [
    { name: 'ward_id', label: 'Ward', type: 'relation', required: true, relation: { table: 'wards', label: (w) => w.name } },
    { name: 'bed_number', label: 'Bed number', type: 'text', required: true, placeholder: 'e.g. GM-11' },
    { name: 'status', label: 'Status', type: 'select', required: true, options: ['available', 'maintenance', 'reserved', 'occupied'].map((v) => ({ value: v, label: titleCase(v) })), default: () => 'available' },
  ],
})

const tile: Record<Bed['status'], string> = {
  available: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400',
  occupied: 'border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-400',
  maintenance: 'border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-400',
  reserved: 'border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-400',
}

export default function BedsPage() {
  const { user } = useAuth()
  const role = user!.role
  const wards = useTable('wards')
  const beds = useTable('beds')
  const admissions = useTable('admissions')
  const patients = useTable('patients')
  const { ctx } = useResourceCtx(['wards'])
  const updBed = useUpdate('beds', { label: 'Bed' })
  const createBed = useCreate('beds', { label: 'Bed' })
  const removeBed = useRemove('beds', { label: 'Bed' })
  const createWard = useCreate('wards', { label: 'Ward' })
  const updWard = useUpdate('wards', { label: 'Ward' })
  const [filter, setFilter] = useState<'all' | Bed['status']>('all')
  const [selected, setSelected] = useState<Bed | null>(null)
  const [wardForm, setWardForm] = useState<{ open: boolean; row: Ward | null }>({ open: false, row: null })
  const [bedForm, setBedForm] = useState<{ open: boolean; row: Bed | null; ward?: string }>({ open: false, row: null })
  const [deleting, setDeleting] = useState<Bed | null>(null)
  const isOwner = can(role, 'wards', 'create')
  const canUpd = can(role, 'beds', 'update')

  const occupantOf = useMemo(() => {
    const m = new Map<string, { patientId: string; name: string; since: string; reason?: string | null }>()
    ;(admissions.data ?? []).filter((a) => a.status === 'admitted' && a.bed_id).forEach((a) => {
      m.set(a.bed_id!, { patientId: a.patient_id, name: patients.data?.find((p) => p.id === a.patient_id)?.full_name ?? 'Patient', since: a.admission_date, reason: a.reason })
    })
    return m
  }, [admissions.data, patients.data])

  const all = beds.data ?? []
  const count = (s: Bed['status']) => all.filter((b) => b.status === s).length
  const loading = wards.isLoading || beds.isLoading
  const sel = selected ? all.find((b) => b.id === selected.id) ?? selected : null
  const selOcc = sel ? occupantOf.get(sel.id) : undefined

  return (
    <div>
      <PageHeader title="Bed Management" description="Live ward occupancy. Click a bed to view or change its status."
        actions={isOwner && <>
          <Button variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setBedForm({ open: true, row: null })}>Add bed</Button>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setWardForm({ open: true, row: null })}>Add ward</Button>
        </>} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Occupancy" value={all.length ? `${Math.round((count('occupied') / all.length) * 100)}%` : '—'} icon={<BedDouble className="h-5 w-5" />} loading={loading} hint={`${all.length} beds total`} />
        <StatCard label="Available" value={count('available')} icon={<BedDouble className="h-5 w-5" />} tone="green" loading={loading} />
        <StatCard label="Occupied" value={count('occupied')} icon={<BedDouble className="h-5 w-5" />} tone="red" loading={loading} />
        <StatCard label="Maintenance / reserved" value={count('maintenance') + count('reserved')} icon={<Wrench className="h-5 w-5" />} tone="amber" loading={loading} />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {(['all', 'available', 'occupied', 'reserved', 'maintenance'] as const).map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={cn('rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition', filter === s ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')}>
            {s} {s !== 'all' && <span className="opacity-60">· {count(s)}</span>}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-5">
        {loading && Array.from({ length: 3 }).map((_, i) => <Card key={i} className="p-5"><Skeleton className="h-4 w-48" /><div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-10">{Array.from({ length: 10 }).map((_, j) => <Skeleton key={j} className="h-20" />)}</div></Card>)}
        {!loading && (wards.data ?? []).length === 0 && <Card><EmptyState icon={<BedDouble className="h-6 w-6" />} title="No wards configured" description="Add your first ward and beds to start tracking occupancy." action={isOwner && <Button onClick={() => setWardForm({ open: true, row: null })}>Add ward</Button>} /></Card>}
        {!loading && [...(wards.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((w) => {
          const wb = all.filter((b) => b.ward_id === w.id).sort((a, b) => a.bed_number.localeCompare(b.bed_number, undefined, { numeric: true }))
          const shown = wb.filter((b) => filter === 'all' || b.status === filter)
          if (filter !== 'all' && !shown.length) return null
          const free = wb.filter((b) => b.status === 'available').length
          return (
            <Card key={w.id} className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-slate-900">{w.name}</h3>
                  <Badge tone="slate">{titleCase(w.type)}</Badge>
                  <span className="hidden text-xs text-slate-500 sm:inline">{w.floor} · {money(w.daily_rate)}/day</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('text-xs font-medium', free ? 'text-emerald-600' : 'text-rose-600')}>{free} of {wb.length} free</span>
                  {isOwner && <>
                    <Button variant="ghost" size="sm" onClick={() => setBedForm({ open: true, row: null, ward: w.id })} icon={<Plus className="h-3.5 w-3.5" />}>Bed</Button>
                    <Button variant="ghost" size="sm" onClick={() => setWardForm({ open: true, row: w })} aria-label="Edit ward"><Pencil className="h-3.5 w-3.5" /></Button>
                  </>}
                </div>
              </div>
              {wb.length === 0 ? <p className="mt-4 text-sm text-slate-400">No beds in this ward yet.</p> : (
                <div className="mt-4 grid grid-cols-3 gap-2.5 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
                  {shown.map((b) => {
                    const occ = occupantOf.get(b.id)
                    return (
                      <button key={b.id} onClick={() => setSelected(b)} className={cn('group flex h-20 flex-col items-start justify-between rounded-xl border p-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-md', tile[b.status])}>
                        <div className="flex w-full items-center justify-between"><span className="text-xs font-bold">{b.bed_number}</span><BedDouble className="h-3.5 w-3.5 opacity-60" /></div>
                        <span className="w-full truncate text-[11px] font-medium opacity-90">{occ ? occ.name : titleCase(b.status)}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </Card>
          )
        })}
      </div>

      <Modal open={!!sel} onClose={() => setSelected(null)} title={sel ? `Bed ${sel.bed_number}` : ''}>
        {sel && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm">
              <span className="text-slate-500">{wards.data?.find((w) => w.id === sel.ward_id)?.name}</span><StatusBadge value={sel.status} />
            </div>
            {selOcc ? (
              <Link to={`/patients/${selOcc.patientId}`} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 hover:border-brand-300">
                <Avatar name={selOcc.name} />
                <div><div className="font-medium text-slate-900">{selOcc.name}</div><div className="text-xs text-slate-500">Since {fmtDate(selOcc.since)} · {selOcc.reason}</div></div>
              </Link>
            ) : sel.status === 'available' && can(role, 'admissions', 'create') ? (
              <Link to={`/admissions?new=1&bed_id=${sel.id}`}><Button className="w-full" icon={<UserPlus className="h-4 w-4" />}>Admit a patient to this bed</Button></Link>
            ) : null}
            {canUpd && sel.status !== 'occupied' && (
              <div>
                <p className="label">Set status</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['available', 'reserved', 'maintenance'] as const).map((s) => (
                    <button key={s} onClick={() => updBed.mutate({ id: sel.id, patch: { status: s } })} className={cn('rounded-lg border px-2 py-2 text-xs font-medium capitalize transition', sel.status === s ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {sel.status === 'occupied' && <p className="text-xs text-slate-500">Discharge the patient from <Link to="/admissions?status=admitted" className="font-medium text-brand-700">Admissions</Link> to free this bed.</p>}
            {isOwner && (
              <div className="flex justify-between border-t border-slate-100 pt-4">
                <Button variant="ghost" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { setBedForm({ open: true, row: sel }); setSelected(null) }}>Edit bed</Button>
                <Button variant="ghost" size="sm" className="text-rose-600 hover:bg-rose-50" disabled={sel.status === 'occupied'} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { setDeleting(sel); setSelected(null) }}>Delete</Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {ctx && <>
        <ResourceFormDrawer def={wardsRes} ctx={ctx} open={wardForm.open} initial={wardForm.row} rows={wards.data ?? []} onClose={() => setWardForm({ open: false, row: null })}
          onSubmit={(v) => { setWardForm({ open: false, row: null }); if (wardForm.row) updWard.mutate({ id: wardForm.row.id, patch: v }); else createWard.mutate(v as never) }} />
        <ResourceFormDrawer def={bedsRes} ctx={ctx} open={bedForm.open} initial={bedForm.row} prefill={bedForm.ward ? { ward_id: bedForm.ward } : {}} rows={all} onClose={() => setBedForm({ open: false, row: null })}
          onSubmit={(v) => { setBedForm({ open: false, row: null }); if (bedForm.row) updBed.mutate({ id: bedForm.row.id, patch: v }); else createBed.mutate(v as never) }} />
      </>}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => { if (deleting) removeBed.mutate(deleting.id); setDeleting(null) }} title={`Delete bed ${deleting?.bed_number}?`} description="The bed will be removed from the ward." />
    </div>
  )
}
