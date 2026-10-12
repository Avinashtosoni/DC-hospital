import { describe, expect, it } from 'vitest'
import { setupSteps } from '../src/pages/dashboard/SetupChecklist'

describe('new hospital setup checklist', () => {
  const blank = { details: false, doctors: 0, team: 0, appointments: 0, plan: false, ticked: {} }
  it('a fresh hospital has everything to do, in order', () => {
    const s = setupSteps(blank)
    expect(s.map((x) => x.id)).toEqual(['details', 'doctors', 'team', 'appointment', 'website', 'domain', 'plan'])
    expect(s.every((x) => !x.done)).toBe(true)
    expect(s.find((x) => x.id === 'domain')?.to).toBe('/settings?tab=domain')
  })
  it('steps tick themselves from the data; only website / domain are ticked by hand', () => {
    const s = setupSteps({ details: true, doctors: 3, team: 1, appointments: 5, plan: true, ticked: { website: true, details: false } })
    expect(s.filter((x) => !x.done).map((x) => x.id)).toEqual(['domain'])
    expect(s.filter((x) => x.manual).map((x) => x.id)).toEqual(['website', 'domain'])
  })
})
