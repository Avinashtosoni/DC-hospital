import { describe, expect, test } from 'vitest'
import { buildCitySeed, CITY_USERS } from '../src/data/citySeed'
import { buildSeed, DEMO_USERS } from '../src/data/seed'

const dates = { date: (o: number) => `d${o}`, ts: (o: number) => `t${o}` }

describe('second demo hospital (City Care Clinic)', () => {
  test('same volume, but no person, id or e-mail of DC Hospital', () => {
    const t0 = Date.now()
    const city = buildCitySeed(dates)
    expect(Date.now() - t0).toBeLessThan(1500)
    const dc = buildSeed(dates)
    expect(city.patients).toHaveLength(dc.patients.length)
    const json = JSON.stringify(city)
    const dcNames = new Set([...dc.patients.map((p) => p.full_name), ...dc.doctors.map((d) => d.full_name.replace(/^Dr\.?\s+/, ''))])
    const cityNames = new Set([...city.patients.map((p) => p.full_name), ...city.doctors.map((d) => d.full_name.replace(/^Dr\.?\s+/, ''))])
    expect([...cityNames].filter((n) => dcNames.has(n))).toEqual([])
    expect(json).not.toMatch(/dchospital\.com|"d0c|DCH-|DC Hospital/)
    expect(city.patients.every((p) => p.mrn.startsWith('CCC-'))).toBe(true)
    // the one-click logins exist with the right roles
    for (const u of CITY_USERS) expect(city.profiles.find((p) => p.id === u.id)).toMatchObject({ email: u.email, role: u.role, full_name: u.full_name })
    expect(CITY_USERS.map((u) => u.role)).toEqual(DEMO_USERS.map((u) => u.role))
  })
})
