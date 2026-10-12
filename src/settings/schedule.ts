/**
 * Custom-message schedules — TypeScript twin of public.notify_next_run() in scripts/sql/messaging.sql.
 * Times are India time (UTC+05:30, no daylight saving), so the arithmetic is a fixed offset.
 */
import type { NotificationTemplate, Role, TemplateSchedule } from '../types'

const IST = 330 * 60_000
type Sched = Pick<NotificationTemplate, 'enabled' | 'schedule' | 'send_at' | 'time_of_day' | 'weekday' | 'month_day'>

/** next time a template is due, strictly after `after`; null = nothing more to send */
export function nextRun(t: Sched, after = new Date()): Date | null {
  if (!t.enabled) return null
  if (t.schedule === 'manual') return null
  if (t.schedule === 'once') return t.send_at && new Date(t.send_at) > after ? new Date(t.send_at) : null
  const [hh, mm] = (t.time_of_day || '10:00').split(':').map(Number)
  const local = new Date(after.getTime() + IST)           // "wall clock" in India, read with getUTC*
  const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, hh, mm) - IST)
  const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate()
  if (t.schedule === 'daily' || t.schedule === 'birthday') {
    const c = at(y, m, d)
    return c > after ? c : at(y, m, d + 1)
  }
  if (t.schedule === 'weekly') {
    for (let i = 0; i <= 7; i++) {
      const c = at(y, m, d + i)
      if (new Date(c.getTime() + IST).getUTCDay() === (t.weekday ?? 1) && c > after) return c
    }
    return null
  }
  if (t.schedule === 'monthly') {
    const md = t.month_day ?? 1
    const c = at(y, m, md)
    return c > after ? c : at(y, m + 1, md)
  }
  return null
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`
const time12 = (hm: string) => { const [h, m] = hm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }

export const SCHEDULE_LABEL: Record<TemplateSchedule, string> = {
  manual: 'Send manually', once: 'Once, at a set time', daily: 'Every day', weekly: 'Every week', monthly: 'Every month', birthday: "On each patient's birthday",
}

/** "Every Monday at 8:30 AM" */
export function describeSchedule(t: Sched): string {
  const tm = time12(t.time_of_day || '10:00')
  switch (t.schedule) {
    case 'manual': return 'Manual — use “Send now”'
    case 'once': return t.send_at ? `Once on ${new Date(t.send_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}` : 'Once — pick a time'
    case 'daily': return `Every day at ${tm}`
    case 'weekly': return `Every ${WEEKDAYS[t.weekday ?? 1]} at ${tm}`
    case 'monthly': return `${ord(t.month_day ?? 1)} of every month at ${tm}`
    case 'birthday': return `Patients' birthdays at ${tm}`
  }
}

export const AUDIENCE_LABEL = { patients: 'All patients', staff: 'All staff', everyone: 'Everyone', roles: 'Selected roles' } as const

export function describeAudience(t: Pick<NotificationTemplate, 'audience' | 'roles' | 'schedule'>, roleLabel: (r: Role) => string): string {
  if (t.schedule === 'birthday') return 'Patients with a birthday today'
  if (t.audience === 'roles') return t.roles.map(roleLabel).join(', ') || 'No roles picked'
  return AUDIENCE_LABEL[t.audience]
}
