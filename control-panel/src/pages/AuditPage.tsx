import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Search } from 'lucide-react'
import { Badge, Card, EmptyState, Input, PageHeader, Skeleton } from '../../../src/components/ui'
import { cp } from '../api'
import { dateTime, ErrorBox } from '../ui'

export function AuditPage() {
  return (
    <>
      <PageHeader title="Audit log" description="Everything your team does — in this panel and inside hospitals (opening, switching mode, billing, settings)." />
      <AuditList />
    </>
  )
}

const short = (d: Record<string, unknown> | null) => {
  if (!d) return ''
  const s = JSON.stringify(d)
  return s.length > 140 ? `${s.slice(0, 140)}…` : s
}

export function AuditList({ tenantId }: { tenantId?: string }) {
  const [search, setSearch] = useState('')
  const q = useQuery({ queryKey: ['cp-audit', tenantId ?? 'all'], queryFn: () => cp.audit(tenantId) })
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (q.data ?? []).filter((a) => !s || [a.action, a.target, a.user_name, a.hospital].some((v) => v?.toLowerCase().includes(s)))
  }, [q.data, search])
  return (
    <>
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search action, person or hospital" className="pl-9" aria-label="Search audit log" />
      </div>
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      <Card className="overflow-hidden">
        {q.isLoading ? <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          : !rows.length ? <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="Nothing logged yet" description="Actions by the platform team show up here." />
          : (
            <ul className="divide-y divide-slate-100">
              {rows.map((a) => (
                <li key={a.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <span className="w-36 shrink-0 text-xs text-slate-500">{dateTime(a.at)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800">
                      <span className="font-medium">{a.user_name ?? 'Someone'}</span>{a.mode && <Badge tone="slate" className="ml-1.5">{a.mode}</Badge>}
                      <span className="mx-1.5 font-mono text-xs text-brand-800">{a.action}</span>
                      {a.target && <span className="text-slate-600">{a.target}</span>}
                    </p>
                    {a.detail && <p className="truncate font-mono text-[11px] text-slate-400">{short(a.detail)}</p>}
                  </div>
                  {!tenantId && a.hospital && a.tenant_id && <Link to={`/hospitals/${a.tenant_id}`} className="shrink-0 text-xs font-medium text-brand-700 hover:underline">{a.hospital}</Link>}
                </li>
              ))}
            </ul>
          )}
      </Card>
    </>
  )
}
