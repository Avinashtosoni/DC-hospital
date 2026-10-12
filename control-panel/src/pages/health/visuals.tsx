/**
 * Small, dependency-free SVG visuals for the Health page: a status ring / gauge, a donut with legend, a stacked
 * horizontal bar and a sparkline-sized meter. (The bigger time / bar charts are in HealthCharts.tsx with recharts.)
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import { cn } from '../../../../src/lib/utils'

export const COLOR = {
  ok: '#10b981', warn: '#f59e0b', fail: '#f43f5e', off: '#cbd5e1',
  brand: '#5C5C99', deep: '#292966', soft: '#A3A3CC', pale: '#CCCCFF', track: '#eef0f7',
} as const

/** colour for a "how full" percentage (higher = worse) */
export const loadColor = (pct: number, warn = 75, fail = 90) => (pct >= fail ? COLOR.fail : pct >= warn ? COLOR.warn : COLOR.ok)
/** colour for a "how good" percentage (higher = better), e.g. uptime */
export const goodColor = (pct: number) => (pct >= 99 ? COLOR.ok : pct >= 95 ? COLOR.warn : COLOR.fail)

/** a circular gauge: 0–100, with a value / caption in the middle */
export function Ring({ value, size = 96, stroke = 10, color, track = COLOR.track, children, label, className }: {
  value: number | null; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode; label?: string; className?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = value == null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }} role="img" aria-label={label ?? (value == null ? 'no data' : `${Math.round(v)}%`)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {value != null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color ?? COLOR.brand} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${(v / 100) * c} ${c}`} style={{ transition: 'stroke-dasharray .6s ease' }} />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  )
}

export interface Slice { key: string; label: string; value: number; color: string }

/** a donut chart: segments by value, total (or any node) in the centre */
export function Donut({ slices, size = 120, stroke = 16, children, label }: { slices: Slice[]; size?: number; stroke?: number; children?: ReactNode; label?: string }) {
  const total = slices.reduce((n, s) => n + s.value, 0)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const gap = slices.filter((s) => s.value > 0).length > 1 ? 2 : 0
  let at = 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img"
      aria-label={label ?? slices.map((s) => `${s.label}: ${s.value}`).join(', ')}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLOR.track} strokeWidth={stroke} />
        {total > 0 && slices.filter((s) => s.value > 0).map((s) => {
          const len = (s.value / total) * c
          const el = <circle key={s.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
            strokeDasharray={`${Math.max(len - gap, 0.5)} ${c}`} strokeDashoffset={-at} style={{ transition: 'stroke-dasharray .6s ease' }}>
            <title>{`${s.label}: ${s.value}`}</title>
          </circle>
          at += len
          return el
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  )
}

export function Legend({ slices, total, className }: { slices: Slice[]; total?: number; className?: string }) {
  const sum = total ?? slices.reduce((n, s) => n + s.value, 0)
  return (
    <ul className={cn('space-y-1.5 text-xs', className)}>
      {slices.map((s) => (
        <li key={s.key} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
          <span className="min-w-0 flex-1 truncate text-slate-600">{s.label}</span>
          <b className="tabular-nums text-brand-950">{s.value.toLocaleString('en-IN')}</b>
          {sum > 0 && <span className="w-9 text-right tabular-nums text-slate-400">{Math.round((100 * s.value) / sum)}%</span>}
        </li>
      ))}
    </ul>
  )
}

/** one horizontal bar split into coloured parts */
export function StackBar({ slices, className, height = 'h-2.5' }: { slices: Slice[]; className?: string; height?: string }) {
  const total = slices.reduce((n, s) => n + s.value, 0)
  return (
    <div className={cn('flex w-full overflow-hidden rounded-full bg-slate-100', height, className)} role="img" aria-label={slices.map((s) => `${s.label} ${s.value}`).join(', ')}>
      {total > 0 && slices.filter((s) => s.value > 0).map((s) => <span key={s.key} title={`${s.label}: ${s.value}`} style={{ width: `${(100 * s.value) / total}%`, background: s.color }} className="h-full transition-all" />)}
    </div>
  )
}

/** a labelled meter (used for resources such as connections, disk, CPU) */
export function Meter({ label, pct, detail, warn = 75, fail = 90 }: { label: string; pct: number | null; detail?: string | null; warn?: number; fail?: number }) {
  const color = pct == null ? COLOR.off : loadColor(pct, warn, fail)
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3">
      <Ring value={pct} size={58} stroke={7} color={color} label={`${label} ${pct == null ? 'unknown' : `${Math.round(pct)}%`}`}>
        <span className="text-xs font-bold tabular-nums text-brand-950">{pct == null ? '—' : `${Math.round(pct)}%`}</span>
      </Ring>
      <div className="min-w-0">
        <p className="text-sm font-medium text-brand-950">{label}</p>
        {detail && <p className="line-clamp-2 text-[11px] text-slate-500" title={detail}>{detail}</p>}
      </div>
    </div>
  )
}

/** the first "NN%" (or "NN.N%") in a check's detail text, e.g. "18 of 60 in use (26.7%)" → 26.7 */
export function pctFrom(detail: string | null | undefined): number | null {
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(detail ?? '')
  return m ? Math.min(100, Number(m[1])) : null
}

/** anchor id for a live-check group ("Edge functions" → "edge-functions") */
/** true below the given width (default: Tailwind's sm, 640 px) — re-renders when the window crosses it */
export function useIsSmall(px = 640) {
  const query = `(max-width: ${px - 1}px)`
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(query); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

export const slug = (g: string) => g.toLowerCase().replace(/[^a-z0-9]+/g, '-')
