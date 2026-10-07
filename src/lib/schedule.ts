import { format, parseISO } from 'date-fns'
import type { Appointment, Doctor, DoctorLeave, Holiday, LeaveKind } from '../types'
import type { Query } from '../data/query'
import { today } from './utils'

/**
 * Availability engine shared by the dashboard calendar, the reschedule queue and online booking.
 * Pure functions — the same rules run in the browser (demo + Supabase) and are mirrored by
 * public.public_book_appointment() in SQL.
 */

/** OPD slot grid: 08:00 → 18:30 in 30-minute steps (same grid as the booking form). */
export const SLOTS = Array.from({ length: 22 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const DEFAULT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DEFAULT_SHIFT: [number, number] = [9 * 60, 17 * 60]

/** Appointments that no longer hold a slot. */
export const INACTIVE = new Set<Appointment['status']>(['cancelled', 'no_show'])
export const holdsSlot = (a: Appointment) => !INACTIVE.has(a.status)
/** Appointments that still need to happen (used for conflict detection). */
export const isOpenAppt = (a: Appointment) => a.status === 'scheduled' || a.status === 'confirmed'

export const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
const hhmm = (t: string) => t.slice(0, 5)

/** "09:00 – 14:00" / "9:00-14:00" → minutes. Falls back to 09:00–17:00. */
export function parseShift(shift?: string | null): [number, number] {
  const m = shift?.match(/(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})/)
  if (!m) return DEFAULT_SHIFT
  const a = toMin(m[1]), b = toMin(m[2])
  return b > a ? [a, b] : DEFAULT_SHIFT
}

export const weekday = (date: string) => format(parseISO(date), 'EEE')

// ------------------------------------------------------------------ leave / holidays
/** Extra calendar data. Only *approved* leave counts; pass everything, it is filtered here. */
export interface ScheduleExt { leaves?: DoctorLeave[]; holidays?: Holiday[] }

export const LEAVE_LABEL: Record<LeaveKind, string> = {
  leave: 'Leave', surgery: 'Surgery', meeting: 'Meeting', conference: 'Conference', training: 'Training', other: 'Blocked',
}
export const isFullDay = (l: Pick<DoctorLeave, 'start_time' | 'end_time'>) => !l.start_time || !l.end_time
const covers = (l: DoctorLeave, date: string) => l.status === 'approved' && l.start_date <= date && l.end_date >= date

export const holidayOn = (date: string, ext?: ScheduleExt) => ext?.holidays?.find((h) => h.holiday_date === date)
export const fullDayLeave = (docId: string, date: string, ext?: ScheduleExt) =>
  ext?.leaves?.find((l) => l.doctor_id === docId && covers(l, date) && isFullDay(l))
/** Approved time-range block (surgery, meeting…) covering this slot. */
export function blockAt(docId: string, date: string, time: string, ext?: ScheduleExt): DoctorLeave | undefined {
  const m = toMin(time)
  return ext?.leaves?.find((l) => l.doctor_id === docId && covers(l, date) && !isFullDay(l) && toMin(l.start_time!) <= m && m < toMin(l.end_time!))
}

export type RestReason = 'weekly_off' | 'on_leave' | 'inactive' | 'holiday' | 'leave'
export const REST_LABEL: Record<RestReason, string> = { weekly_off: 'Weekly off', on_leave: 'On leave', inactive: 'Inactive', holiday: 'Holiday', leave: 'Leave' }

/** null = working that day, otherwise why the doctor is resting */
export function restReason(doc: Doctor, date: string, ext?: ScheduleExt): RestReason | null {
  if (doc.status === 'inactive') return 'inactive'
  if (doc.status === 'on_leave') return 'on_leave'
  if (holidayOn(date, ext)) return 'holiday'
  if (fullDayLeave(doc.id, date, ext)) return 'leave'
  const days = doc.available_days?.length ? doc.available_days : DEFAULT_DAYS
  return days.includes(weekday(date)) ? null : 'weekly_off'
}

/** Slots inside the doctor's shift on a working day (ignores time-range blocks). */
export function shiftSlots(doc: Doctor, date: string, ext?: ScheduleExt): string[] {
  if (restReason(doc, date, ext)) return []
  const [a, b] = parseShift(doc.shift)
  return SLOTS.filter((s) => { const m = toMin(s); return m >= a && m < b })
}
/** Bookable slots for a doctor on a date ([] when resting; blocked ranges removed). */
export function doctorSlots(doc: Doctor, date: string, ext?: ScheduleExt): string[] {
  return shiftSlots(doc, date, ext).filter((s) => !blockAt(doc.id, date, s, ext))
}

/**
 * Why an existing appointment can no longer go ahead as booked (null = fine).
 * Drives the "needs rescheduling" flags in the calendar and the reschedule queue.
 */
export function conflictOf(a: Appointment, doc: Doctor | undefined, ext?: ScheduleExt): string | null {
  if (!isOpenAppt(a) || !doc) return null
  const date = a.appointment_date, time = hhmm(a.appointment_time)
  const h = holidayOn(date, ext)
  if (h) return `Hospital holiday — ${h.name}`
  if (doc.status === 'inactive') return `${doc.full_name} is no longer consulting`
  if (doc.status === 'on_leave') return `${doc.full_name} is on leave`
  const l = fullDayLeave(doc.id, date, ext)
  if (l) return `${doc.full_name} — ${LEAVE_LABEL[l.kind].toLowerCase()}${l.reason ? ` (${l.reason})` : ''}`
  const b = blockAt(doc.id, date, time, ext)
  if (b) return `${doc.full_name} — ${LEAVE_LABEL[b.kind].toLowerCase()} ${b.start_time}–${b.end_time}${b.reason ? ` (${b.reason})` : ''}`
  return null
}

// ------------------------------------------------------------------ levels
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
  holiday?: Holiday
  capacity: number
  /** active bookings (scheduled / confirmed / checked in / completed) */
  booked: number
  /** bookings that fall inside a bookable slot — used for "available" */
  bookedInSlots: number
  available: number
  cancelled: number
  /** open appointments that clash with leave / holiday / blocked time */
  conflicts: number
  working: Doctor[]
  resting: { doctor: Doctor; reason: RestReason; leave?: DoctorLeave }[]
  /** approved time-range blocks on this day */
  blocks: DoctorLeave[]
  appointments: Appointment[]
  level: Level
}

