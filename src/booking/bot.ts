/**
 * Browser side of the WhatsApp chatbot: runs the shared conversation engine against the demo data,
 * or asks the deployed `whatsapp-bot` Edge Function to simulate a chat (Supabase mode).
 */
import { format } from 'date-fns'
import { botReply, newBotState, type BotDeps, type BotState } from '../../supabase/functions/_shared/bot'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { localAdapter } from '../data/localAdapter'
import { bookingApi, bookingWindow, localWhatsappBook, phone10, slotsFor } from './api'
import type { SiteSettings } from '../site/cms/types'

export type { BotState }
export { newBotState }

function localDeps(phone: string, site: SiteSettings): BotDeps {
  const p10 = phone10(phone)
  const mine = async () => (await localAdapter.list('patients')).filter((p) => phone10(p.phone ?? '') === p10)
  return {
    hospital: { name: site.name, phone: site.appointmentsPhone || site.phone, address: site.address, site: site.siteUrl || window.location.origin },
    async doctors() {
      return (await bookingApi.doctors()).map((d) => ({ id: d.id, name: d.full_name, specialization: d.specialization, department: d.department, fee: d.consultation_fee }))
    },
    async freeSlots(doctorId) {
      const doc = (await bookingApi.doctors()).find((d) => d.id === doctorId)
      if (!doc) return []
      const days = bookingWindow(site)
      const av = await bookingApi.availability(doctorId, days[0], days[days.length - 1])
      const out: { date: string; time: string }[] = []
      for (const day of days) {
        for (const time of slotsFor(doc, day, av, site)) { out.push({ date: day, time }); if (out.length >= 8) return out }
      }
      return out
    },
    async patient() { return (await mine())[0] ?? null },
    async book(i) {
      const r = await localWhatsappBook(p10, { doctorId: i.doctorId, date: i.date, time: i.time, name: i.name, reason: i.reason }, site)
      return { ref: r.ref, date: i.date, time: i.time, doctor: r.doctor.full_name, total: Number(r.invoice.total), mrn: r.patient.mrn }
    },
    async upcoming() {
      const ids = new Set((await mine()).map((p) => p.id))
      const [appts, docs] = await Promise.all([localAdapter.list('appointments'), localAdapter.list('doctors')])
      const today = format(new Date(), 'yyyy-MM-dd')   // local calendar day (toISOString is UTC → yesterday before 05:30 IST)
      return appts.filter((a) => ids.has(a.patient_id) && a.appointment_date >= today && ['scheduled', 'confirmed'].includes(a.status))
        .sort((a, b) => (a.appointment_date + a.appointment_time).localeCompare(b.appointment_date + b.appointment_time))
        .slice(0, 9)
        .map((a) => ({ id: a.id, ref: a.booking_ref ?? a.id.slice(0, 8).toUpperCase(), date: a.appointment_date, time: a.appointment_time.slice(0, 5), status: a.status, doctor: docs.find((d) => d.id === a.doctor_id)?.full_name ?? 'Doctor' }))
    },
    async cancel(id) { await localAdapter.update('appointments', id, { status: 'cancelled' }) },
  }
}

/** One chat turn from the simulator. Supabase mode runs the real Edge Function (staff only), so the preview matches production. */
export async function simulateBot(phone: string, text: string, state: BotState | null, site: SiteSettings): Promise<{ state: BotState; replies: string[] }> {
  if (!isSupabaseConfigured) return botReply(state, text, localDeps(phone, site))
  const { data, error } = await supabase!.functions.invoke('whatsapp-bot', { body: { simulate: { from: phone10(phone), text } } })
  if (error) throw new Error(`${error.message}. Is the whatsapp-bot function deployed? (supabase functions deploy whatsapp-bot --no-verify-jwt)`)
  return data as { state: BotState; replies: string[] }
}
