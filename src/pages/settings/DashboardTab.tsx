import { useState } from 'react'
import { Check, LayoutDashboard, RotateCcw, Sparkles } from 'lucide-react'
import { Button } from '../../components/ui'
import { cn } from '../../lib/utils'
import { DASHBOARD_WIDGETS } from '../../settings/types'
import { ROLE_LABEL, type Role } from '../../types'
import { Section, Segmented, Toggle, type TabCtx } from './shared'

const ROLES = Object.keys(DASHBOARD_WIDGETS) as Role[]
/** The first four widgets of every role are the stat cards (see DASHBOARD_WIDGETS). */
const isStat = (i: number) => i < 4

export function DashboardTab({ ctx }: { ctx: TabCtx }) {
  const { app, editApp } = ctx
  const [role, setRole] = useState<Role>('owner')
  const hidden = new Set(app.dashboard.hidden)
  const widgets = DASHBOARD_WIDGETS[role] ?? []
  const shown = widgets.filter((w) => !hidden.has(`${role}:${w}`)).length
  const setAll = (visible: boolean) => editApp((d) => {
    const keys = widgets.map((w) => `${role}:${w}`)
    const rest = d.dashboard.hidden.filter((k) => !keys.includes(k))
    d.dashboard.hidden = visible ? rest : [...rest, ...keys]
  })
  return (
    <div className="space-y-6">
      <Section title="Dashboard widgets" description="Choose which cards and charts each role sees on their home dashboard." icon={<LayoutDashboard className="h-4 w-4" />}>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented size="sm" value={role} onChange={setRole} options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">{shown} of {widgets.length} visible</span>
              <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setAll(true)}>Show all</Button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {widgets.map((w, i) => {
              const key = `${role}:${w}`
              const on = !hidden.has(key)
              const stat = isStat(i)
              return (
                <button key={key} type="button" role="switch" aria-checked={on}
                  onClick={() => editApp((d) => { d.dashboard.hidden = on ? [...d.dashboard.hidden, key] : d.dashboard.hidden.filter((k) => k !== key) })}
                  className={cn('group flex items-start gap-3 rounded-xl border p-3 text-left transition', stat ? '' : 'lg:col-span-2',
                    on ? 'border-brand-200 bg-white shadow-sm hover:border-brand-300' : 'border-dashed border-slate-300 bg-slate-50 text-slate-400 hover:bg-white')}>
                  <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white')}>{on && <Check className="h-3.5 w-3.5" />}</span>
                  <span className="min-w-0">
                    <span className={cn('block text-sm font-medium', on ? 'text-slate-800' : 'line-through')}>{w.replace(/ list$/, ' (list)')}</span>
                    <span className="text-[11px] text-slate-400">{stat ? 'Stat card' : 'Chart / list panel'}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <p className="text-xs text-slate-400">Hiding a widget only changes the dashboard. The underlying module and its data remain available.</p>
        </div>
      </Section>
      <Section title="Welcome header" icon={<Sparkles className="h-4 w-4" />}>
        <Toggle label="Show the greeting and date at the top of the dashboard" hint="“Good morning, Avinash” with today's date" checked={app.dashboard.showGreeting} onChange={(v) => editApp((d) => { d.dashboard.showGreeting = v })} />
      </Section>
    </div>
  )
}
