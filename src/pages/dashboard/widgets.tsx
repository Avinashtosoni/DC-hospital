import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { format, startOfMonth, subMonths } from 'date-fns'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardHeader, EmptyState, Skeleton } from '../../components/ui'
import { money, moneyCompact } from '../../lib/utils'

export const CHART_COLORS = ['#1fadaa', '#6366f1', '#f59e0b', '#ec4899', '#0ea5e9', '#10b981', '#8b5cf6', '#ef4444', '#64748b', '#14b8a6']

export function ListCard({ title, subtitle, icon, link, linkLabel = 'View all', loading, empty, emptyText = 'Nothing here yet', children, className }: {
  title: string; subtitle?: string; icon?: ReactNode; link?: string; linkLabel?: string; loading?: boolean; empty?: boolean; emptyText?: string; children?: ReactNode; className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader title={title} subtitle={subtitle} icon={icon}
        action={link && <Link to={link} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">{linkLabel}<ArrowRight className="h-3 w-3" /></Link>} />
      {loading ? (
        <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="flex items-center gap-3"><Skeleton className="h-8 w-8 rounded-full" /><div className="flex-1 space-y-1.5"><Skeleton className="h-3 w-1/2" /><Skeleton className="h-2.5 w-1/3" /></div></div>)}</div>
      ) : empty ? (
        <EmptyState className="py-10" title={emptyText} />
      ) : (
        <div className="divide-y divide-slate-100">{children}</div>
      )}
    </Card>
  )
}

export function ListRow({ left, right, to }: { left: ReactNode; right?: ReactNode; to?: string }) {
  const inner = <div className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-slate-50/70">{left}<div className="shrink-0 text-right">{right}</div></div>
  return to ? <Link to={to} className="block">{inner}</Link> : inner
}

/** last N months buckets: [{key:'2026-04', label:'Apr'}] */
export function monthBuckets(n = 6) {
  return Array.from({ length: n }, (_, i) => {
    const d = startOfMonth(subMonths(new Date(), n - 1 - i))
    return { key: format(d, 'yyyy-MM'), label: format(d, 'MMM') }
  })
}

export function RevenueChart({ data, loading, height = 280 }: { data: { label: string; revenue: number; expenses?: number }[]; loading?: boolean; height?: number }) {
  if (loading) return <Skeleton className="m-5 h-[240px]" />
  return (
    <div className="px-2 pb-4 pt-4" style={{ height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: 8, right: 16, top: 8 }}>
          <defs>
            <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1fadaa" stopOpacity={0.35} /><stop offset="100%" stopColor="#1fadaa" stopOpacity={0} /></linearGradient>
            <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} /><stop offset="100%" stopColor="#6366f1" stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => moneyCompact(v)} width={64} />
          <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#1fadaa" strokeWidth={2.5} fill="url(#gRev)" />
          {data[0]?.expenses !== undefined && <Area type="monotone" dataKey="expenses" name="Expenses" stroke="#6366f1" strokeWidth={2} fill="url(#gExp)" />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function SimpleBar({ data, dataKey = 'value', loading, height = 260, color = '#1fadaa', formatter }: { data: { label: string; [k: string]: number | string }[]; dataKey?: string; loading?: boolean; height?: number; color?: string; formatter?: (v: number) => string }) {
  if (loading) return <Skeleton className="m-5 h-[220px]" />
  return (
    <div className="px-2 pb-4 pt-4" style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} interval={0} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} tickFormatter={formatter} width={formatter ? 64 : 32} />
          <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => (formatter ? formatter(Number(v)) : String(v))} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
          <Bar dataKey={dataKey} radius={[6, 6, 0, 0]} fill={color} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function Donut({ data, loading, height = 260, formatter }: { data: { name: string; value: number }[]; loading?: boolean; height?: number; formatter?: (v: number) => string }) {
  if (loading) return <Skeleton className="m-5 h-[220px] rounded-full" />
  if (!data.some((d) => d.value > 0)) return <EmptyState className="py-12" title="No data yet" />
  return (
    <div className="px-2 pb-4 pt-2" style={{ height }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2} stroke="none">
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(v) => (formatter ? formatter(Number(v)) : String(v))} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
          <Legend iconType="circle" layout="horizontal" verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

export function QuickAction({ to, icon, label, desc }: { to: string; icon: ReactNode; label: string; desc: string }) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white">{icon}</div>
      <div className="min-w-0"><div className="text-sm font-semibold text-slate-900">{label}</div><div className="truncate text-xs text-slate-500">{desc}</div></div>
    </Link>
  )
}

export function Greeting({ name, subtitle, children }: { name: string; subtitle: string; children?: ReactNode }) {
  const h = new Date().getHours()
  const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-medium text-brand-700">{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{hello}, {name.split(' ').filter((p) => p !== 'Dr.')[0]}</h1>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  )
}
