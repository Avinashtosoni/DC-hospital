/**
 * Public online-booking API used by /book.
 *
 * Supabase mode → SECURITY DEFINER RPCs in scripts/sql/booking.sql (anon key; tables stay locked).
 * Demo mode     → the same rules, run against the browser's local demo database.
 * Both return identical shapes, so the wizard does not care which one it talks to.
 */
import { flushNotificationsSoon } from '../settings/store'
import { addDays, format, parseISO } from 'date-fns'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { asActor, localAdapter } from '../data/localAdapter'
import { freeSlots, type ScheduleExt } from '../lib/schedule'
import type { Appointment, Doctor, DoctorLeave, Holiday, Invoice, Patient } from '../types'
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
  token: string
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
const normName = (s: string) => s.trim().replace(/\s+/g, ' ')

function fromPg(e: { message: string } | null): never {
  const m = e?.message ?? 'Something went wrong'
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

// ------------------------------------------------------------------ demo-mode (local) implementation
const OTP_KEY = 'dch:booking-otp'
const TOKEN_KEY = 'dch:booking-token'
interface LocalOtp { phone: string; code: string; expires: number; attempts: number; sentAt: number; history: number[] }
interface LocalToken { token: string; phone: string; expires: number; used?: boolean }
const readJson = <T,>(k: string): T | null => { try { return JSON.parse(sessionStorage.getItem(k) ?? 'null') as T } catch { return null } }

const local = {
  async doctors(): Promise<PublicDoctor[]> {
    const [docs, deps] = await Promise.all([localAdapter.list('doctors'), localAdapter.list('departments')])
    const dn = new Map(deps.map((d) => [d.id, d.name]))
    return docs.filter((d) => d.status === 'active').sort((a, b) => a.full_name.localeCompare(b.full_name)).map((d) => ({
      id: d.id, full_name: d.full_name, specialization: d.specialization, department: dn.get(d.department_id ?? '') ?? null,
      consultation_fee: Number(d.consultation_fee), available_days: d.available_days ?? null, shift: d.shift ?? null, status: d.status,
    }))
  },
  async availability(doctorId: string | null, from: string, to: string): Promise<Availability> {
    const [appts, leaves, holidays] = await Promise.all([localAdapter.list('appointments'), localAdapter.list('doctor_leaves'), localAdapter.list('holidays')])
    return {
      booked: appts.filter((a) => (!doctorId || a.doctor_id === doctorId) && a.appointment_date >= from && a.appointment_date <= to && a.status !== 'cancelled' && a.status !== 'no_show')
        .map(({ doctor_id, appointment_date, appointment_time, status }) => ({ doctor_id, appointment_date, appointment_time, status })),
      leaves: leaves.filter((l) => (!doctorId || l.doctor_id === doctorId) && l.status === 'approved' && l.start_date <= to && l.end_date >= from).map((l) => ({ ...l, reason: null })),
      holidays: holidays.filter((h) => h.holiday_date >= from && h.holiday_date <= to),
    }
  },
  async requestOtp(phone: string, cfg: Cfg) {
    await new Promise((r) => setTimeout(r, 500))
    if (!cfg.booking.enabled) throw new BookingError('Online booking is switched off right now. Please call the hospital to book.')
    if (!validMobile(phone)) throw new BookingError('Please enter a valid 10-digit Indian mobile number.')
    const p = phone10(phone), now = Date.now()
    const prev = readJson<LocalOtp>(OTP_KEY)
    const history = (prev?.phone === p ? prev.history : []).filter((t) => now - t < 3600e3)
    if (prev?.phone === p && now - prev.sentAt < 30e3) throw new BookingError('Please wait 30 seconds before requesting another code.')
    if (history.length >= 5) throw new BookingError('Too many codes requested for this number. Please try again in an hour.')
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0')
    sessionStorage.setItem(OTP_KEY, JSON.stringify({ phone: p, code, expires: now + 600e3, attempts: 0, sentAt: now, history: [...history, now] } satisfies LocalOtp))
    return { sent: true, expires_in: 600, demo_code: cfg.booking.showDemoOtp ? code : null }
  },
  async verifyOtp(phone: string, code: string): Promise<{ ok: boolean; token?: string; error?: string }> {
    await new Promise((r) => setTimeout(r, 400))
    const o = readJson<LocalOtp>(OTP_KEY)
    if (!o || o.phone !== phone10(phone) || o.expires < Date.now()) return { ok: false, error: 'This code has expired. Please request a new one.' }
    if (o.attempts >= 5) return { ok: false, error: 'Too many wrong attempts. Please request a new code.' }
    if (code !== o.code) {
      o.attempts++; sessionStorage.setItem(OTP_KEY, JSON.stringify(o))
      const left = 5 - o.attempts
      return { ok: false, error: left <= 0 ? 'Too many wrong attempts. Please request a new code.' : `That code is not correct — ${left} attempt${left === 1 ? '' : 's'} left.` }
    }
    const token = crypto.randomUUID()
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, phone: o.phone, expires: Date.now() + 30 * 60e3 } satisfies LocalToken))
    sessionStorage.setItem(OTP_KEY, JSON.stringify({ ...o, expires: 0 }))
    return { ok: true, token }
  },
  async book(input: BookingInput, cfg: Cfg): Promise<BookingReceipt> {
    const tk = readJson<LocalToken>(TOKEN_KEY)
    if (!tk || tk.token !== input.token || tk.used || tk.expires < Date.now()) throw new BookingError('Please verify your mobile number again.', 'OTP_REQUIRED')
    if (!cfg.booking.enabled) throw new BookingError('Online booking is switched off right now. Please call the hospital to book.')
    const name = normName(input.name)
    if (name.length < 2) throw new BookingError('Please enter the patient’s full name.')

    const [docs, deps, patients, appts, leaves, holidays, invoices] = await Promise.all([
      localAdapter.list('doctors'), localAdapter.list('departments'), localAdapter.list('patients'), localAdapter.list('appointments'),
      localAdapter.list('doctor_leaves'), localAdapter.list('holidays'), localAdapter.list('invoices'),
    ])
    const d = docs.find((x) => x.id === input.doctorId)
    if (!d || d.status !== 'active') throw new BookingError('This doctor is not taking bookings right now.', 'SLOT_UNAVAILABLE')
    const window = bookingWindow(cfg)
    if (!window.includes(input.date)) throw new BookingError(`Please choose a date within the next ${cfg.booking.advanceDays} days.`, 'SLOT_UNAVAILABLE')
    const free = freeSlots(d, input.date, appts, { leaves, holidays }, { minNoticeMinutes: cfg.booking.minNoticeMinutes })
    if (!free.includes(input.time)) {
      const taken = appts.some((a) => a.doctor_id === d.id && a.appointment_date === input.date && a.appointment_time.slice(0, 5) === input.time && a.status !== 'cancelled' && a.status !== 'no_show')
      throw taken ? new BookingError('Sorry — someone just booked this slot. Please pick another time.', 'SLOT_TAKEN') : new BookingError('This time is no longer available — please pick another slot.', 'SLOT_UNAVAILABLE')
    }

    return asActor('Website booking', 'public', async () => {
      let patient = patients.find((p) => phone10(p.phone ?? '') === tk.phone && normName(p.full_name).toLowerCase() === name.toLowerCase())
      let isNew = false
      if (patient) {
        if (appts.some((a) => a.patient_id === patient!.id && a.doctor_id === d.id && a.appointment_date === input.date && a.status !== 'cancelled' && a.status !== 'no_show'))
          throw new BookingError('You already have a booking with this doctor on this day.')
      } else {
        const mrn = `DCH-${Math.max(100000, ...patients.map((p) => Number(p.mrn.replace(/\D/g, '')) || 0)) + 1}`
        patient = await localAdapter.insert('patients', {
          mrn, full_name: name, gender: input.gender, date_of_birth: input.dob || null, phone: prettyPhone(tk.phone),
          email: input.email?.trim().toLowerCase() || null, status: 'outpatient',
        } as never)
        isNew = true
      }
      const ref = `DCB-${Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`
      const appointment = await localAdapter.insert('appointments', {
        patient_id: patient.id, doctor_id: d.id, appointment_date: input.date, appointment_time: input.time, type: 'consultation',
        status: 'scheduled', reason: input.reason?.trim().slice(0, 500) || null, source: 'website', booking_ref: ref,
      } as never)
      const fee = Number(d.consultation_fee)
      const tax = Math.round(fee * (Number(cfg.billing.gstRate) || 0)) / 100
      const seq = Math.max(10000, ...invoices.map((i) => Number(i.invoice_number.replace(/\D/g, '')) || 0)) + 1
      const invoice = await localAdapter.insert('invoices', {
        invoice_number: `INV-${String(seq).padStart(5, '0')}`, patient_id: patient.id, issue_date: format(new Date(), 'yyyy-MM-dd'), due_date: input.date,
        items: [{ description: `Consultation — ${d.full_name} (${d.specialization}) · ${format(parseISO(input.date), 'dd MMM yyyy')}, ${input.time}`, quantity: 1, unit_price: fee }],
        subtotal: fee, tax, discount: 0, total: fee + tax, amount_paid: 0, status: 'unpaid', notes: `Online booking ${ref}`,
      } as never)
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ ...tk, used: true }))
      return {
        ref, is_new_patient: isNew, appointment, invoice,
        patient: { id: patient.id, full_name: patient.full_name, mrn: patient.mrn, phone: patient.phone, email: patient.email, gender: patient.gender, address: patient.address },
        doctor: { id: d.id, full_name: d.full_name, specialization: d.specialization, department: deps.find((x) => x.id === d.department_id)?.name ?? null },
      }
    })
  },
}

