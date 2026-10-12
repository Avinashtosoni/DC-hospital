import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, FilePlus2, FileX2, History, PencilLine } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { qk, useByIds, useLookup } from '../hooks/useData'
import { queryAll } from '../data/adapter'
import { AUDIT_TABLE_LABEL, formatAuditValue } from '../lib/audit'
import { cn, fmtDate, fmtTime, titleCase } from '../lib/utils'
import type { AuditEntry } from '../types'
import { ROLE_LABEL, type Role } from '../types'
import { Badge, EmptyState, Skeleton } from './ui'

export const ACTION_META = {
  insert: { verb: 'created', icon: FilePlus2, tone: 'bg-emerald-50 text-emerald-600 ring-emerald-200' },
  update: { verb: 'updated', icon: PencilLine, tone: 'bg-brand-50 text-brand-700 ring-brand-200' },
  delete: { verb: 'deleted', icon: FileX2, tone: 'bg-rose-50 text-rose-600 ring-rose-200' },
} as const

const FIELD_LABEL: Record<string, string> = {
  patient_id: 'Patient', doctor_id: 'Doctor', department_id: 'Department', appointment_date: 'Date', appointment_time: 'Time',
  amount_paid: 'Amount paid', invoice_number: 'Invoice no.', full_name: 'Name', date_of_birth: 'Date of birth', mrn: 'MRN',
  start_date: 'From', end_date: 'To', start_time: 'Block from', end_time: 'Block until', holiday_date: 'Date', contacted_at: 'Patient contacted',
  booking_ref: 'Booking ref', avatar_url: 'Photo', bed_id: 'Bed', invoice_id: 'Invoice', paid_on: 'Paid on', unit_price: 'Rate',
}
export const fieldLabel = (k: string) => FIELD_LABEL[k] ?? titleCase(k)

/** Turns ids into names (patients / doctors / departments) so a diff reads like English. */
export function useAuditResolver(entries: AuditEntry[] = []) {
  // patient names only for the entries on screen (the patients table is never downloaded whole)
  const patientIds = useMemo(() => entries.flatMap((e) => {
    const c = (e.changes ?? {}) as Record<string, { from?: unknown; to?: unknown }>
    return [c.patient_id?.from, c.patient_id?.to].filter((x): x is string => typeof x === 'string')
  }), [entries])
  const patients = useByIds('patients', patientIds)
  const doctors = useLookup('doctors'), departments = useLookup('departments')
  return useMemo(() => (key: string, v: unknown): string => {
    if (typeof v === 'string') {
      if (key === 'patient_id') return patients.get(v)?.full_name ?? 'Patient'
      if (key === 'doctor_id') return doctors.get(v)?.full_name ?? 'Doctor'
      if (key === 'department_id') return departments.get(v)?.name ?? 'Department'
      if (key === 'avatar_url') return v ? 'New photo' : '—'
      if (/_at$/.test(key) && !Number.isNaN(Date.parse(v))) return fmtDate(v, 'dd MMM yyyy, HH:mm')
      if (/^\d{2}:\d{2}/.test(v) && key.includes('time')) return fmtTime(v)
      if (key === 'status' || key === 'method' || key === 'kind' || key === 'gender' || key === 'type' || key === 'role' || key === 'source') return titleCase(v)
    }
    if (key === 'items' && Array.isArray(v)) return v.map((i: { description?: string; quantity?: number }) => `${i.quantity ?? 1}× ${i.description ?? ''}`).join('; ') || '—'
    if (key === 'medications' && Array.isArray(v)) return v.map((m: { name?: string; dosage?: string }) => [m.name, m.dosage].filter(Boolean).join(' ')).join('; ') || '—'
    return formatAuditValue(v)
  }, [patients, doctors, departments])
}

export const recordHref = (e: Pick<AuditEntry, 'table_name' | 'record_id' | 'action'>) => {
  if (!e.record_id || e.action === 'delete') return null
  if (e.table_name === 'patients') return `/patients/${e.record_id}`
  if (e.table_name === 'invoices') return `/invoices/${e.record_id}`
  if (e.table_name === 'prescriptions') return `/prescriptions/${e.record_id}`
  return null
}

