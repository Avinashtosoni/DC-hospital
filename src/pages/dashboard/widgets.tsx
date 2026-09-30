import { useWidgetHidden } from '../../settings/widgetScope'
import { useAppSettings } from '../../settings/AppSettingsProvider'
import { lazy, Suspense, type ComponentProps, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { format, startOfMonth, subMonths } from 'date-fns'
import { Card, CardHeader, EmptyState, Skeleton } from '../../components/ui'

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

// Charts live in ./charts (recharts ≈ 400 KB) and load on demand, so the dashboard shell, KPIs and lists
// render first and roles without charts (patients) never download the library.
const loadCharts = () => import('./charts')
const LazyRevenue = lazy(() => loadCharts().then((m) => ({ default: m.RevenueChart })))
const LazyBar = lazy(() => loadCharts().then((m) => ({ default: m.SimpleBar })))
const LazyDonut = lazy(() => loadCharts().then((m) => ({ default: m.Donut })))
const chartFallback = (h: number, round = false) => <div className="p-5" style={{ height: h }}><Skeleton className={round ? 'h-full rounded-full' : 'h-full'} /></div>

export function RevenueChart(p: ComponentProps<typeof LazyRevenue>) {
  return <Suspense fallback={chartFallback(p.height ?? 280)}><LazyRevenue {...p} /></Suspense>
}
export function SimpleBar(p: ComponentProps<typeof LazyBar>) {
  return <Suspense fallback={chartFallback(p.height ?? 260)}><LazyBar {...p} /></Suspense>
}
export function Donut(p: ComponentProps<typeof LazyDonut>) {
  return <Suspense fallback={chartFallback(p.height ?? 260, true)}><LazyDonut {...p} /></Suspense>
}

export function QuickAction({ to, icon, label, desc }: { to: string; icon: ReactNode; label: string; desc: string }) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-2xl border border-brand-100 bg-white p-4 shadow-card transition duration-300 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-100 text-brand-800 transition duration-300 group-hover:rotate-[-6deg] group-hover:bg-brand-900 group-hover:text-white">{icon}</div>
      <div className="min-w-0"><div className="text-sm font-semibold text-slate-900">{label}</div><div className="truncate text-xs text-slate-500">{desc}</div></div>
    </Link>
  )
}

export function Greeting({ name, subtitle, children, t = (x: string) => x }: { name: string; subtitle: string; children?: ReactNode; /** translator (patient portal) */ t?: (s: string) => string }) {
  const h = new Date().getHours()
  const hello = t(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening')
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
