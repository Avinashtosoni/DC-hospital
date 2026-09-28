import { useMemo, useState } from 'react'
import { format, parseISO, subDays } from 'date-fns'
import { Download, FilePlus2, FileX2, History, PencilLine, Search, Users } from 'lucide-react'
import { Button, EmptyState, PageHeader, Select, Skeleton } from '../components/ui'
import { AuditItem, fieldLabel, useAuditResolver } from '../components/RecordHistory'
import { useTable } from '../hooks/useData'
import { AUDIT_TABLE_LABEL, AUDITED_TABLES } from '../lib/audit'
import { cn, downloadCsv, num, today } from '../lib/utils'
import type { AuditEntry } from '../types'

const PAGE = 60
const RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['all', 'All time']] as const

export default function AuditPage() {
  const q = useTable('audit_log')
  const resolve = useAuditResolver()
  const [search, setSearch] = useState('')
  const [table, setTable] = useState('')
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [range, setRange] = useState<(typeof RANGES)[number][0]>('30')
  const [limit, setLimit] = useState(PAGE)

  const rows = useMemo(() => [...(q.data ?? [])].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')), [q.data])
  const actors = useMemo(() => [...new Map(rows.map((r) => [r.actor_name ?? 'System', r.actor_role])).entries()].sort((a, b) => a[0].localeCompare(b[0])), [rows])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    const since = range === 'all' ? '' : subDays(new Date(), Number(range)).toISOString()
    return rows.filter((r) => (!table || r.table_name === table) && (!action || r.action === action) && (!actor || (r.actor_name ?? 'System') === actor)
      && (!since || (r.created_at ?? '') >= since)
      && (!s || `${r.actor_name} ${r.summary} ${AUDIT_TABLE_LABEL[r.table_name] ?? r.table_name} ${Object.keys(r.changes ?? {}).join(' ')}`.toLowerCase().includes(s)))
  }, [rows, search, table, action, actor, range])

  const groups = useMemo(() => {
    const m = new Map<string, AuditEntry[]>()
    filtered.slice(0, limit).forEach((r) => { const d = (r.created_at ?? '').slice(0, 10) ? format(parseISO(r.created_at!), 'yyyy-MM-dd') : '—'; const l = m.get(d); if (l) l.push(r); else m.set(d, [r]) })
    return [...m.entries()]
  }, [filtered, limit])

  const t = today()
  const stats = [
    { label: 'Changes today', value: rows.filter((r) => r.created_at && format(parseISO(r.created_at), 'yyyy-MM-dd') === t).length, icon: History, tone: 'bg-brand-50 text-brand-700' },
    { label: 'Created', value: filtered.filter((r) => r.action === 'insert').length, icon: FilePlus2, tone: 'bg-emerald-50 text-emerald-600' },
    { label: 'Edited', value: filtered.filter((r) => r.action === 'update').length, icon: PencilLine, tone: 'bg-[#292966] text-white' },
    { label: 'Deleted', value: filtered.filter((r) => r.action === 'delete').length, icon: FileX2, tone: 'bg-rose-50 text-rose-600' },
  ]

  const exportCsv = () => downloadCsv(`audit-log-${t}.csv`, filtered.map((r) => ({
    when: r.created_at ? format(parseISO(r.created_at), 'yyyy-MM-dd HH:mm:ss') : '',
    user: r.actor_name ?? 'System', role: r.actor_role ?? '', action: r.action, record_type: AUDIT_TABLE_LABEL[r.table_name] ?? r.table_name,
    record: r.summary ?? '', record_id: r.record_id ?? '',
    changes: Object.entries(r.changes ?? {}).map(([k, v]) => `${fieldLabel(k)}: ${'from' in v ? `${resolve(k, v.from)} → ` : ''}${'to' in v ? resolve(k, v.to) : ''}`).join(' | '),
  })))

  const dayLabel = (d: string) => d === t ? 'Today' : d === format(subDays(new Date(), 1), 'yyyy-MM-dd') ? 'Yesterday' : format(parseISO(d), 'EEEE, d MMMM yyyy')

  return (
    <div>
      <PageHeader title="Audit Log" description="Who changed what, and when — every patient record, appointment, prescription, bill and payment. Entries cannot be edited or deleted."
        actions={<Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!filtered.length}>Export CSV</Button>} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card flex items-center gap-3 p-4">
            <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', s.tone)}><s.icon className="h-5 w-5" /></span>
            <div><p className="font-display text-2xl font-bold text-brand-950">{num(s.value)}</p><p className="text-xs text-slate-500">{s.label}</p></div>
          </div>
        ))}
      </div>

      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setLimit(PAGE) }} placeholder="Search user, record, field…" aria-label="Search audit log" className="input h-9 pl-9 text-sm" />
        </div>
        <Select aria-label="Record type" value={table} onChange={(e) => { setTable(e.target.value); setLimit(PAGE) }} className="h-9 w-auto py-1 text-sm">
          <option value="">All records</option>
          {AUDITED_TABLES.map((x) => <option key={x} value={x}>{AUDIT_TABLE_LABEL[x]}</option>)}
        </Select>
        <Select aria-label="Action" value={action} onChange={(e) => { setAction(e.target.value); setLimit(PAGE) }} className="h-9 w-auto py-1 text-sm">
          <option value="">All actions</option><option value="insert">Created</option><option value="update">Edited</option><option value="delete">Deleted</option>
        </Select>
        <Select aria-label="User" value={actor} onChange={(e) => { setActor(e.target.value); setLimit(PAGE) }} className="h-9 w-auto max-w-[12rem] py-1 text-sm">
          <option value="">Everyone</option>
          {actors.map(([name]) => <option key={name} value={name}>{name}</option>)}
        </Select>
        <Select aria-label="Period" value={range} onChange={(e) => { setRange(e.target.value as typeof range); setLimit(PAGE) }} className="h-9 w-auto py-1 text-sm">
          {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </div>

      {q.isPending ? (
        <div className="card space-y-3 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="card"><EmptyState icon={rows.length ? <Search className="h-6 w-6" /> : <Users className="h-6 w-6" />} title={rows.length ? 'Nothing matches these filters' : 'No activity yet'} description={rows.length ? 'Try a longer period or clear a filter.' : 'Changes made by any user will appear here.'} /></div>
      ) : (
        <div className="space-y-4">
          {groups.map(([day, list]) => (
            <section key={day} className="card p-3 sm:p-4">
              <h3 className="mb-1 flex items-center justify-between px-2 text-xs font-semibold uppercase tracking-wider text-brand-700">{dayLabel(day)}<span className="font-medium normal-case tracking-normal text-slate-400">{list.length} change{list.length === 1 ? '' : 's'}</span></h3>
              <ul className="divide-y divide-[#f2f2fa]">{list.map((e) => <AuditItem key={e.id} e={e} resolve={resolve} />)}</ul>
            </section>
          ))}
          {filtered.length > limit && (
            <div className="text-center"><Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>Show more ({num(filtered.length - limit)} older)</Button></div>
          )}
        </div>
      )}
    </div>
  )
}
