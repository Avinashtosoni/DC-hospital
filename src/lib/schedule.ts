import { format, parseISO } from 'date-fns'
import type { Appointment, Doctor } from '../types'

/** OPD slot grid: 08:00 → 18:30 in 30-minute steps (same grid as the booking form). */
export const SLOTS = Array.from({ length: 22 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const DEFAULT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DEFAULT_SHIFT: [number, number] = [9 * 60, 17 * 60]

/** Appointments that no longer hold a slot. */
export const INACTIVE = new Set<Appointment['status']>(['cancelled', 'no_show'])
export const holdsSlot = (a: Appointment) => !INACTIVE.has(a.status)

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }

/** "09:00 – 14:00" / "9:00-14:00" → minutes. Falls back to 09:00–17:00. */
export function parseShift(shift?: string | null): [number, number] {
  const m = shift?.match(/(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})/)
  if (!m) return DEFAULT_SHIFT
  const a = toMin(m[1]), b = toMin(m[2])
  return b > a ? [a, b] : DEFAULT_SHIFT
}

export const weekday = (date: string) => format(parseISO(date), 'EEE')

export type RestReason = 'weekly_off' | 'on_leave' | 'inactive'
/** null = working that day, otherwise why the doctor is resting */
export function restReason(doc: Doctor, date: string): RestReason | null {
  if (doc.status === 'inactive') return 'inactive'
  if (doc.status === 'on_leave') return 'on_leave'
  const days = doc.available_days?.length ? doc.available_days : DEFAULT_DAYS
  return days.includes(weekday(date)) ? null : 'weekly_off'
}

/** Bookable slots for a doctor on a date ([] when resting). */
export function doctorSlots(doc: Doctor, date: string): string[] {
  if (restReason(doc, date)) return []
  const [a, b] = parseShift(doc.shift)
  return SLOTS.filter((s) => { const m = toMin(s); return m >= a && m < b })
}

export type Level = 'rest' | 'open' | 'filling' | 'busy' | 'full'
export const levelOf = (booked: number, capacity: number): Level => {
  if (capacity === 0) return booked ? 'full' : 'rest'
  const u = booked / capacity
  return u >= 1 ? 'full' : u >= 0.75 ? 'busy' : u >= 0.4 ? 'filling' : 'open'
}
export const LEVEL: Record<Level, { label: string; dot: string; bar: string; soft: string; text: string }> = {
  open: { label: 'Plenty free', dot: 'bg-emerald-500', bar: 'bg-emerald-500', soft: 'bg-emerald-50', text: 'text-emerald-700' },
  filling: { label: 'Filling up', dot: 'bg-[#7a7ab3]', bar: 'bg-[#7a7ab3]', soft: 'bg-brand-50', text: 'text-brand-700' },
  busy: { label: 'Almost full', dot: 'bg-amber-500', bar: 'bg-amber-500', soft: 'bg-amber-50', text: 'text-amber-700' },
  full: { label: 'Fully booked', dot: 'bg-rose-500', bar: 'bg-rose-500', soft: 'bg-rose-50', text: 'text-rose-700' },
  rest: { label: 'Rest / OPD closed', dot: 'bg-slate-300', bar: 'bg-slate-300', soft: 'bg-slate-50', text: 'text-slate-500' },
}

export interface DaySummary {
  date: string
  capacity: number
  /** active bookings (scheduled / confirmed / checked in / completed) */
  booked: number
  /** bookings that fall inside a working slot — used for "available" */
  bookedInSlots: number
  available: number
  cancelled: number
  working: Doctor[]
  resting: { doctor: Doctor; reason: RestReason }[]
  appointments: Appointment[]
  level: Level
}

export function summarizeDay(date: string, doctors: Doctor[], appts: Appointment[]): DaySummary {
  const working: Doctor[] = []
  const resting: DaySummary['resting'] = []
  let capacity = 0, bookedInSlots = 0
  const dayAppts = appts.filter((a) => a.appointment_date === date)
  const active = dayAppts.filter(holdsSlot)
  for (const d of doctors) {
    const r = restReason(d, date)
    if (r) { if (r !== 'inactive') resting.push({ doctor: d, reason: r }); continue }
    working.push(d)
    const slots = new Set(doctorSlots(d, date))
    capacity += slots.size
    bookedInSlots += new Set(active.filter((a) => a.doctor_id === d.id && slots.has(a.appointment_time.slice(0, 5))).map((a) => a.appointment_time.slice(0, 5))).size
  }
  return {
    date, capacity, booked: active.length, bookedInSlots, available: Math.max(0, capacity - bookedInSlots),
    cancelled: dayAppts.length - active.length, working, resting,
    appointments: dayAppts.sort((a, b) => a.appointment_time.localeCompare(b.appointment_time)),
    level: levelOf(bookedInSlots, capacity),
  }
}

/** Colour chips for appointment status inside calendars. */
export const APPT_STYLE: Record<Appointment['status'], string> = {
  scheduled: 'border-l-[#7a7ab3] bg-brand-50 text-brand-900',
  confirmed: 'border-l-[#292966] bg-[#ebebff] text-brand-950',
  checked_in: 'border-l-amber-500 bg-amber-50 text-amber-900',
  completed: 'border-l-emerald-500 bg-emerald-50 text-emerald-900',
  cancelled: 'border-l-slate-300 bg-slate-50 text-slate-400 line-through',
  no_show: 'border-l-rose-300 bg-rose-50/60 text-rose-400 line-through',
}
