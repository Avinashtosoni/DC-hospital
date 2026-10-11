import { afterEach, describe, expect, it, vi } from 'vitest'
import { bookingWindow, istDateString, slotsFor, type PublicDoctor } from '../src/booking/api'
import { whenLabel } from '../src/booking/useBooking'

const originalTimezone = process.env.TZ
const cfg = { booking: { advanceDays: 30, minNoticeMinutes: 60 }, billing: {} } as never

afterEach(() => {
  vi.useRealTimers()
  if (originalTimezone === undefined) delete process.env.TZ
  else process.env.TZ = originalTimezone
})

describe('public booking uses the hospital timezone', () => {
  it('builds the booking window and applies notice time using Asia/Kolkata, not the device timezone', () => {
    process.env.TZ = 'Pacific/Honolulu'
    const now = new Date('2026-10-10T02:50:00.000Z') // 08:20 on Saturday in India; still Friday in Honolulu

    expect(istDateString(now)).toBe('2026-10-10')
    expect(bookingWindow(cfg, now)[0]).toBe('2026-10-10')

    const doctor = {
      id: 'doctor-1', full_name: 'Dr Test', specialization: 'General', department: null,
      consultation_fee: 500, available_days: ['Sat'], shift: '09:00-12:00', status: 'active',
    } as PublicDoctor
    const available = { booked: [], leaves: [], holidays: [] }
    const slots = slotsFor(doctor, '2026-10-10', available, cfg, now)

    expect(slots).not.toContain('09:00') // below the 09:20 India-local notice cutoff
    expect(slots).toContain('09:30')
  })

  it('labels Today and Tomorrow against the hospital date', () => {
    process.env.TZ = 'Pacific/Honolulu'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T19:00:00.000Z')) // 00:30 on Saturday in India

    expect(whenLabel('2026-10-10', '09:30')).toBe('Today, 9:30 AM')
    expect(whenLabel('2026-10-11', '14:00')).toBe('Tomorrow, 2:00 PM')
  })
})
