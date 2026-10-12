import type { CSSProperties } from 'react'
import { Check, Eye, EyeOff, LayoutGrid, Lock, Megaphone, Palette, PanelLeft } from 'lucide-react'
import { Field, Input, Select, Textarea } from '../../components/ui'
import { NAV } from '../../components/layout/nav'
import { TONE } from '../../components/layout/AppLayout'
import { cn } from '../../lib/utils'
import { THEME_LABEL, THEME_PALETTES, type ThemeId } from '../../settings/palettes'
import { paletteFor, paletteFromHex, rgbToHex, type AppSettings } from '../../settings/types'
import { Section, Segmented, Toggle, type TabCtx } from './shared'

/** Paths that can never be hidden (dashboard, settings, own profile). */
export const LOCKED_MODULES = ['/', '/settings', '/profile']

const PRESETS = Object.keys(THEME_PALETTES) as Exclude<ThemeId, 'custom'>[]

function Swatches({ pal }: { pal: Record<string, string> }) {
  return (
    <span className="flex overflow-hidden rounded-md ring-1 ring-black/5">
      {['200', '400', '600', '800', '950'].map((k) => <span key={k} className="h-6 flex-1" style={{ background: `rgb(${pal[k]})` }} />)}
    </span>
  )
}

/** A miniature dashboard rendered with the draft palette (CSS vars scoped to this box). */
function MiniDashboard({ a }: { a: AppSettings['appearance'] }) {
  const pal = paletteFor(a)
  const vars = Object.fromEntries(Object.entries(pal).map(([k, v]) => [`--brand-${k}`, v])) as CSSProperties
  const light = a.sidebar === 'light'
  const r = a.radius === 'sharp' ? 'rounded-sm' : a.radius === 'round' ? 'rounded-2xl' : 'rounded-lg'
  return (
    <div style={vars} className={cn('flex h-48 overflow-hidden border border-slate-200 bg-slate-50 shadow-sm', r)} aria-label="Theme preview">
      <div className={cn('flex w-20 shrink-0 flex-col gap-1.5 p-2', light ? 'border-r border-brand-100 bg-white' : a.sidebar === 'brand' ? 'bg-gradient-to-b from-brand-600 to-brand-800' : 'bg-gradient-to-b from-brand-900 to-brand-950')}>
        <span className={cn('mb-1 h-4 w-12 rounded', light ? 'bg-brand-100' : 'bg-white/25')} />
        {[0, 1, 2, 3, 4].map((i) => <span key={i} className={cn('h-2.5 rounded', i === 1 ? (light ? 'bg-brand-100' : 'bg-white/30') : (light ? 'bg-slate-100' : 'bg-white/10'))} />)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between"><span className="h-3 w-24 rounded bg-brand-950/80" /><span className={cn('bg-brand-900 px-2 py-1 text-[9px] font-semibold text-white', r)}>+ New</span></div>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className={cn('bg-white p-2 shadow-sm ring-1 ring-slate-100', r)}>
              <span className={cn('mb-1 block h-3 w-3', r, i === 0 ? 'bg-brand-600' : i === 1 ? 'bg-brand-400' : 'bg-brand-200')} />
              <span className="block h-2 w-8 rounded bg-slate-200" /><span className="mt-1 block h-2.5 w-10 rounded bg-brand-900/80" />
            </div>
          ))}
        </div>
        <div className={cn('flex flex-1 items-end gap-1.5 bg-white p-2 shadow-sm ring-1 ring-slate-100', r)}>
          {[40, 65, 50, 80, 60, 90, 70, 55, 85].map((h, i) => <span key={i} className={cn('flex-1 rounded-t', i % 2 ? 'bg-brand-300' : 'bg-brand-600')} style={{ height: `${h}%` }} />)}
        </div>
      </div>
    </div>
  )
}

