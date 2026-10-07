import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3 } from 'lucide-react'
import { Input, Skeleton } from '../../../components/ui'
import { useUsage } from '../../../components/usage/useUsage'
import { CHANNELS } from '../../../settings/types'
import { money } from '../../../lib/utils'
import { CHANNEL_META } from './channelMeta'
import { Section, type TabCtx } from '../shared'

/** Settings → Notifications: this month's usage per channel and the ₹ rates used for cost estimates. */
export function UsageCard({ ctx }: { ctx: TabCtx }) {
  const u = useUsage('month')
  const rates = ctx.app.notifications.rates
  return (
    <Section title={<span className="flex items-center gap-2">Usage this month</span>} icon={<BarChart3 className="h-4 w-4" />}
      description="Messages queued since the 1st, and your price per delivered message (used for the cost estimate — check your provider's plan)."
      action={<Link to="/reports?tab=messaging" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">Full report<ArrowRight className="h-3.5 w-3.5" /></Link>}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {CHANNELS.map((c) => (
          <div key={c} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{CHANNEL_META[c].icon}{CHANNEL_META[c].label}</p>
            {u.isPending ? <Skeleton className="mt-2 h-7" /> : <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{u.summary.byChannel[c].toLocaleString('en-IN')}</p>}
            <label className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">₹
              <Input type="number" min={0} step={0.01} value={rates?.[c] ?? 0} aria-label={`${CHANNEL_META[c].label} price per message`}
                onChange={(e) => ctx.editApp((d) => { d.notifications.rates = { ...d.notifications.rates, [c]: Math.max(0, Number(e.target.value) || 0) } })} className="h-7 w-20 px-2 text-xs" />
              / msg</label>
          </div>
        ))}
        <div className="col-span-2 rounded-xl bg-brand-900 p-3 text-white lg:col-span-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-200">Estimated cost</p>
          {u.isPending ? <Skeleton className="mt-2 h-7 bg-white/20" /> : <p className="mt-1 text-2xl font-bold tabular-nums">{money(u.summary.cost)}</p>}
          <p className="mt-2 text-xs text-brand-200">{u.summary.total.toLocaleString('en-IN')} messages · {u.summary.failed.toLocaleString('en-IN')} failed</p>
        </div>
      </div>
    </Section>
  )
}
