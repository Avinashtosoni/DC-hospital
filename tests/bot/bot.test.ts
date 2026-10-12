/** Conversation tests for the WhatsApp booking bot (supabase/functions/_shared/bot.ts) with in-memory deps. */
import { describe, expect, test } from 'vitest'
import { botReply, fmtWhen, type BotDeps, type BotState } from '../../supabase/functions/_shared/bot'

function fakeDeps(opts: { known?: string; failBook?: boolean } = {}) {
  const booked: { doctorId: string; date: string; time: string; name: string; reason: string | null }[] = []
  const appts = [{ id: 'a1', ref: 'DCB-AAA111', date: '2026-10-05', time: '10:00', doctor: 'Dr. Arjun Mehta', status: 'scheduled' }]
  const cancelled: string[] = []
  const deps: BotDeps = {
    hospital: { name: 'DC Hospital', phone: '+91 11 4000 2200', address: 'Sector 12, New Delhi' },
    doctors: async () => [
      { id: 'd1', name: 'Dr. Arjun Mehta', specialization: 'Cardiologist', department: 'Cardiology', fee: 1200 },
      { id: 'd2', name: 'Dr. Kavya Iyer', specialization: 'Paediatrician', department: 'Pediatrics', fee: 800 },
      { id: 'd3', name: 'Dr. Sameer Khan', specialization: 'Interventional Cardiologist', department: 'Cardiology', fee: 1500 },
    ],
    freeSlots: async () => [{ date: '2026-10-02', time: '09:30' }, { date: '2026-10-02', time: '17:00' }],
    patient: async () => (opts.known ? { full_name: opts.known } : null),
    book: async (i) => {
      if (opts.failBook) throw new Error('SLOT_TAKEN: Sorry — someone just booked this slot.')
      booked.push(i)
      return { ref: 'DCB-123ABC', date: i.date, time: i.time, doctor: 'Dr. Arjun Mehta', total: 1200, mrn: 'DCH-100200' }
    },
    upcoming: async () => appts.filter((a) => !cancelled.includes(a.id)),
    cancel: async (id) => { cancelled.push(id) },
  }
  return { deps, booked, cancelled }
}

async function chat(deps: BotDeps, msgs: string[], start: BotState | null = null) {
  let state = start
  let t = 1_000_000
  const all: string[][] = []
  for (const m of msgs) {
    const r = await botReply(state, m, deps, (t += 1000))
    state = r.state
    all.push(r.replies)
  }
  return { state: state!, all, last: all[all.length - 1].join('\n') }
}

describe('WhatsApp booking bot', () => {
  test('greets with the menu', async () => {
    const { deps } = fakeDeps({ known: 'Rohan Das' })
    const { last, state } = await chat(deps, ['hi'])
    expect(last).toMatch(/Namaste Rohan/)
    expect(last).toMatch(/1️⃣ Book an appointment/)
    expect(state.step).toBe('menu')
  })

  test('full booking: speciality → doctor → slot → name → reason → confirm', async () => {
    const { deps, booked } = fakeDeps()
    const r = await chat(deps, ['hi', '1', '1', '2', '1', 'Anita Sharma', 'chest pain', '1'])
    expect(r.all[1].join()).toMatch(/\*1\.\* Cardiology/)
    expect(r.all[2].join()).toMatch(/Dr\. Arjun Mehta — Cardiologist · ₹1,200/)
    expect(r.all[3].join()).toMatch(/Next free slots with \*Dr\. Sameer Khan\*/)
    expect(r.all[4].join()).toMatch(/patient’s full name/)
    expect(r.all[6].join()).toMatch(/Please confirm/)
    expect(r.last).toMatch(/Appointment confirmed/)
    expect(r.last).toMatch(/DCB-123ABC/)
    expect(booked).toEqual([{ doctorId: 'd3', date: '2026-10-02', time: '09:30', name: 'Anita Sharma', reason: 'chest pain' }])
    expect(r.state.step).toBe('menu')
  })

  test('known patient can confirm their name with 1 and skip the reason with 0', async () => {
    const { deps, booked } = fakeDeps({ known: 'Rohan Das' })
    const r = await chat(deps, ['hi', '1', '2', '1', '2', '1', '0', '1'])
    expect(booked[0]).toMatchObject({ doctorId: 'd2', time: '17:00', name: 'Rohan Das', reason: null })
    expect(r.last).toMatch(/confirmed/)
  })

  test('a taken slot offers fresh slots instead of failing the chat', async () => {
    const { deps } = fakeDeps({ failBook: true })
    const r = await chat(deps, ['hi', '1', '1', '1', '1', 'Anita Sharma', '0', '1'])
    expect(r.last).toMatch(/someone just booked/)
    expect(r.last).not.toMatch(/SLOT_TAKEN/)
    expect(r.state.step).toBe('slot')
  })

  test('list and cancel an appointment', async () => {
    const { deps, cancelled } = fakeDeps()
    const r = await chat(deps, ['hi', '2', '1', '1'])
    expect(r.all[1].join()).toMatch(/DCB-AAA111/)
    expect(r.all[2].join()).toMatch(/Cancel your appointment/)
    expect(r.last).toMatch(/Cancelled/)
    expect(cancelled).toEqual(['a1'])
  })

  test('Hindi mode', async () => {
    const { deps } = fakeDeps()
    const r = await chat(deps, ['hindi', '3'])
    expect(r.all[0].join()).toMatch(/नमस्ते/)
    expect(r.last).toMatch(/Sector 12/)
    expect(r.state.lang).toBe('hi')
    expect(fmtWhen({ date: '2026-10-02', time: '17:00' }, 'hi')).toBe('शुक्र, 2 Oct · 5:00 PM')
  })

  test('invalid input re-prompts; "menu" always restarts; stale sessions restart', async () => {
    const { deps } = fakeDeps()
    const r = await chat(deps, ['hi', '1', '42'])
    expect(r.last).toMatch(/didn’t get that/)
    expect(r.state.step).toBe('dept')
    const back = await botReply(r.state, 'menu', deps, 1_010_000)
    expect(back.state.step).toBe('menu')
    const stale = await botReply(r.state, '2', deps, 1_010_000 + 31 * 60_000)
    expect(stale.state.step).toBe('appts')   // menu number on a fresh chat is answered directly
  })

  test('errors from the backend give a friendly message', async () => {
    const { deps } = fakeDeps()
    deps.doctors = async () => { throw new Error('db down') }
    const r = await chat(deps, ['hi', '1'])
    expect(r.last).toMatch(/something went wrong/)
    expect(r.state.step).toBe('menu')
  })
})
