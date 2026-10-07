/**
 * Public online-booking API used by /book.
 *
 * SECURITY DEFINER RPCs in scripts/sql/booking.sql (anon key; tables stay locked).
 */
import { flushNotificationsSoon } from '../settings/store'
import { addDays, format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { freeSlots, type ScheduleExt } from '../lib/schedule'
import type { Appointment, Doctor, DoctorLeave, Holiday, Invoice, Patient } from '../types'
import { isLicenseError, LICENSE_PUBLIC_MESSAGE } from '../billing/license'
import type { SiteSettings } from '../site/cms/types'

export interface PublicDoctor {
  id: string
  full_name: string
  specialization: string
  department: string | null
  consultation_fee: number
  available_days: string[] | null
  shift: string | null
  status: Doctor['status']
}
export interface Availability {
  booked: Pick<Appointment, 'doctor_id' | 'appointment_date' | 'appointment_time' | 'status'>[]
  leaves: DoctorLeave[]
  holidays: Holiday[]
}
export interface BookingInput {
  /** from verify_booking_otp; null when the hospital switched the booking code off (then `phone` is needed) */
  token: string | null
  phone?: string | null
  doctorId: string
  date: string
  time: string
  name: string
  gender: 'male' | 'female' | 'other'
  dob?: string | null
  email?: string | null
  reason?: string | null
}
export interface BookingReceipt {
  ref: string
  is_new_patient: boolean
  appointment: Appointment
  patient: Pick<Patient, 'id' | 'full_name' | 'mrn' | 'phone' | 'email' | 'gender' | 'address'>
  doctor: { id: string; full_name: string; specialization: string; department: string | null }
  invoice: Invoice
}
export class BookingError extends Error {
  constructor(message: string, public code: 'SLOT_TAKEN' | 'SLOT_UNAVAILABLE' | 'OTP_REQUIRED' | 'OTHER' = 'OTHER') { super(message) }
}

type Cfg = Pick<SiteSettings, 'booking' | 'billing'>

// ------------------------------------------------------------------ helpers
export const phone10 = (p: string) => p.replace(/\D/g, '').slice(-10)
export const validMobile = (p: string) => /^[6-9]\d{9}$/.test(phone10(p))
export const prettyPhone = (p: string) => { const d = phone10(p); return `+91 ${d.slice(0, 5)} ${d.slice(5)}` }

function fromPg(e: { message: string } | null): never {
  const m = e?.message ?? 'Something went wrong'
  if (isLicenseError(m)) throw new BookingError(LICENSE_PUBLIC_MESSAGE, 'OTHER')
  const code = (['SLOT_TAKEN', 'SLOT_UNAVAILABLE', 'OTP_REQUIRED'] as const).find((c) => m.startsWith(c))
  throw new BookingError(code ? m.slice(code.length + 1).trim() : m, code ?? 'OTHER')
}
const rpc = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await supabase!.rpc(fn, args)
  if (error) fromPg(error)
  return data as T
}

/** Free slots for a doctor on a date, from public availability data. */
export function slotsFor(doc: PublicDoctor, date: string, av: Availability | undefined, cfg: Cfg, now = new Date()): string[] {
  if (!av) return []
  const ext: ScheduleExt = { leaves: av.leaves, holidays: av.holidays }
  const asDoctor = { ...doc, department_id: null, profile_id: null } as unknown as Doctor
  return freeSlots(asDoctor, date, av.booked as Appointment[], ext, { now, minNoticeMinutes: cfg.booking.minNoticeMinutes })
}
export const bookingWindow = (cfg: Cfg, from = new Date()) =>
  Array.from({ length: Math.max(1, Math.min(90, cfg.booking.advanceDays)) + 1 }, (_, i) => format(addDays(from, i), 'yyyy-MM-dd'))

// ------------------------------------------------------------------ one-time code
export type OtpChannel = 'whatsapp' | 'sms' | 'email'
export interface OtpResult {
  sent: boolean; expires_in: number; channels: OtpChannel[]
  /** demo hospital with "codes on screen" (demo.sql): nothing is sent, the code is shown */
  demo_code?: string
}
/** Settings → Security → "Verify the mobile number when booking online": is a code needed, and over which channels */
export interface OtpConfig { required: boolean; channels: OtpChannel[] }

