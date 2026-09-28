import { useWidgetHidden } from '../../settings/widgetScope'
import { useAppSettings } from '../../settings/AppSettingsProvider'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { format, startOfMonth, subMonths } from 'date-fns'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardHeader, EmptyState, Skeleton } from '../../components/ui'
import { money, moneyCompact } from '../../lib/utils'

// Periwinkle → deep blue first, then soft accents that stay readable next to them
/** Current theme colour (Settings → Appearance) as an rgb() string for SVG charts. */
export function bc(shade: 300 | 400 | 500 | 600 | 700 | 800 | 900) {
  const v = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(`--brand-${shade}`).trim() : ''
  return v ? `rgb(${v.split(/\s+/).join(',')})` : '#5c5c99'
}
export const chartColors = () => [bc(600), bc(400), bc(900), '#f4a261', '#7fb7be', '#e76f8a', bc(300), '#8e7dbe', '#94a3b8', bc(700)]

export function ListCard({ title, subtitle, icon, link, linkLabel = 'View all', loading, empty, emptyText = 'Nothing here yet', children, className, widgetId }: {
  title: string; subtitle?: string; icon?: ReactNode; link?: string; linkLabel?: string; loading?: boolean; empty?: boolean; emptyText?: string; children?: ReactNode; className?: string
  /** key used by Settings → Dashboard widgets (defaults to the title) */
  widgetId?: string
}) {
  if (useWidgetHidden(widgetId ?? title)) return null
  return (
    <Card className={className}>
      <CardHeader title={title} subtitle={subtitle} icon={icon}
        action={link && <Link to={link} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">{linkLabel}<ArrowRight className="h-3 w-3" /></Link>} />
      {loading ? (
        <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="flex items-center gap-3"><Skeleton className="h-8 w-8 rounded-full" /><div className="flex-1 space-y-1.5"><Skeleton className="h-3 w-1/2" /><Skeleton className="h-2.5 w-1/3" /></div></div>)}</div>
      ) : empty ? (
        <EmptyState className="py-10" title={emptyText} />
      ) : (
        <div className="divide-y divide-brand-100/70">{children}</div>
      )}
    </Card>
  )
}

export function ListRow({ left, right, to }: { left: ReactNode; right?: ReactNode; to?: string }) {
  const inner = <div className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-brand-50/50">{left}<div className="shrink-0 text-right">{right}</div></div>
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
            <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={bc(600)} stopOpacity={0.35} /><stop offset="100%" stopColor={bc(600)} stopOpacity={0} /></linearGradient>
            <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={bc(400)} stopOpacity={0.3} /><stop offset="100%" stopColor={bc(400)} stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => moneyCompact(v)} width={64} />
          <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="revenue" name="Revenue" stroke={bc(600)} strokeWidth={2.5} fill="url(#gRev)" />
          {data[0]?.expenses !== undefined && <Area type="monotone" dataKey="expenses" name="Expenses" stroke={bc(400)} strokeWidth={2} strokeDasharray="5 4" fill="url(#gExp)" />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function SimpleBar({ data, dataKey = 'value', loading, height = 260, color, formatter }: { data: { label: string; [k: string]: number | string }[]; dataKey?: string; loading?: boolean; height?: number; color?: string; formatter?: (v: number) => string }) {
  if (loading) return <Skeleton className="m-5 h-[220px]" />
  return (
    <div className="px-2 pb-4 pt-4" style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} interval={0} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} tickFormatter={formatter} width={formatter ? 64 : 32} />
          <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => (formatter ? formatter(Number(v)) : String(v))} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
          <Bar dataKey={dataKey} radius={[6, 6, 0, 0]} fill={color ?? bc(600)} maxBarSize={36} />
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
            {data.map((_, i) => { const cc = chartColors(); return <Cell key={i} fill={cc[i % cc.length]} /> })}
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
    <Link to={to} className="group flex items-center gap-3 rounded-2xl border border-brand-100 bg-white p-4 shadow-card transition duration-300 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-100 text-brand-800 transition duration-300 group-hover:rotate-[-6deg] group-hover:bg-brand-900 group-hover:text-white">{icon}</div>
      <div className="min-w-0"><div className="text-sm font-semibold text-slate-900">{label}</div><div className="truncate text-xs text-slate-500">{desc}</div></div>
    </Link>
  )
}

export function Greeting({ name, subtitle, children }: { name: string; subtitle: string; children?: ReactNode }) {
  const h = new Date().getHours()
  const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  const { settings } = useAppSettings()
  if (!settings.dashboard.showGreeting) return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="font-display text-xl font-bold tracking-tight text-brand-950 sm:text-2xl">Dashboard</h1><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  )
  return (
    <div className="relative mb-6 overflow-hidden rounded-3xl border border-white/70 bg-gradient-to-br from-brand-100 via-white to-brand-50 p-6 shadow-card sm:p-7">
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-brand-300/70 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 right-1/3 h-48 w-48 rounded-full bg-brand-400/30 blur-3xl" />
      <svg aria-hidden="true" className="pointer-events-none absolute right-6 top-1/2 hidden h-28 w-28 -translate-y-1/2 text-brand-300/60 lg:block" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.2">
        <circle cx="50" cy="50" r="46" /><circle cx="50" cy="50" r="32" strokeDasharray="3 5" /><path d="M50 30v40M30 50h40" strokeWidth="6" strokeLinecap="round" className="text-brand-400/50" />
      </svg>
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between lg:pr-36">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-200"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
          <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-brand-950 sm:text-[1.75rem]">{hello}, <span className="bg-gradient-to-r from-brand-600 to-brand-900 bg-clip-text text-transparent">{name.split(' ').filter((p) => p !== 'Dr.')[0]}</span></h1>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        </div>
        {children && <div className="flex flex-wrap gap-2">{children}</div>}
      </div>
    </div>
  )
}
