import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { format, startOfMonth, subDays } from 'date-fns'
import { loadUsage, summarise, type UsageRow } from '../../settings/messaging'
import { useAppSettings } from '../../settings/AppSettingsProvider'

export const USAGE_QK = ['notify-usage'] as const
export type UsageRange = '7d' | '30d' | '90d' | 'month' | '365d'
export const RANGE_LABEL: Record<UsageRange, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', month: 'This month', '90d': 'Last 90 days', '365d': 'Last 12 months' }

export function rangeDates(r: UsageRange, now = new Date()): [string, string] {
  const to = format(now, 'yyyy-MM-dd')
  if (r === 'month') return [format(startOfMonth(now), 'yyyy-MM-dd'), to]
  const days = r === '7d' ? 6 : r === '30d' ? 29 : r === '90d' ? 89 : 364
  return [format(subDays(now, days), 'yyyy-MM-dd'), to]
}

export function useUsage(range: UsageRange, opts: { enabled?: boolean } = {}) {
  const [from, to] = rangeDates(range)
  const { settings } = useAppSettings()
  const q = useQuery({ queryKey: [...USAGE_QK, from, to], queryFn: () => loadUsage(from, to), staleTime: 60_000, placeholderData: keepPreviousData, enabled: opts.enabled ?? true })
  const rows: UsageRow[] = q.data ?? []
  const summary = useMemo(() => summarise(rows, settings.notifications.rates ?? {}), [rows, settings.notifications.rates])
  return { ...q, rows, summary, from, to, rates: settings.notifications.rates }
}