// ------------------------------------------------------------------ Supabase implementation
const remote = {
  doctors: () => rpc<PublicDoctor[]>('public_doctors'),
  availability: (doctorId: string | null, from: string, to: string) => rpc<Availability>('public_availability', { p_doctor: doctorId, p_from: from, p_to: to }),
  requestOtp: async (phone: string) => {
    const r = await rpc<{ sent: boolean; expires_in: number; queued?: number; ref?: string; demo_code: string | null }>('request_booking_otp', { p_phone: phone })
    if (r.queued) flushNotificationsSoon(0, [r.ref])   // deliver the SMS / WhatsApp right away
    return r
  },
  verifyOtp: (phone: string, code: string) => rpc<{ ok: boolean; token?: string; error?: string }>('verify_booking_otp', { p_phone: phone, p_code: code }),
  book: (i: BookingInput) => rpc<BookingReceipt>('public_book_appointment', {
    p_token: i.token, p_doctor: i.doctorId, p_date: i.date, p_time: i.time, p_name: i.name, p_gender: i.gender,
    p_dob: i.dob || null, p_email: i.email || null, p_reason: i.reason || null,
  }),
}

export const bookingApi = {
  mode: isSupabaseConfigured ? 'supabase' as const : 'local' as const,
  doctors: () => (isSupabaseConfigured ? remote.doctors() : local.doctors()),
  availability: (doctorId: string | null, from: string, to: string) => (isSupabaseConfigured ? remote.availability(doctorId, from, to) : local.availability(doctorId, from, to)),
  requestOtp: (phone: string, cfg: Cfg) => (isSupabaseConfigured ? remote.requestOtp(phone) : local.requestOtp(phone, cfg)),
  verifyOtp: (phone: string, code: string) => (isSupabaseConfigured ? remote.verifyOtp(phone, code) : local.verifyOtp(phone, code)),
  book: async (input: BookingInput, cfg: Cfg) => {
    const r = await (isSupabaseConfigured ? remote.book(input) : local.book(input, cfg))
    flushNotificationsSoon(300, [r.appointment?.id, r.invoice?.id])   // booking confirmation / invoice messages
    return r
  },
}

/** Demo-mode WhatsApp booking (chatbot simulator): the chat number is already verified by WhatsApp. */
export async function localWhatsappBook(phone: string, input: Omit<BookingInput, 'token' | 'gender' | 'dob' | 'email'>, cfg: Cfg) {
  const token = crypto.randomUUID()
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, phone: phone10(phone), expires: Date.now() + 60e3 } satisfies LocalToken))
  const r = await local.book({ ...input, token, gender: 'other', dob: null, email: null }, cfg)
  await asActor('WhatsApp booking', 'public', () => localAdapter.update('appointments', r.appointment.id, { source: 'whatsapp' } as never))
  return r
}

// ------------------------------------------------------------------ receipt persistence + calendar file
const RECEIPT_KEY = 'dch:last-booking'
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
