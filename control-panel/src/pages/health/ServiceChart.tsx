/** One service's history: uptime % bars + average response time line, per hour (24 h) or per day (7 days). */
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface ChartCell { label: string; pct: number | null; ms: number | null }

export default function ServiceChart({ cells, latency }: { cells: ChartCell[]; latency: boolean }) {
  return (
    <div className="h-56 w-full" role="img" aria-label="Uptime and response time history">
      <ResponsiveContainer>
        <ComposedChart data={cells} margin={{ top: 8, right: latency ? 4 : 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} interval="preserveStartEnd" minTickGap={12} />
          <YAxis yAxisId="pct" domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} unit="%" width={48} />
          {latency && <YAxis yAxisId="ms" orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} unit=" ms" width={60} />}
          <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }}
            formatter={(v, name) => (v == null ? ['no checks', name] : name === 'Uptime' ? [`${v}%`, name] : [`${v} ms`, name])} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="pct" dataKey="pct" name="Uptime" fill="#A3A3CC" radius={[3, 3, 0, 0]} maxBarSize={28} />
          {latency && <Line yAxisId="ms" dataKey="ms" name="Response time" stroke="#292966" strokeWidth={2} dot={false} connectNulls type="monotone" />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
