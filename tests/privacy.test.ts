/**
 * Phase 7 in the browser: the demo twins of the privacy RPCs (src/privacy/demo.ts), the closing state of the
 * licence (computeLicense / licenseBanner) and the full hospital export ZIP (src/privacy/exportZip.ts).
 */
import { beforeEach, describe, expect, test } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { computeLicense, licenseBanner } from '../src/billing/license'
import { toCsv } from '../src/lib/utils'

const PATIENT = 'd0c00000-0000-4000-8000-000000000006'

function stubStorage() {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    const m = new Map<string, string>()
    ;(globalThis as Record<string, unknown>)[name] = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size } } as Storage
  }
}

describe('licence: a closing account', () => {
  const NOW = Date.parse('2026-10-02T06:00:00Z')
  const d = (days: number) => new Date(NOW + days * 864e5).toISOString()
  test('is read-only from the closing date even with a paid plan; suspension still wins', () => {
    const l = computeLicense({ status: 'active', trial_ends_at: null, paid_until: d(200), closing_at: d(-1), purge_after: d(29) }, 7, NOW)
    expect(l).toMatchObject({ status: 'read_only', read_only_from: d(-1), purge_after: d(29) })
    expect(computeLicense({ status: 'suspended', trial_ends_at: null, paid_until: d(200), closing_at: d(-1), purge_after: d(29) }, 7, NOW).status).toBe('suspended')
    expect(computeLicense({ status: 'active', trial_ends_at: null, paid_until: d(200) }, 7, NOW).status).toBe('active')
  })
  test('the banner counts the days to deletion and points the owner at the export', () => {
    const l = computeLicense({ status: 'active', trial_ends_at: null, paid_until: d(200), closing_at: d(-1), purge_after: d(29) }, 7, NOW)
    const owner = licenseBanner(l, true, NOW)!
    expect(owner).toMatchObject({ tone: 'danger', title: 'This account is closing', cta: false })
    expect(owner.text).toMatch(/Settings → Data & backup.*\(29 days left\).*deleted permanently/)
    expect(licenseBanner(l, false, NOW)!.text).toMatch(/Ask the owner/)
  })
})

describe('toCsv', () => {
  test('header from every row; JSON cells; formulas defused', () => {
    expect(toCsv([{ a: 1 }, { b: '=SUM(A1)', c: { x: 1 } }])).toBe('a,b,c\r\n1,,\r\n,\'=SUM(A1),"{""x"":1}"')
  })
})

describe('privacy (demo mode)', () => {
  let auth: typeof import('../src/data/localAdapter').localAuth
  let privacy: typeof import('../src/privacy/api').privacyApi
  let local: typeof import('../src/data/localAdapter')
  beforeEach(async () => {
    stubStorage()
    local = await import('../src/data/localAdapter')
    auth = local.localAuth
    privacy = (await import('../src/privacy/api')).privacyApi
    await local.localAdapter.reset?.()
  })

  test('patient: download, consent, requests (one open per kind); owner: reject needs a note, erasure anonymises', async () => {
    await auth.signIn('patient@dchospital.com', 'Demo@123')
    const e = await privacy.exportMine(PATIENT) as Record<string, any>
    expect(e.patient.full_name).toBe('Rohan Das')
    expect(e.appointments.length).toBeGreaterThan(0)
    expect(e.appointments.every((a: { patient_id: string }) => a.patient_id === e.patient.id)).toBe(true)
    expect((await privacy.mine(PATIENT)).requests.map((r) => [r.kind, r.status])).toEqual([['access', 'done']])

    expect((await privacy.mine(PATIENT)).marketing).toBe(true)
    await privacy.setMarketing(PATIENT, false)
    expect((await privacy.mine(PATIENT)).marketing).toBe(false)
    const tmpl = { schedule: 'once', audience: 'patients', roles: [] } as never
    expect(local.localTemplateRecipients(tmpl).some((r) => r.full_name === 'Rohan Das')).toBe(false)

    await expect(privacy.submit(PATIENT, 'correction', 'x')).rejects.toThrow(/what is wrong/)
    await privacy.submit(PATIENT, 'correction', 'My blood group is B+')
    await privacy.submit(PATIENT, 'erasure', '')
    await expect(privacy.submit(PATIENT, 'erasure', '')).rejects.toThrow(/already have an open erasure/)

    await auth.signOut()
    await auth.signIn('owner@dchospital.com', 'Demo@123')
    const open = await privacy.list('open')
    expect(open.map((r) => r.kind).sort()).toEqual(['correction', 'erasure'])
    const corr = open.find((r) => r.kind === 'correction')!, er = open.find((r) => r.kind === 'erasure')!
    await expect(privacy.resolve(corr.id, 'rejected', '', 'Avinash')).rejects.toThrow(/Say why/)
    await privacy.resolve(corr.id, 'done', 'Fixed', 'Avinash')
    await expect(privacy.resolve(corr.id, 'done', '', 'Avinash')).rejects.toThrow(/already answered/)

    const before = local.localSnapshot().patients.find((p) => p.profile_id === PATIENT)!
    await privacy.resolve(er.id, 'done', 'As asked', 'Avinash')
    const s = local.localSnapshot()
    const p = s.patients.find((x) => x.id === before.id)! as unknown as Record<string, unknown>
    expect(p).toMatchObject({ full_name: `Erased patient ${before.mrn}`, phone: null, email: null, profile_id: null })
    expect(p.erased_at).toBeTruthy()
    expect(s.profiles.some((x) => x.id === PATIENT)).toBe(false)
    expect(s.appointments.some((a) => a.patient_id === before.id)).toBe(true)          // the medical record stays
    expect(JSON.stringify(s.audit_log.filter((a) => a.record_id === before.id))).not.toContain('Rohan')
    expect((await privacy.list('all')).filter((r) => r.status === 'open')).toHaveLength(0)
  }, 30_000)

  test('owner export: one CSV per table + manifest + README, without invite tokens', async () => {
    await auth.signIn('owner@dchospital.com', 'Demo@123')
    const { exportHospitalZip } = await import('../src/privacy/exportZip')
    const seen: string[] = []
    const r = await exportHospitalZip('DC Hospital', (_d, _t, table) => { if (table) seen.push(table) })
    expect(r.filename).toMatch(/^dc-hospital-data-\d{4}-\d{2}-\d{2}\.zip$/)
    expect(r.skipped).toEqual({})
    expect(r.counts.patients).toBeGreaterThan(5)
    const files = unzipSync(new Uint8Array(await r.blob.arrayBuffer()))
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['patients.csv', 'invoices.csv', 'audit_log.csv', 'manifest.json', 'README.txt']))
    expect(JSON.parse(strFromU8(files['manifest.json'])).counts.patients).toBe(r.counts.patients)
    const patients = strFromU8(files['patients.csv'])
    expect([...files['patients.csv'].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])       // BOM: Excel reads ₹ and Hindi as UTF-8
    expect(patients.split('\r\n')[0]).toContain('full_name')
    expect(patients).toContain('Rohan Das')
    expect(strFromU8(files['staff_invites.csv']).split('\r\n')[0]).not.toMatch(/(^|,)token(,|$)/)
    expect(seen.length).toBe(Object.keys(r.counts).length)
  }, 60_000)
})