// ------------------------------------------------------------------ Supabase implementation
const remote = {
  doctors: () => rpc<PublicDoctor[]>('public_doctors'),
  availability: (doctorId: string | null, from: string, to: string) => rpc<Availability>('public_availability', { p_doctor: doctorId, p_from: from, p_to: to }),
  otpChannels: async () => (await rpc<OtpChannel[] | null>('booking_otp_channels')) ?? [],
  otpConfig: async (): Promise<OtpConfig> => {
    const { data, error } = await supabase!.rpc('booking_otp_config')
    if (error) return { required: true, channels: await remote.otpChannels() }   // older database: always a code
    const c = data as { required?: boolean; channels?: OtpChannel[] | null }
    return { required: c.required !== false, channels: c.channels ?? [] }
  },
  requestOtp: async (phone: string, channel?: OtpChannel, email?: string | null): Promise<OtpResult> => {
    const r = await rpc<OtpResult & { queued?: number; ref?: string }>('request_booking_otp',
      { p_phone: phone, p_channel: channel ?? null, ...(email ? { p_email: email.trim() } : {}) })
    if (r.queued) flushNotificationsSoon(0, [r.ref])   // deliver the code right away
    else throw new BookingError('We could not send a code right now — no SMS, WhatsApp or e-mail service is connected. Please call the hospital to book.')
    return { ...r, channels: r.channels ?? [] }
  },
  verifyOtp: (phone: string, code: string) => rpc<{ ok: boolean; token?: string; error?: string }>('verify_booking_otp', { p_phone: phone, p_code: code }),
  book: (i: BookingInput) => rpc<BookingReceipt>('public_book_appointment', {
    p_token: i.token, p_doctor: i.doctorId, p_date: i.date, p_time: i.time, p_name: i.name, p_gender: i.gender,
    p_dob: i.dob || null, p_email: i.email || null, p_reason: i.reason || null,
    ...(i.token ? {} : { p_phone: i.phone ?? null }),   // no code: the hospital switched it off
  }),
}

export const bookingApi = {
  doctors: () => remote.doctors(),
  availability: (doctorId: string | null, from: string, to: string) => remote.availability(doctorId, from, to),
  /** channels that can deliver the booking code, WhatsApp first */
  otpChannels: () => remote.otpChannels(),
  /** is a code needed at all (Settings → Security), and which channels */
  otpConfig: () => remote.otpConfig(),
  requestOtp: (phone: string, _cfg?: Cfg, channel?: OtpChannel, email?: string | null) => remote.requestOtp(phone, channel, email),
  verifyOtp: (phone: string, code: string) => remote.verifyOtp(phone, code),
  book: async (input: BookingInput, _cfg?: Cfg) => {
    const r = await remote.book(input)
    flushNotificationsSoon(300, [r.appointment?.id, r.invoice?.id])   // booking confirmation / invoice messages
    return r
  },
}

// ------------------------------------------------------------------ receipt persistence + calendar file
const RECEIPT_KEY = 'dch:last-booking'
const readJson = <T,>(k: string): T | null => { try { return JSON.parse(sessionStorage.getItem(k) ?? 'null') as T } catch { return null } }
export const saveReceipt = (r: BookingReceipt) => { try { sessionStorage.setItem(RECEIPT_KEY, JSON.stringify(r)) } catch { /* private mode */ } }
export const loadReceipt = (ref?: string | null): BookingReceipt | null => {
  const r = readJson<BookingReceipt>(RECEIPT_KEY)
  return r && (!ref || r.ref === ref) ? r : null
}

export function icsFor(r: BookingReceipt, hospital: { name: string; address: string; phone: string }) {
  const [h, m] = r.appointment.appointment_time.slice(0, 5).split(':').map(Number)
  const start = new Date(`${r.appointment.appointment_date}T00:00:00`); start.setHours(h, m, 0, 0)
  const end = new Date(start.getTime() + 30 * 60e3)
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n')
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DC Hospital//Online booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${r.ref}@dchospital`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(`Consultation — ${r.doctor.full_name} (${hospital.name})`)}`,
    `LOCATION:${esc(hospital.address)}`,
    `DESCRIPTION:${esc(`Booking ${r.ref} · ${r.doctor.specialization}\nPatient: ${r.patient.full_name} (${r.patient.mrn})\nPlease arrive 15 minutes early. ${hospital.phone}`)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Doctor appointment in 2 hours', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
}