export function AppearanceTab({ ctx }: { ctx: TabCtx }) {
  const { app, editApp } = ctx
  const a = app.appearance
  const hidden = new Set(app.modules.hidden)
  const ann = app.announcement
  const validHex = /^#[0-9a-f]{6}$/i.test(a.customColor)
  return (
    <div className="space-y-6">
      <Section title="Theme colour" description="Changes preview live across the dashboard. Save to apply them for every user." icon={<Palette className="h-4 w-4" />}>
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div>
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PRESETS.map((id) => (
                <button key={id} type="button" role="radio" aria-checked={a.theme === id} onClick={() => editApp((d) => { d.appearance.theme = id })}
                  className={cn('relative rounded-xl border p-2.5 text-left transition', a.theme === id ? 'border-brand-600 bg-brand-50/60 ring-2 ring-brand-600/20' : 'border-slate-200 bg-white hover:border-slate-300')}>
                  <Swatches pal={THEME_PALETTES[id] as unknown as Record<string, string>} />
                  <span className="mt-2 block truncate text-xs font-medium text-slate-700">{THEME_LABEL[id]}</span>
                  {a.theme === id && <Check className="absolute right-2 top-2 h-4 w-4 rounded-full bg-brand-600 p-0.5 text-white" />}
                </button>
              ))}
              <div role="radio" aria-checked={a.theme === 'custom'} tabIndex={0} onClick={() => editApp((d) => { d.appearance.theme = 'custom' })} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') editApp((d) => { d.appearance.theme = 'custom' }) }}
                className={cn('relative cursor-pointer rounded-xl border p-2.5 transition', a.theme === 'custom' ? 'border-brand-600 bg-brand-50/60 ring-2 ring-brand-600/20' : 'border-slate-200 bg-white hover:border-slate-300')}>
                <Swatches pal={paletteFromHex(a.customColor)} />
                <span className="mt-2 flex items-center gap-1.5">
                  <input type="color" aria-label="Custom colour" value={validHex ? a.customColor : '#5c5c99'} onChange={(e) => editApp((d) => { d.appearance.customColor = e.target.value; d.appearance.theme = 'custom' })} className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0" />
                  <input aria-label="Custom colour hex" value={a.customColor} maxLength={7} onChange={(e) => editApp((d) => { d.appearance.customColor = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`; d.appearance.theme = 'custom' })}
                    className={cn('w-full min-w-0 rounded border bg-white px-1 py-0.5 font-mono text-[11px] uppercase', validHex ? 'border-slate-200' : 'border-rose-300 text-rose-600')} />
                </span>
                {a.theme === 'custom' && <Check className="absolute right-2 top-2 h-4 w-4 rounded-full bg-brand-600 p-0.5 text-white" />}
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-400">Primary shade: <span className="font-mono">{rgbToHex(paletteFor(a)['600'])}</span> · Charts, buttons, links and highlights follow this colour. The public website keeps its own periwinkle design.</p>
          </div>
          <MiniDashboard a={a} />
        </div>
      </Section>

      <Section title="Layout" description="Sidebar style, density and corner roundness." icon={<PanelLeft className="h-4 w-4" />}>
        <div className="grid gap-5 sm:grid-cols-3">
          <div><span className="label">Sidebar</span><Segmented value={a.sidebar} onChange={(v) => editApp((d) => { d.appearance.sidebar = v })} options={[{ value: 'dark', label: 'Dark' }, { value: 'brand', label: 'Colour' }, { value: 'light', label: 'Light' }]} /></div>
          <div><span className="label">Interface size</span><Segmented value={a.size} onChange={(v) => editApp((d) => { d.appearance.size = v })} options={[{ value: 'compact', label: 'Compact' }, { value: 'default', label: 'Default' }, { value: 'large', label: 'Large' }]} /></div>
          <div><span className="label">Corners</span><Segmented value={a.radius} onChange={(v) => editApp((d) => { d.appearance.radius = v })} options={[{ value: 'sharp', label: 'Sharp' }, { value: 'default', label: 'Soft' }, { value: 'round', label: 'Round' }]} /></div>
        </div>
      </Section>

      <Section title="Modules" description="Turn off sections your hospital doesn't use. They disappear from everyone's sidebar; you (owner) still see them, marked with an eye icon." icon={<LayoutGrid className="h-4 w-4" />}
        action={<span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{hidden.size} hidden</span>}>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {NAV.map((section) => (
            <div key={section.title}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{section.title}</p>
              <div className="space-y-1.5">
                {section.items.map((item) => {
                  const locked = LOCKED_MODULES.includes(item.path)
                  const on = !hidden.has(item.path)
                  const label = typeof item.label === 'function' ? item.label('owner') : item.label
                  return (
                    <button key={item.path} type="button" role="switch" aria-checked={on} disabled={locked}
                      onClick={() => editApp((d) => { d.modules.hidden = on ? [...d.modules.hidden, item.path] : d.modules.hidden.filter((p) => p !== item.path) })}
                      className={cn('flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition', on ? 'border-slate-200 bg-white hover:bg-slate-50' : 'border-dashed border-slate-300 bg-slate-50 text-slate-400', locked && 'cursor-not-allowed opacity-70')}>
                      <item.icon className={cn('h-4 w-4 shrink-0', on ? 'text-brand-600' : 'text-slate-300')} />
                      <span className={cn('min-w-0 flex-1 truncate', !on && 'line-through')}>{label}</span>
                      {locked ? <Lock className="h-3.5 w-3.5 text-slate-300" aria-label="Always on" /> : on ? <Eye className="h-3.5 w-3.5 text-slate-400" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Announcement banner" description="A message shown at the top of every dashboard page until the user dismisses it." icon={<Megaphone className="h-4 w-4" />}>
        <div className="space-y-4">
          <Toggle label="Show announcement" checked={ann.enabled} onChange={(v) => editApp((d) => { d.announcement.enabled = v })} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Message" className="sm:col-span-3"><Textarea rows={2} maxLength={280} value={ann.text} onChange={(e) => editApp((d) => { d.announcement.text = e.target.value })} placeholder="e.g. OPD will be closed on 2 October for Gandhi Jayanti." /></Field>
            <Field label="Style"><Select value={ann.tone} onChange={(e) => editApp((d) => { d.announcement.tone = e.target.value as typeof ann.tone })}><option value="info">Info</option><option value="success">Success</option><option value="warning">Warning</option><option value="danger">Urgent</option></Select></Field>
            <Field label="Who sees it"><Select value={ann.audience} onChange={(e) => editApp((d) => { d.announcement.audience = e.target.value as typeof ann.audience })}><option value="staff">Staff only</option><option value="patients">Patients only</option><option value="everyone">Everyone</option></Select></Field>
            <Field label="Link (optional)"><Input value={ann.link} onChange={(e) => editApp((d) => { d.announcement.link = e.target.value })} placeholder="/notices or https://…" /></Field>
          </div>
          {ann.text.trim() && (
            <div className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', TONE[ann.tone], !ann.enabled && 'opacity-50')}>
              <Megaphone className="mt-0.5 h-4 w-4 shrink-0" /><p className="flex-1">{ann.text}{ann.link && <span className="font-semibold underline"> Learn more</span>}</p>
            </div>
          )}
        </div>
      </Section>
    </div>
  )
}
