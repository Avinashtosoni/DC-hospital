import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { CalendarClock } from 'lucide-react'
import { Button, Modal, Skeleton } from '../../components/ui'
import { db } from '../../data/adapter'
import { qk, useTable } from '../../hooks/useData'
import { useBookingData, useDoctorDays } from '../../booking/useBooking'
import { FeedbackForm } from '../../feedback/FeedbackForm'
import { useT } from '../../i18n'
import { cn, fmtTime } from '../../lib/utils'
import { flushNotificationsSoon } from '../../settings/store'
import { useSiteSettings } from '../../site/cms/content'
import type { Appointment } from '../../types'

const startsAt = (a: Pick<Appointment, 'appointment_date' | 'appointment_time'>) => new Date(`${a.appointment_date}T${a.appointment_time}:00`)

/** Patient moves their own visit to another free slot of the same doctor. */
export function RescheduleDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useT()
  const site = useSiteSettings()
  const qc = useQueryClient()
  const appts = useTable('appointments')
  const appt = appts.data?.find((a) => a.id === id)
  const { days, docsQ, availQ } = useBookingData(site)
  const doc = docsQ.data?.find((d) => d.id === appt?.doctor_id)
  // the patient's own current slot counts as free
  const av = useMemo(() => availQ.data && appt ? { ...availQ.data, booked: availQ.data.booked.filter((b) => !(b.doctor_id === appt.doctor_id && b.appointment_date === appt.appointment_date && b.appointment_time.slice(0, 5) === appt.appointment_time.slice(0, 5))) } : availQ.data, [availQ.data, appt])
  const slotsByDay = useDoctorDays(doc, days, av, site)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (appt) { setDate(''); setTime('') } }, [appt?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const cutoffH = site.booking.rescheduleCutoffHours ?? 4
  const tooLate = appt ? startsAt(appt).getTime() - Date.now() < cutoffH * 3600_000 : false
  const openDays = days.filter((d) => (slotsByDay.get(d) ?? []).length)
  const pickedDay = date || openDays[0] || ''
  const slots = slotsByDay.get(pickedDay) ?? []

  const save = async () => {
    if (!appt || !pickedDay || !time) return
    setSaving(true)
    try {
      await db.update('appointments', appt.id, { appointment_date: pickedDay, appointment_time: time, status: 'scheduled' })
      toast.success(t('Appointment moved to {when}', { when: `${format(parseISO(pickedDay), 'EEE, d MMM')} · ${fmtTime(time)}` }))
      qc.invalidateQueries({ queryKey: qk('appointments') })
      qc.invalidateQueries({ queryKey: ['public-booking'] })
      flushNotificationsSoon(800, [appt.id])
      onClose()
    } catch (e) {
      toast.error(t('Could not reschedule'), { description: (e as Error).message.replace(/^SLOT_\w+:\s*/, '') })
      qc.invalidateQueries({ queryKey: ['public-booking'] })
    } finally { setSaving(false) }
  }

  return (
    <Modal open={!!id} onClose={onClose} size="max-w-xl" title={<span className="inline-flex items-center gap-2"><CalendarClock className="h-5 w-5 text-brand-600" />{t('Reschedule appointment')}</span>}
      footer={appt && !tooLate ? <>
        <Button variant="outline" onClick={onClose}>{t('Keep current time')}</Button>
        <Button onClick={save} loading={saving} disabled={!time}>{t('Confirm new time')}</Button>
      </> : <Button variant="outline" onClick={onClose}>{t('Close')}</Button>}>
      {!appt ? (appts.isLoading ? <Skeleton className="h-40" /> : <p className="text-sm text-slate-500">{t('Appointment not found.')}</p>) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-brand-50/70 px-4 py-3 text-sm ring-1 ring-brand-100">
            <p className="font-medium text-brand-950">{doc?.full_name ?? t('Doctor')}</p>
            <p className="text-slate-600">{t('Currently')}: {format(parseISO(appt.appointment_date), 'EEE, d MMM yyyy')} · {fmtTime(appt.appointment_time)}</p>
          </div>
          {tooLate ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
              {t('Appointments can be changed online up to {hours} hours before the visit. Please call {phone} to make changes.', { hours: cutoffH, phone: site.appointmentsPhone || site.phone })}
            </p>
          ) : docsQ.isLoading || availQ.isLoading ? <Skeleton className="h-40" /> : !openDays.length ? (
            <p className="text-sm text-slate-500">{t('No free slots with this doctor in the next {days} days. Please call the hospital.', { days: site.booking.advanceDays })}</p>
          ) : <>
            <div>
              <p className="label">{t('Choose a day')}</p>
              <div className="scrollbar-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {openDays.slice(0, 21).map((d) => (
                  <button key={d} type="button" onClick={() => { setDate(d); setTime('') }} aria-pressed={pickedDay === d}
                    className={cn('flex w-16 shrink-0 flex-col items-center rounded-xl px-2 py-2 text-xs ring-1 transition', pickedDay === d ? 'bg-brand-900 text-white ring-brand-900' : 'bg-white text-slate-700 ring-slate-200 hover:ring-brand-300')}>
                    <span className="font-medium">{format(parseISO(d), 'EEE')}</span>
                    <span className="text-lg font-semibold leading-tight">{format(parseISO(d), 'd')}</span>
                    <span className={pickedDay === d ? 'text-brand-200' : 'text-slate-400'}>{format(parseISO(d), 'MMM')}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="label">{t('Choose a time')}</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {slots.map((s) => (
                  <button key={s} type="button" onClick={() => setTime(s)} aria-pressed={time === s}
                    className={cn('rounded-lg px-2 py-2 text-sm font-medium tabular-nums ring-1 transition', time === s ? 'bg-brand-900 text-white ring-brand-900' : 'bg-white text-slate-700 ring-slate-200 hover:ring-brand-300')}>
                    {fmtTime(s)}
                  </button>
                ))}
              </div>
            </div>
          </>}
        </div>
      )}
    </Modal>
  )
}

export function RateVisitDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useT()
  return (
    <Modal open={!!id} onClose={onClose} size="max-w-lg" title={t('Rate your visit')}>
      {id && <FeedbackForm appointmentId={id} source="portal" onDone={() => setTimeout(onClose, 1800)} />}
    </Modal>
  )
}
