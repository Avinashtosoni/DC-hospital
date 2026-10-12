import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { COLOR, useIsSmall } from '../health/visuals'

const tick = { fontSize: 11, fill: '#64748b' }
const tooltip = {
  contentStyle: { borderRadius: 12, fontSize: 12, border: '1px solid #e2e8f0', boxShadow: '0 8px 24px -12px rgba(41,41,102,.3)' },
}
const PLAN_COLORS = [COLOR.deep, COLOR.brand, '#8181b7', '#a3a3cc', '#c4c4df', '#64748b']
const CHANNEL_COLORS: Record<string, string> = { WhatsApp: '#10b981', SMS: '#f59e0b', 'E-mail': '#6366f1' }

export interface PlanMixPoint { plan: string; hospitals: number }
export interface ChannelPoint { channel: string; messages: number }
export interface RevenuePoint { period: string; rupees: number }

export function PlanMixChart({ data }: { data: PlanMixPoint[] }) {
  const small = useIsSmall()
  const height = Math.max(176, data.length * 36 + 44)
  return (
    <div className="w-full" style={{ height }} role="img" aria-label="Hospitals by plan">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 18, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
          <XAxis type="number" tick={tick} allowDecimals={false} />
          <YAxis type="category" dataKey="plan" width={small ? 92 : 126} tick={small ? { ...tick, fontSize: 10 } : tick}
            tickFormatter={(value: string) => (small && value.length > 13 ? `${value.slice(0, 12)}…` : value)} />
          <Tooltip {...tooltip} formatter={(value) => [`${Number(value).toLocaleString('en-IN')} hospitals`, 'Customers']} cursor={{ fill: '#f1f1fb' }} />
          <Bar dataKey="hospitals" name="Hospitals" radius={[0, 6, 6, 0]} maxBarSize={22}>
            {data.map((point, index) => <Cell key={point.plan} fill={PLAN_COLORS[index % PLAN_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ChannelMixChart({ data }: { data: ChannelPoint[] }) {
  const small = useIsSmall()
  return (
    <div className="h-52 w-full" role="img" aria-label="Messages sent by channel this month">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="channel" tick={small ? { ...tick, fontSize: 10 } : tick} interval={0} />
          <YAxis tick={tick} allowDecimals={false} width={38} />
          <Tooltip {...tooltip} formatter={(value) => [Number(value).toLocaleString('en-IN'), 'Messages']} cursor={{ fill: '#f1f1fb' }} />
          <Bar dataKey="messages" name="Messages" radius={[6, 6, 0, 0]} maxBarSize={42}>
            {data.map((point) => <Cell key={point.channel} fill={CHANNEL_COLORS[point.channel] ?? COLOR.brand} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

const compactRupees = (value: number) => {
  if (value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(1)}Cr`
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(1)}L`
  if (value >= 1_000) return `₹${(value / 1_000).toFixed(0)}k`
  return `₹${Math.round(value)}`
}

export function RevenueSnapshotChart({ data }: { data: RevenuePoint[] }) {
  return (
    <div className="h-52 w-full" role="img" aria-label="Monthly recurring revenue compared with payments received in the last 30 days">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="period" tick={tick} interval={0} />
          <YAxis tick={tick} width={55} tickFormatter={compactRupees} />
          <Tooltip {...tooltip} formatter={(value) => [`₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, 'Amount']} cursor={{ fill: '#f1f1fb' }} />
          <Bar dataKey="rupees" name="Rupees" radius={[6, 6, 0, 0]} maxBarSize={52}>
            {data.map((point) => <Cell key={point.period} fill={point.period === 'MRR' ? COLOR.brand : COLOR.ok} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
