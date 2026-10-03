import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageSquareQuote, Star, ThumbsUp, Users } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { useByIds, useLookup, useWindow } from '../hooks/useData'
import type { Filter } from '../data/query'
import { useMe } from '../hooks/useScope'
import { Badge, Card, CardHeader, EmptyState, PageHeader, Select, Skeleton, StatCard } from '../components/ui'
import { StarRating } from '../feedback/FeedbackForm'
import { TAG_LABEL } from '../feedback/api'
import { ago, cn } from '../lib/utils'
import type { VisitFeedback } from '../types'

const avg = (rows: VisitFeedback[]) => (rows.length ? rows.reduce((s, r) => s + r.rating, 0) / rows.length : 0)
const PERIODS = [[30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months'], [0, 'All time']] as const

/** Post-visit ratings: owner / reception see everything, doctors see their own. */
export default function RatingsPage() {
  const { user } = useAuth()
  const me = useMe()
  const docs = useLookup('doctors')
  const [days, setDays] = useState<number>(90)
  const [doctor, setDoctor] = useState('')
  const [stars, setStars] = useState('')
  const isDoctor = user?.role === 'doctor'
  // only the chosen period (and, for doctors, their own reviews) is read from the database
  const sinceIso = useMemo(() => (days ? new Date(Math.floor(Date.now() / 3_600_000 - days * 24) * 3_600_000).toISOString() : ''), [days])
  const fb = useWindow('visit_feedback', { where: [
    ...(sinceIso ? [['created_at', 'gte', sinceIso] as Filter] : []),
    ...(isDoctor ? [['doctor_id', 'eq', me.doctor?.id ?? ''] as Filter] : []),
  ], order: [{ column: 'created_at', asc: false }] }, { enabled: !isDoctor || !!me.doctor })

  const inPeriod = useMemo(() => {
    const since = days ? Date.now() - days * 864e5 : 0
    return (fb.data ?? []).filter((r) => (!isDoctor || r.doctor_id === me.doctor?.id) && new Date(r.created_at ?? 0).getTime() >= since)
  }, [fb.data, days, isDoctor, me.doctor?.id])
  const rows = inPeriod.filter((r) => (!doctor || r.doctor_id === doctor) && (!stars || String(r.rating) === stars))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))

  const recommendRows = inPeriod.filter((r) => r.would_recommend !== null && r.would_recommend !== undefined)
  const recommendPct = recommendRows.length ? Math.round((recommendRows.filter((r) => r.would_recommend).length / recommendRows.length) * 100) : null
  const dist = [5, 4, 3, 2, 1].map((n) => ({ n, count: inPeriod.filter((r) => r.rating === n).length }))
  const byDoctor = useMemo(() => {
    const m = new Map<string, VisitFeedback[]>()
    for (const r of inPeriod) if (r.doctor_id) m.set(r.doctor_id, [...(m.get(r.doctor_id) ?? []), r])
    return [...m.entries()].map(([id, list]) => ({ id, name: docs.get(id)?.full_name ?? 'Doctor', list, avg: avg(list) })).sort((a, b) => b.avg - a.avg || b.list.length - a.list.length)
  }, [inPeriod, docs])
  const tagCounts = useMemo(() => {
    const good = new Map<string, number>(), bad = new Map<string, number>()
    for (const r of inPeriod) for (const tg of r.tags ?? []) { const m = r.rating >= 4 ? good : bad; m.set(tg, (m.get(tg) ?? 0) + 1) }
    const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
    return { good: top(good), bad: top(bad) }
  }, [inPeriod])
  const loading = fb.isLoading
  const pats = useByIds('patients', rows.slice(0, 100).map((r) => r.patient_id))

  return (
    <div>
      <PageHeader title={isDoctor ? 'My Ratings' : 'Patient Feedback'} description="Ratings patients leave after a completed visit — from the SMS / WhatsApp link or their portal."
        actions={<Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" className="w-44">{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>} />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Average rating" value={inPeriod.length ? `${avg(inPeriod).toFixed(1)} ★` : '—'} icon={<Star className="h-5 w-5" />} tone="amber" loading={loading} />
        <StatCard label="Reviews" value={inPeriod.length} icon={<MessageSquareQuote className="h-5 w-5" />} loading={loading} hint={`${inPeriod.filter((r) => r.comment).length} with comments`} />
        <StatCard label="Would recommend" value={recommendPct === null ? '—' : `${recommendPct}%`} icon={<ThumbsUp className="h-5 w-5" />} tone="green" loading={loading} />
        <StatCard label="Low ratings (1–2 ★)" value={inPeriod.filter((r) => r.rating <= 2).length} icon={<Users className="h-5 w-5" />} tone={inPeriod.some((r) => r.rating <= 2) ? 'red' : 'slate'} loading={loading} hint="Worth a call-back" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Rating breakdown" icon={<Star className="h-4 w-4" />} />
          <div className="space-y-2 p-5 pt-3">
            {loading ? <Skeleton className="h-28" /> : dist.map(({ n, count }) => (
              <button key={n} type="button" onClick={() => setStars(stars === String(n) ? '' : String(n))} className={cn('flex w-full items-center gap-3 rounded-lg px-1 py-0.5 text-sm hover:bg-brand-50/60', stars === String(n) && 'bg-brand-50')}>
                <span className="w-8 text-left tabular-nums text-slate-600">{n} ★</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-amber-400" style={{ width: `${inPeriod.length ? (count / inPeriod.length) * 100 : 0}%` }} /></span>
                <span className="w-8 text-right tabular-nums text-slate-500">{count}</span>
              </button>
            ))}
            {(tagCounts.good.length > 0 || tagCounts.bad.length > 0) && (
              <div className="grid gap-3 border-t border-slate-100 pt-3 text-xs sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <div><p className="mb-1 font-semibold text-emerald-700">Praised</p>{tagCounts.good.map(([k, c]) => <Badge key={k} tone="green" className="mb-1 mr-1">{TAG_LABEL[k] ?? k} · {c}</Badge>)}</div>
                <div><p className="mb-1 font-semibold text-amber-700">To improve</p>{tagCounts.bad.map(([k, c]) => <Badge key={k} tone="amber" className="mb-1 mr-1">{TAG_LABEL[k] ?? k} · {c}</Badge>)}</div>
              </div>
            )}
          </div>
        </Card>

        {!isDoctor && (
          <Card className="lg:col-span-2">
            <CardHeader title="By doctor" subtitle="Click a doctor to filter the reviews" icon={<Users className="h-4 w-4" />} />
            <div className="max-h-[320px] overflow-y-auto px-2 pb-3">
              {loading ? <Skeleton className="m-3 h-40" /> : !byDoctor.length ? <EmptyState className="py-10" title="No ratings in this period" /> : (
                <table className="w-full text-sm">
                  <tbody>
                    {byDoctor.map((d) => (
                      <tr key={d.id} onClick={() => setDoctor(doctor === d.id ? '' : d.id)} className={cn('cursor-pointer border-b border-slate-50 last:border-0 hover:bg-brand-50/50', doctor === d.id && 'bg-brand-50')}>
                        <td className="px-3 py-2 font-medium text-slate-800">{d.name}</td>
                        <td className="px-3 py-2"><StarRating value={Math.round(d.avg)} size="sm" /></td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">{d.avg.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right text-xs text-slate-500">{d.list.length} review{d.list.length === 1 ? '' : 's'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        )}

        <Card className={isDoctor ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <CardHeader title="Reviews" subtitle={doctor || stars ? <button type="button" className="text-brand-700 hover:underline" onClick={() => { setDoctor(''); setStars('') }}>Clear filters</button> : `${rows.length} in this period`} icon={<MessageSquareQuote className="h-4 w-4" />} />
          {loading ? <div className="space-y-3 p-5"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
            : !rows.length ? <EmptyState className="py-12" icon={<Star className="h-6 w-6" />} title="No reviews yet" description="Patients get a rating link by SMS / WhatsApp when their visit is marked completed." />
              : (
                <ul className="divide-y divide-slate-100">
                  {rows.slice(0, 100).map((r) => {
                    const p = pats.get(r.patient_id)
                    return (
                      <li key={r.id} className="flex flex-wrap gap-3 px-5 py-3.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <StarRating value={r.rating} size="sm" />
                            <span className="text-sm font-medium text-slate-800">{p ? <Link to={`/patients/${p.id}`} className="hover:underline">{p.full_name}</Link> : 'Patient'}</span>
                            {!isDoctor && r.doctor_id && <span className="text-xs text-slate-500">→ {docs.get(r.doctor_id)?.full_name}</span>}
                            {r.would_recommend === true && <Badge tone="green">Recommends</Badge>}
                            {r.would_recommend === false && <Badge tone="amber">Would not recommend</Badge>}
                          </div>
                          {r.comment && <p className="mt-1 text-sm text-slate-600">“{r.comment}”</p>}
                          {!!r.tags?.length && <div className="mt-1.5 flex flex-wrap gap-1">{r.tags.map((tg) => <span key={tg} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{TAG_LABEL[tg] ?? tg}</span>)}</div>}
                        </div>
                        <div className="text-right text-xs text-slate-400">{ago(r.created_at ?? '')}<div className="capitalize">{r.source === 'link' ? 'SMS link' : r.source}</div></div>
                      </li>
                    )
                  })}
                </ul>
              )}
        </Card>
      </div>
    </div>
  )
}
