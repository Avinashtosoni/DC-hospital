import { Link } from 'react-router-dom'
import { ArrowRight, MessagesSquare } from 'lucide-react'
import { Card, CardHeader, Skeleton } from '../ui'
import { CHANNEL_META } from '../../pages/settings/messaging/channelMeta'
import { usageIsSample } from '../../settings/messaging'
import { CHANNELS } from '../../settings/types'
import { money } from '../../lib/utils'
import { useUsage } from './useUsage'

const BAR: Record<string, string> = { sms: 'bg-brand-400', whatsapp: 'bg-emerald-500', email: 'bg-sky-500', push: 'bg-amber-400' }

/** Dashboard widget: this month's messages per channel (owner / accountant). */
export function UsageMini({ className }: { className?: string }) {
  const u = useUsage('month')
  const max = Math.max(1, ...CHANNELS.map((c) => u.summary.byChannel[c]))
  return (
    <Card className={className}>
      <CardHeader title="Messages this month" subtitle={usageIsSample ? 'Sample data — demo mode' : 'SMS, WhatsApp, e-mail and push'} icon={<MessagesSquare className="h-4 w-4" />}
        action={<Link to="/reports?tab=messaging" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">Report<ArrowRight className="h-3 w-3" /></Link>} />
      <div className="space-y-3 p-5">
        {u.isPending ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7" />) : <>
          {CHANNELS.map((c) => (
            <div key={c}>
              <div className="flex items-center justify-between text-sm"><span className="inline-flex items-center gap-2 text-slate-600">{CHANNEL_META[c].icon}{CHANNEL_META[c].label}</span><b className="tabular-nums text-slate-900">{u.summary.byChannel[c].toLocaleString('en-IN')}</b></div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className={`h-1.5 rounded-full ${BAR[c]}`} style={{ width: `${(u.summary.byChannel[c] / max) * 100}%` }} /></div>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span>{u.summary.total.toLocaleString('en-IN')} total · {u.summary.failed.toLocaleString('en-IN')} failed</span>
            <span>≈ <b className="text-slate-800">{money(u.summary.cost)}</b></span>
          </div>
        </>}
      </div>
    </Card>
  )
}
