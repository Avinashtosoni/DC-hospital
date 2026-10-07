import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import type { Service, SiteDoctor, SiteSettings } from '../site/cms/types'
import { bookingApi, bookingWindow, slotsFor, type Availability, type PublicDoctor } from './api'

/** A bookable doctor: the real schedule (database) joined with the public profile (CMS) by name. */
export interface BookDoc {
  db: PublicDoctor
  site?: SiteDoctor
  service: string
  name: string
  role: string
  img?: string
  fee: number
}
export const nameKey = (s: string) => s.toLowerCase().replace(/^dr\.?\s*/, '').replace(/[^a-z]/g, '')
const loose = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '')

export function buildDirectory(dbDocs: PublicDoctor[], siteDocs: SiteDoctor[], services: Service[]): BookDoc[] {
  const byName = new Map(siteDocs.map((d) => [nameKey(d.name), d]))
  return dbDocs.map((db) => {
    const site = byName.get(nameKey(db.full_name))
    const dep = loose(db.department ?? db.specialization)
    const svc = site?.service ?? services.find((s) => loose(s.name).includes(dep) || dep.includes(loose(s.name)) || loose(s.slug) === dep)?.slug ?? 'other'
    return { db, site, service: svc, name: db.full_name, role: site?.role ?? db.specialization, img: site?.img, fee: Number(db.consultation_fee) }
  })
}

export const BOOK_QK = ['public-booking'] as const

export function useBookingData(cfg: Pick<SiteSettings, 'booking' | 'billing'>) {
  const days = useMemo(() => bookingWindow(cfg), [cfg])
  const from = days[0], to = days[days.length - 1]
  const docsQ = useQuery({ queryKey: [...BOOK_QK, 'doctors'], queryFn: bookingApi.doctors, staleTime: 5 * 60_000 })
  const availQ = useQuery({
    queryKey: [...BOOK_QK, 'availability', from, to],
    queryFn: () => bookingApi.availability(null, from, to),
    staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: true,
  })
  return { days, docsQ, availQ }
}

/** Free slots per day for one doctor across the booking window. */
export function useDoctorDays(doc: PublicDoctor | undefined, days: string[], av: Availability | undefined, cfg: Pick<SiteSettings, 'booking' | 'billing'>) {
  return useMemo(() => {
    const out = new Map<string, string[]>()
    if (!doc) return out
    const mine: Availability | undefined = av && { booked: av.booked.filter((b) => b.doctor_id === doc.id), leaves: av.leaves.filter((l) => l.doctor_id === doc.id), holidays: av.holidays }
    for (const d of days) out.set(d, slotsFor(doc, d, mine, cfg))
    return out
  }, [doc, days, av, cfg])
}

export function firstFree(map: Map<string, string[]>): { date: string; time: string } | null {
  for (const [date, slots] of map) if (slots.length) return { date, time: slots[0] }
  return null
}

export function whenLabel(date: string, time?: string) {
  const t = format(new Date(), 'yyyy-MM-dd')
  const tm = format(new Date(Date.now() + 864e5), 'yyyy-MM-dd')
  const day = date === t ? 'Today' : date === tm ? 'Tomorrow' : format(parseISO(date), 'EEE, d MMM')
  if (!time) return day
  const [h, m] = time.split(':').map(Number)
  return `${day}, ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