export function AuditItem({ e, resolve, showTable = true, defaultOpen = false }: { e: AuditEntry; resolve: ReturnType<typeof useAuditResolver>; showTable?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const meta = ACTION_META[e.action]
  const keys = Object.keys(e.changes ?? {})
  const href = recordHref(e)
  const role = e.actor_role as Role | 'public' | 'system' | undefined
  const roleLabel = role && role in ROLE_LABEL ? ROLE_LABEL[role as Role] : role === 'public' ? 'Website' : 'System'
  const brief = e.action === 'update' ? keys.slice(0, 3).map(fieldLabel).join(', ') + (keys.length > 3 ? ` +${keys.length - 3}` : '') : `${keys.length} field${keys.length === 1 ? '' : 's'}`
  return (
    <li className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-brand-50/50">
        <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset', meta.tone)}><meta.icon className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-slate-700">
            <b className="font-semibold text-slate-900">{e.actor_name ?? 'System'}</b> {meta.verb}{' '}
            {showTable && <span className="font-medium text-slate-800">{(AUDIT_TABLE_LABEL[e.table_name] ?? titleCase(e.table_name)).toLowerCase()} </span>}
            {e.summary && (href ? <Link to={href} onClick={(ev) => ev.stopPropagation()} className="font-medium text-brand-700 hover:underline">{e.summary}</Link> : <span className="font-medium text-brand-800">{e.summary}</span>)}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
            <span className="tabular-nums">{fmtDate(e.created_at, 'dd MMM yyyy · hh:mm a')}</span>
            <Badge tone={role === 'public' ? 'violet' : role === 'system' ? 'slate' : 'blue'}>{roleLabel}</Badge>
            {keys.length > 0 && <span className="truncate">· {brief}</span>}
          </span>
        </span>
        {keys.length > 0 && <ChevronDown className={cn('mt-2 h-4 w-4 shrink-0 text-slate-400 transition', open && 'rotate-180')} />}
      </button>
      {open && keys.length > 0 && (
        <div className="mb-2 ml-11 mr-2 overflow-x-auto rounded-xl border border-[#ececf8] bg-white">
          <table className="w-full min-w-[420px] text-xs">
            <thead><tr className="bg-[#fafaff] text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-3 py-1.5">Field</th>{e.action !== 'insert' && <th className="px-3 py-1.5">{e.action === 'delete' ? 'Value' : 'Before'}</th>}{e.action !== 'delete' && <th className="px-3 py-1.5">{e.action === 'insert' ? 'Value' : 'After'}</th>}
            </tr></thead>
            <tbody className="divide-y divide-[#f2f2fa]">
              {keys.map((k) => (
                <tr key={k} className="align-top">
                  <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-600">{fieldLabel(k)}</td>
                  {e.action !== 'insert' && <td className={cn('px-3 py-1.5 text-slate-500', e.action === 'update' && 'line-through decoration-rose-300')}>{resolve(k, e.changes[k].from)}</td>}
                  {e.action !== 'delete' && <td className={cn('px-3 py-1.5', e.action === 'update' ? 'font-medium text-emerald-700' : 'text-slate-700')}>{resolve(k, e.changes[k].to)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  )
}

/** Timeline of every change to the given records (owner only — others can't read other people's audit rows). */
export function RecordHistory({ ids, title = 'Change history', table }: { ids: string[]; title?: string; table?: string }) {
  const key = useMemo(() => [...new Set(ids)].sort(), [ids])
  // only the audit rows for these records (indexed on table_name, record_id)
  const q = useQuery({
    queryKey: [...qk('audit_log'), 'records', key.join(',')],
    queryFn: async () => {
      const out: AuditEntry[] = []
      for (let i = 0; i < Math.min(key.length, 600); i += 150) out.push(...await queryAll('audit_log', { where: [['record_id', 'in', key.slice(i, i + 150)]] }, 2000))
      return out
    },
    enabled: key.length > 0,
    staleTime: 30_000,
  })
  const [all, setAll] = useState(false)
  const rows = useMemo(() => [...(q.data ?? [])].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')), [q.data])
  const resolve = useAuditResolver(all ? rows : rows.slice(0, 8))
  const shown = all ? rows : rows.slice(0, 8)
  return (
    <section className="card p-4 sm:p-5" aria-label={title}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold text-brand-950"><History className="h-4 w-4 text-brand-600" />{title}</h3>
        <span className="text-xs text-slate-500">{rows.length} change{rows.length === 1 ? '' : 's'}</span>
      </div>
      {q.isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
        : rows.length === 0 ? <EmptyState icon={<History className="h-5 w-5" />} title="No changes recorded yet" description="Every create, edit and delete from now on appears here with who did it and when." />
          : <>
            <ul className="-mx-2 divide-y divide-[#f2f2fa]">{shown.map((e) => <AuditItem key={e.id} e={e} resolve={resolve} showTable={table !== e.table_name} />)}</ul>
            {rows.length > 8 && <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 w-full rounded-lg py-2 text-xs font-medium text-brand-700 hover:bg-brand-50">{all ? 'Show less' : `Show all ${rows.length} changes`}</button>}
          </>}
    </section>
  )
}

