/**
 * The Health page's larger charts (recharts, loaded on demand): uptime + response-time trend across all services,
 * response time per service, messages per hospital and records per hospital.
 */
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { COLOR, useIsSmall } from './visuals'

const tick = { fontSize: 11, fill: '#64748b' }
const tip = { contentStyle: { borderRadius: 12, fontSize: 12, border: '1px solid #e2e8f0', boxShadow: '0 8px 24px -12px rgba(41,41,102,.3)' } }

export interface TrendPoint { label: string; pct: number | null; ms: number | null }

/** average uptime (area) and response time (line area) of every service, per hour / day */
export function UptimeTrend({ data }: { data: TrendPoint[] }) {
  const small = useIsSmall()
  return (
    <div className="h-48 w-full sm:h-56 2xl:h-64" role="img" aria-label="Uptime and response time trend, all services">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="hc-up" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={COLOR.ok} stopOpacity={0.35} /><stop offset="100%" stopColor={COLOR.ok} stopOpacity={0.02} /></linearGradient>
            <linearGradient id="hc-ms" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={COLOR.brand} stopOpacity={0.3} /><stop offset="100%" stopColor={COLOR.brand} stopOpacity={0.02} /></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={tick} interval="preserveStartEnd" minTickGap={16} />
          <YAxis yAxisId="pct" domain={[(min: number) => Math.max(0, Math.floor(Math.min(min, 90) / 10) * 10), 100]} tick={tick} unit="%" width={small ? 38 : 44} />
          <YAxis yAxisId="ms" orientation="right" tick={tick} unit={small ? '' : ' ms'} width={small ? 36 : 58} />
          <Tooltip {...tip} formatter={(v, name) => (v == null ? ['no checks', name] : name === 'Uptime' ? [`${v}%`, name] : [`${v} ms`, name])} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area yAxisId="pct" type="monotone" dataKey="pct" name="Uptime" stroke={COLOR.ok} strokeWidth={2} fill="url(#hc-up)" connectNulls />
          <Area yAxisId="ms" type="monotone" dataKey="ms" name="Avg response" stroke={COLOR.brand} strokeWidth={2} fill="url(#hc-ms)" connectNulls />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** latest response time per service, slowest first; amber over 1.5 s, red over 3 s */
export function LatencyBars({ data }: { data: { label: string; ms: number }[] }) {
  const small = useIsSmall()
  const h = Math.max(160, data.length * (small ? 24 : 26) + 30)
  return (
    <div className="w-full" style={{ height: h }} role="img" aria-label="Response time per service">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: small ? 8 : 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
          <XAxis type="number" tick={tick} unit={small ? '' : ' ms'} />
          <YAxis type="category" dataKey="label" tick={small ? { ...tick, fontSize: 10 } : tick} width={small ? 96 : 130}
            tickFormatter={(v: string) => (small && v.length > 13 ? `${v.slice(0, 12)}…` : v)} />
          <Tooltip {...tip} formatter={(v) => [`${v} ms`, 'Response time']} cursor={{ fill: '#f1f1fb' }} />
          <Bar dataKey="ms" radius={[0, 6, 6, 0]} maxBarSize={16}>
            {data.map((d) => <Cell key={d.label} fill={d.ms >= 3000 ? COLOR.fail : d.ms >= 1500 ? COLOR.warn : COLOR.brand} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** messages per hospital in the last 24 hours: sent / failed / waiting, stacked */
export function MessagesBars({ data }: { data: { name: string; sent: number; failed: number; waiting: number }[] }) {
  return (
    <div className="h-56 w-full" role="img" aria-label="Messages per hospital, last 24 hours">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="name" tick={tick} interval={0} tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)} />
          <YAxis tick={tick} allowDecimals={false} width={36} />
          <Tooltip {...tip} cursor={{ fill: '#f1f1fb' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="sent" name="Sent" stackId="m" fill={COLOR.ok} maxBarSize={40} />
          <Bar dataKey="waiting" name="Waiting" stackId="m" fill={COLOR.soft} maxBarSize={40} />
          <Bar dataKey="failed" name="Failed" stackId="m" fill={COLOR.fail} radius={[6, 6, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** records per hospital (patients, appointments, invoices) */
export function HospitalBars({ data }: { data: { name: string; patients: number; appointments: number; invoices: number }[] }) {
  return (
    <div className="h-60 w-full" role="img" aria-label="Records per hospital">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="name" tick={tick} interval={0} tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)} />
          <YAxis tick={tick} allowDecimals={false} width={44} />
          <Tooltip {...tip} cursor={{ fill: '#f1f1fb' }} formatter={(v) => Number(v).toLocaleString('en-IN')} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="patients" name="Patients" fill={COLOR.deep} radius={[5, 5, 0, 0]} maxBarSize={28} />
          <Bar dataKey="appointments" name="Appointments" fill={COLOR.brand} radius={[5, 5, 0, 0]} maxBarSize={28} />
          <Bar dataKey="invoices" name="Invoices" fill={COLOR.soft} radius={[5, 5, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

