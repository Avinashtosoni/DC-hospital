import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EmptyState, Skeleton } from '../../components/ui'
import { money, moneyCompact } from '../../lib/utils'
import { bc, chartColors } from './widgets'

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

