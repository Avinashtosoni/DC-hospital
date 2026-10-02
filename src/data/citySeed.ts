/**
 * Demo data for the second demo hospital (City Care Clinic). Same shape and volume as DC Hospital's demo data
 * (so every screen has something to show) but with its own people, ids, MRN prefix and e-mail domain — so it's
 * obvious that nothing is shared between the two hospitals.
 */
import { buildSeed, DEMO_USERS, type DateHelper } from './seed'
import { cityName } from '../tenancy/demo'

const strip = (n: string) => n.replace(/^Dr\.?\s+/, '')

/** City Care Clinic's one-click logins (same roles as DC Hospital's) */
export { CITY_USERS } from './demoUsers'
import { CITY_USERS } from './demoUsers'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function buildCitySeed(raw: DateHelper) {
  const seed = buildSeed(raw)

  // every person's name → a City Care name (demo logins first, so they match CITY_USERS)
  const map = new Map<string, string>()
  DEMO_USERS.forEach((u, i) => map.set(strip(u.full_name), strip(CITY_USERS[i].full_name)))
  const used = new Set(map.values())
  let n = 0
  const add = (name: string | null | undefined) => {
    const base = strip(name ?? '').trim()
    if (!base || map.has(base) || !base.includes(' ')) return
    let next = cityName(n++)
    while (used.has(next) && n < 400) next = cityName(n++)
    used.add(next); map.set(base, next)
  }
  for (const r of seed.doctors) add(r.full_name)
  for (const r of seed.staff) add(r.full_name)
  for (const r of seed.patients) add(r.full_name)
  for (const r of seed.site_enquiries) add(r.name)

  // one pass for names and one for e-mail style "first.last" (longest first, so "Rohan Das" can't eat "Rohan Dasgupta")
  const dotted = (v: string) => v.toLowerCase().replace(/\s+/g, '.')
  const dots = new Map([...map].map(([f, t]) => [dotted(f), dotted(t)]))
  const alt = (keys: Iterable<string>) => [...keys].sort((x, y) => y.length - x.length).map(escape).join('|')
  let json = JSON.stringify(seed)
    .replace(new RegExp(`\\b(${alt(map.keys())})\\b`, 'g'), (m) => map.get(m) ?? m)
    .replace(new RegExp(`\\b(${alt(dots.keys())})`, 'g'), (m) => dots.get(m) ?? m)
  json = json
    .replace(/"d0c/g, '"c1c')                         // ids (stores are separate anyway; keeps logins unambiguous)
    .replace(/@dchospital\.com/g, '@citycare.demo')
    .replace(/DCH-/g, 'CCC-')
    .replace(/DC Hospital/g, 'City Care Clinic')
    .replace(/\+91 98100 1000(\d)/g, '+91 98100 5001$1')
  const city = JSON.parse(json) as typeof seed
  // the logins read exactly as on the login page (e.g. the owner is a doctor here: "Dr. Ritu Ranjan")
  for (const u of CITY_USERS) { const p = city.profiles.find((r) => r.id === u.id); if (p) p.full_name = u.full_name }
  return city
}
