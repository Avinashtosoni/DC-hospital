import { useMemo, useState } from 'react'
import { format, parseISO, subDays } from 'date-fns'
import { Download, FilePlus2, FileX2, History, PencilLine, Search, Users } from 'lucide-react'
import { Button, EmptyState, PageHeader, Select, Skeleton } from '../components/ui'
import { AuditItem, fieldLabel, useAuditResolver } from '../components/RecordHistory'
import { useCount, useRows, useTable } from '../hooks/useData'
import { queryAll } from '../data/adapter'
import type { Filter } from '../data/query'
import { useDebounced } from '../components/ResourcePage'
import { AUDIT_TABLE_LABEL, AUDITED_TABLES } from '../lib/audit'
import { cn, downloadCsv, num, today } from '../lib/utils'
import type { AuditEntry } from '../types'

const PAGE = 60
const RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['all', 'All time']] as const

export default function AuditPage() {
  const [search, setSearch] = useState('')
  const [table, setTable] = useState('')
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [range, setRange] = useState<(typeof RANGES)[number][0]>('30')
  const [limit, setLimit] = useState(PAGE)
  const term = useDebounced(search)
  const profiles = useTable('profiles')

  // filters run in the database; "Show more" asks for the next block of rows
  const since = useMemo(() => (range === 'all' ? '' : new Date(Math.floor(Date.now() / 3_600_000 - Number(range) * 24) * 3_600_000).toISOString()), [range])
  const base = useMemo<Filter[]>(() => [
    ...(table ? [['table_name', 'eq', table] as Filter] : []),
    ...(actor ? [actor === 'System' ? ['actor_name', 'is_null'] as Filter : ['actor_name', 'eq', actor] as Filter] : []),
    ...(since ? [['created_at', 'gte', since] as Filter] : []),
  ], [table, actor, since])
  const where = useMemo<Filter[]>(() => [...base, ...(action ? [['action', 'eq', action] as Filter] : [])], [base, action])
  const search_ = term ? { term, columns: ['actor_name', 'summary', 'table_name'] } : undefined
  const q = useRows('audit_log', { where, search: search_, order: [{ column: 'created_at', asc: false }], range: [0, limit - 1], count: true }, { keepPrevious: true })
  const filtered = useMemo(() => q.data?.rows ?? [], [q.data])
  const total = q.data?.count ?? 0
  const startOfToday = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }, [])
  const todayCount = useCount('audit_log', [['created_at', 'gte', startOfToday]])
  const created = useRows('audit_log', { where: [...base, ['action', 'eq', 'insert']], search: search_, head: true })
  const edited = useRows('audit_log', { where: [...base, ['action', 'eq', 'update']], search: search_, head: true })
  const deleted = useRows('audit_log', { where: [...base, ['action', 'eq', 'delete']], search: search_, head: true })
  const anyRows = useCount('audit_log')
  const resolve = useAuditResolver(filtered)

  const actors = useMemo(() => [...(profiles.data ?? []).filter((p) => p.role !== 'patient').map((p) => p.full_name), 'System']
    .filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a.localeCompare(b)), [profiles.data])

  const groups = useMemo(() => {
    const m = new Map<string, AuditEntry[]>()
    filtered.slice(0, limit).forEach((r) => { const d = (r.created_at ?? '').slice(0, 10) ? format(parseISO(r.created_at!), 'yyyy-MM-dd') : '—'; const l = m.get(d); if (l) l.push(r); else m.set(d, [r]) })
    return [...m.entries()]
  }, [filtered, limit])

  const t = today()
  const stats = [
    { label: 'Changes today', value: todayCount.count ?? 0, icon: History, tone: 'bg-brand-50 text-brand-700' },
    { label: 'Created', value: created.data?.count ?? 0, icon: FilePlus2, tone: 'bg-emerald-50 text-emerald-600' },
    { label: 'Edited', value: edited.data?.count ?? 0, icon: PencilLine, tone: 'bg-brand-900 text-white' },
    { label: 'Deleted', value: deleted.data?.count ?? 0, icon: FileX2, tone: 'bg-rose-50 text-rose-600' },
  ]

  const [exporting, setExporting] = useState(false)
  const exportCsv = async () => {
    setExporting(true)
    try {
      const all = await queryAll('audit_log', { where, search: search_, order: [{ column: 'created_at', asc: false }] }, 20_000)
      downloadCsv(`audit-log-${t}.csv`, all.map((r) => ({
        when: r.created_at ? format(parseISO(r.created_at), 'yyyy-MM-dd HH:mm:ss') : '',
        user: r.actor_name ?? 'System', role: r.actor_role ?? '', action: r.action, record_type: AUDIT_TABLE_LABEL[r.table_name] ?? r.table_name,
        record: r.summary ?? '', record_id: r.record_id ?? '',
        changes: Object.entries(r.changes ?? {}).map(([k, v]) => `${fieldLabel(k)}: ${'from' in v ? `${resolve(k, v.from)} → ` : ''}${'to' in v ? resolve(k, v.to) : ''}`).join(' | '),
      })))
    } finally { setExporting(false) }
  }
  const rows = { length: anyRows.count ?? 0 }

  const dayLabel = (d: string) => d === t ? 'Today' : d === format(subDays(new Date(), 1), 'yyyy-MM-dd') ? 'Yesterday' : format(parseISO(d), 'EEEE, d MMMM yyyy')

  return (
    <div>
      <PageHeader title="Audit Log" description="Who changed what, and when — every patient record, appointment, prescription, bill and payment. Entries cannot be edited or deleted."
        actions={<Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!total || exporting}>{exporting ? 'Exporting…' : 'Export CSV'}</Button>} />

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
          {actors.map((name) => <option key={name} value={name}>{name}</option>)}
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
          {total > filtered.length && (
            <div className="text-center"><Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>Show more ({num(total - filtered.length)} older)</Button></div>
          )}
        </div>
      )}
    </div>
  )
}
