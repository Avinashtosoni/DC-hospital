import { useMemo, useState } from 'react'
import { eachDayOfInterval, format, parseISO } from 'date-fns'
import { AlertTriangle, CheckCircle2, Download, IndianRupee, MessagesSquare } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, Card, CardHeader, Select, Skeleton, StatCard } from '../ui'
import { CHANNEL_META } from '../../pages/settings/messaging/channelMeta'
import { CHANNELS, EVENTS, type Channel } from '../../settings/types'
import { downloadCsv, money } from '../../lib/utils'
import { RANGE_LABEL, useUsage, type UsageRange } from './useUsage'

const COLOR: Record<Channel, string> = { sms: '#7c7cc4', whatsapp: '#10b981', email: '#0ea5e9', push: '#f59e0b' }
const eventLabel = (e: string) => (e === 'custom' ? 'Custom messages' : e === 'test' ? 'Test messages' : EVENTS.find((x) => x.id === e)?.label ?? e)

/** Messaging usage for the owner and the accountant: counts, estimated cost, daily trend and per-event table. */
export function UsageReport() {
  const [range, setRange] = useState<UsageRange>('30d')
  const u = useUsage(range)
  const loading = u.isPending

  const daily = useMemo(() => {
    const byDay = new Map<string, Record<Channel, number>>()
    for (const r of u.rows) {
      const d = byDay.get(r.day) ?? { sms: 0, whatsapp: 0, email: 0, push: 0 }
      d[r.channel] += r.n; byDay.set(r.day, d)
    }
    const days = eachDayOfInterval({ start: parseISO(u.from), end: parseISO(u.to) })
    // long ranges are summed per month so the chart stays readable
    if (days.length > 120) {
      const m = new Map<string, Record<Channel, number> & { label: string }>()
      for (const day of days) {
        const k = format(day, 'yyyy-MM'), src = byDay.get(format(day, 'yyyy-MM-dd'))
        const cur = m.get(k) ?? { label: format(day, 'MMM yy'), sms: 0, whatsapp: 0, email: 0, push: 0 }
        if (src) for (const c of CHANNELS) cur[c] += src[c]
        m.set(k, cur)
      }
      return [...m.values()]
    }
    return days.map((day) => ({ label: format(day, days.length > 31 ? 'd MMM' : 'd MMM'), ...(byDay.get(format(day, 'yyyy-MM-dd')) ?? { sms: 0, whatsapp: 0, email: 0, push: 0 }) }))
  }, [u.rows, u.from, u.to])

  const byEvent = useMemo(() => {
    const m = new Map<string, Record<Channel, number> & { failed: number; total: number }>()
    for (const r of u.rows) {
      const e = m.get(r.event) ?? { sms: 0, whatsapp: 0, email: 0, push: 0, failed: 0, total: 0 }
      e[r.channel] += r.n; e.total += r.n; if (r.status === 'failed') e.failed += r.n
      m.set(r.event, e)
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [u.rows])

  const rates = u.rates ?? { sms: 0, whatsapp: 0, email: 0, push: 0 }
  const delivered = (c: Channel) => u.rows.filter((r) => r.channel === c && r.status === 'sent').reduce((s, r) => s + r.n, 0)
  const exportCsv = () => downloadCsv(`messaging-usage-${u.from}-to-${u.to}.csv`, byEvent.map(([e, v]) => ({ event: eventLabel(e), sms: v.sms, whatsapp: v.whatsapp, email: v.email, push: v.push, failed: v.failed, total: v.total })))
  const rate = u.summary.total ? Math.round((u.summary.delivered / u.summary.total) * 1000) / 10 : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">Messaging usage</h2>
          <p className="text-sm text-slate-500">How many SMS, WhatsApp, e-mail and push (FCM) messages the hospital sent, and what they cost at your rates (Settings → Notifications).</p>
        </div>
        <Select value={range} onChange={(e) => setRange(e.target.value as UsageRange)} className="w-44" aria-label="Period">
          {(Object.keys(RANGE_LABEL) as UsageRange[]).map((r) => <option key={r} value={r}>{RANGE_LABEL[r]}</option>)}
        </Select>
        <Button variant="outline" icon={<Download className="h-4 w-4" />} disabled={!byEvent.length} onClick={exportCsv}>Export</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Messages" value={u.summary.total.toLocaleString('en-IN')} icon={<MessagesSquare className="h-5 w-5" />} tone="violet" loading={loading} hint={RANGE_LABEL[range]} />
        <StatCard label="Delivered" value={u.summary.delivered.toLocaleString('en-IN')} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" loading={loading} hint={`${rate}% success`} />
        <StatCard label="Failed" value={u.summary.failed.toLocaleString('en-IN')} icon={<AlertTriangle className="h-5 w-5" />} tone={u.summary.failed ? 'red' : 'slate'} loading={loading} hint={u.summary.pending ? `${u.summary.pending} still queued` : 'not billed'} />
        <StatCard label="Estimated cost" value={money(u.summary.cost)} icon={<IndianRupee className="h-5 w-5" />} tone="amber" loading={loading} hint="delivered × your per-message rate" />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {CHANNELS.map((c) => (
          <Card key={c} className="p-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><span className="grid h-7 w-7 place-items-center rounded-lg text-white" style={{ background: COLOR[c] }}>{CHANNEL_META[c].icon}</span>{CHANNEL_META[c].label}</p>
            {loading ? <Skeleton className="mt-3 h-8" /> : <>
              <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{u.summary.byChannel[c].toLocaleString('en-IN')}</p>
              <p className="text-xs text-slate-500">{delivered(c).toLocaleString('en-IN')} delivered · {rates[c] ? `${money(delivered(c) * rates[c])} @ ₹${rates[c]}` : 'free'}</p>
            </>}
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Messages over time" subtitle="Stacked by channel" icon={<MessagesSquare className="h-4 w-4" />} />
        {loading ? <Skeleton className="m-5 h-72" /> : (
          <div className="h-80 px-2 py-4">
            <ResponsiveContainer>
              <BarChart data={daily} margin={{ left: 0, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={16} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} width={40} allowDecimals={false} />
                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} formatter={(v) => Number(v).toLocaleString('en-IN')} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                {CHANNELS.map((c, i) => <Bar key={c} dataKey={c} name={CHANNEL_META[c].label} stackId="a" fill={COLOR[c]} radius={i === CHANNELS.length - 1 ? [4, 4, 0, 0] : undefined} maxBarSize={28} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="By message type" subtitle="Which events use the most messages" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr>
              <th className="px-5 py-2.5 text-left">Message</th>{CHANNELS.map((c) => <th key={c} className="px-4 py-2.5 text-right">{CHANNEL_META[c].label}</th>)}<th className="px-4 py-2.5 text-right">Failed</th><th className="px-5 py-2.5 text-right">Total</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={7} className="p-5"><Skeleton className="h-24" /></td></tr>}
              {!loading && !byEvent.length && <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-400">No messages in this period.</td></tr>}
              {byEvent.map(([e, v]) => (
                <tr key={e} className="tabular-nums">
                  <td className="px-5 py-3 font-medium text-slate-800">{eventLabel(e)}</td>
                  {CHANNELS.map((c) => <td key={c} className="px-4 py-3 text-right text-slate-600">{v[c] ? v[c].toLocaleString('en-IN') : <span className="text-slate-300">—</span>}</td>)}
                  <td className={`px-4 py-3 text-right ${v.failed ? 'text-rose-600' : 'text-slate-300'}`}>{v.failed || '—'}</td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-900">{v.total.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