export function summarizeDay(date: string, doctors: Doctor[], appts: Appointment[], ext?: ScheduleExt): DaySummary {
  const working: Doctor[] = []
  const resting: DaySummary['resting'] = []
  let capacity = 0, bookedInSlots = 0, conflicts = 0
  const dayAppts = appts.filter((a) => a.appointment_date === date)
  const active = dayAppts.filter(holdsSlot)
  const docById = new Map(doctors.map((d) => [d.id, d]))
  for (const d of doctors) {
    const r = restReason(d, date, ext)
    if (r) { if (r !== 'inactive') resting.push({ doctor: d, reason: r, leave: r === 'leave' ? fullDayLeave(d.id, date, ext) : undefined }); continue }
    working.push(d)
    const slots = new Set(doctorSlots(d, date, ext))
    capacity += slots.size
    bookedInSlots += new Set(active.filter((a) => a.doctor_id === d.id && slots.has(hhmm(a.appointment_time))).map((a) => hhmm(a.appointment_time))).size
  }
  for (const a of dayAppts) if (conflictOf(a, docById.get(a.doctor_id), ext)) conflicts++
  const blocks = (ext?.leaves ?? []).filter((l) => docById.has(l.doctor_id) && covers(l, date) && !isFullDay(l))
  return {
    date, holiday: holidayOn(date, ext), capacity, booked: active.length, bookedInSlots, available: Math.max(0, capacity - bookedInSlots),
    cancelled: dayAppts.length - active.length, conflicts, working, resting, blocks,
    appointments: dayAppts.sort((a, b) => a.appointment_time.localeCompare(b.appointment_time)),
    level: levelOf(bookedInSlots, capacity),
  }
}

/** Free, still-bookable slots for one doctor on one date (online booking). */
export function freeSlots(doc: Doctor, date: string, appts: Pick<Appointment, 'doctor_id' | 'appointment_date' | 'appointment_time' | 'status'>[], ext?: ScheduleExt, opts: { now?: Date; minNoticeMinutes?: number } = {}): string[] {
  const taken = new Set(appts.filter((a) => a.doctor_id === doc.id && a.appointment_date === date && !INACTIVE.has(a.status)).map((a) => hhmm(a.appointment_time)))
  const now = opts.now ?? new Date()
  const todayIso = format(now, 'yyyy-MM-dd')
  if (date < todayIso) return []
  const cutoff = date === todayIso ? now.getHours() * 60 + now.getMinutes() + (opts.minNoticeMinutes ?? 60) : -1
  return doctorSlots(doc, date, ext).filter((s) => !taken.has(s) && toMin(s) >= cutoff)
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

/** Live bookings from today on — enough for clash counts, the reschedule queue and free-slot checks. */
export const upcomingOpenQuery = (): Query => ({ where: [['appointment_date', 'gte', today()], ['status', 'in', ['scheduled', 'confirmed', 'checked_in']]] })
