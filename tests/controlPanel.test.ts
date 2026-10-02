/** Control panel demo mode (control-panel/src/demo.ts): same rules as scripts/sql/control_panel.sql. */
import { beforeEach, describe, expect, test } from 'vitest'

const CITY = 'b0000000-0000-4000-8000-000000000002'
let cp: typeof import('../control-panel/src/demo').demoCp

beforeEach(async () => {
  const m = new Map<string, string>()
  globalThis.localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(), key: () => null, length: 0 } as Storage
  cp = (await import('../control-panel/src/demo')).demoCp
})
const as = (who: 'admin' | 'support' | 'finance') => cp.signIn(`${who}@hospitalcomrade.demo`, 'Demo@123')
const newHospital = { slug: 'sunrise', name: 'Sunrise Hospital', code: 'SRH', plan: 'hospital', owner_email: 'o@sunrise.in', domain: '', status: 'trial' as const, trial_days: 10, months: 12, modules: { forms: 'hospital' as const }, notes: '' }

describe('control panel (demo)', () => {
  test('sign-in: team accounts only; signed-out calls fail', async () => {
    await expect(cp.signIn('owner@dchospital.com', 'Demo@123')).rejects.toThrow(/Wrong/)
    await expect(cp.hospitals()).rejects.toThrow(/sign in again/)
    expect(await as('admin')).toMatchObject({ role: 'admin', full_name: 'Aman Sinha' })
    await cp.signOut()
    expect(await cp.me()).toBeNull()
  })

  test('support sees assigned hospitals only and cannot bill or create', async () => {
    await as('support')
    expect((await cp.hospitals()).map((h) => h.slug)).toEqual(['citycare'])
    await expect(cp.billing(CITY, 'extend_trial', { days: 3 })).rejects.toThrow(/admin \/ finance/)
    await expect(cp.createHospital(newHospital)).rejects.toThrow(/\(admin\)/)
    expect((await cp.hospital(CITY)).payments).toEqual([])
  })

  test('admin creates a hospital (validated) and records a payment; finance cannot suspend', async () => {
    await as('admin')
    await expect(cp.createHospital({ ...newHospital, slug: 'citycare' })).rejects.toThrow(/taken/)
    await expect(cp.createHospital({ ...newHospital, owner_email: 'admin@hospitalcomrade.demo' })).rejects.toThrow(/one account = one hospital/)
    const r = await cp.createHospital(newHospital)
    const h = await cp.hospital(r.id)
    expect(h).toMatchObject({ name: 'Sunrise Hospital', price: 2999, owner_joined: false })
    expect(h.license.status).toBe('trial')
    const pay = await cp.billing(r.id, 'manual_payment', { kind: 'plan', months: 1, method: 'upi' }) as { invoice_no: string }
    expect(pay.invoice_no).toMatch(/^HC\/2026-27\/\d{6}$/)
    expect((await cp.hospital(r.id)).license.status).toBe('active')
    expect((await cp.audit(r.id)).map((a) => a.action)).toEqual(['billing:manual_payment', 'hospital:create'])
    await as('finance')
    await expect(cp.billing(CITY, 'suspend', {})).rejects.toThrow(/admin/)
    await cp.billing(CITY, 'wallet_adjust', { amount: 100, note: 'Goodwill' })
    expect((await cp.hospital(CITY)).wallet_paise).toBe(23720 + 10000)
  })

  test('module locks for a demo hospital go to the store the demo app reads', async () => {
    await as('admin')
    await cp.updateHospital(CITY, { modules: { cms: 'hospital' } })
    expect(JSON.parse(localStorage.getItem('dch:cp:tenant-edits:v1')!)[CITY].modules).toEqual({ cms: 'hospital' })
    await expect(cp.updateHospital(CITY, { modules: { billing: 'hospital' } as never })).rejects.toThrow(/Unknown module/)
  })

  test('team: unknown e-mails refused, cannot demote yourself', async () => {
    await as('admin')
    await expect(cp.saveMember({ email: 'x@gmail.com', role: 'support', active: true, hospitals: [] })).rejects.toThrow(/No account/)
    await expect(cp.saveMember({ email: 'admin@hospitalcomrade.demo', role: 'support', active: true, hospitals: [] })).rejects.toThrow(/own admin access/)
    await cp.saveMember({ email: 'neha@hospitalcomrade.demo', role: 'support', active: true, hospitals: [CITY] })
    expect((await cp.team()).find((m) => m.email === 'neha@hospitalcomrade.demo')?.hospitals).toEqual([{ id: CITY, name: 'City Care Clinic' }])
  })
})

describe('control panel phase 7 (demo)', () => {
  test('close → read-only with the closing banner in the hospital app; reopen; purge only after the notice, with password + short name', async () => {
    await as('support')
    await expect(cp.closeHospital(CITY, 'Leaving', 30)).rejects.toThrow(/\(admin\)/)
    await as('admin')
    await expect(cp.closeHospital(CITY, 'x', 30)).rejects.toThrow(/reason/)
    await expect(cp.closeHospital(CITY, 'Leaving', 3)).rejects.toThrow(/7 to 90/)
    await cp.closeHospital(CITY, 'Owner asked to close', 30)
    const h = await cp.hospital(CITY)
    expect(h.license.status).toBe('read_only')
    expect(h.closing_at).toBeTruthy()
    const { demoLicense } = await import('../src/billing/demo')
    expect(demoLicense(CITY, true)?.closing_at).toBe(h.closing_at)         // the hospital app sees it too
    await cp.reopenHospital(CITY)
    expect((await cp.hospital(CITY)).license.status).toBe('trial')

    const r = await cp.createHospital(newHospital)
    await expect(cp.purgeHospital(r.id, 'sunrise', 'Demo@123')).rejects.toThrow(/Close the hospital first/)
    await cp.closeHospital(r.id, 'Never started', 7)
    await expect(cp.purgeHospital(r.id, 'sunrise', 'Demo@123')).rejects.toThrow(/can export its data until/)
    await cp.demoEndNotice!(r.id)
    await expect(cp.purgeHospital(r.id, 'sunrise', 'wrong')).rejects.toThrow(/Wrong password/)
    await expect(cp.purgeHospital(r.id, 'sun', 'Demo@123')).rejects.toThrow(/short name/)
    expect((await cp.purgeHospital(r.id, 'sunrise', 'Demo@123')).purged).toBe('sunrise')
    expect((await cp.hospitals()).some((x) => x.id === r.id)).toBe(false)
    expect((await cp.audit()).map((a) => a.action)).toEqual(expect.arrayContaining(['hospital:close', 'hospital:reopen', 'hospital:purge']))
  }, 20_000)

  test('incidents: admin records, updates, notifies; support reads only; health counts open ones', async () => {
    await as('admin')
    const i = await cp.saveIncident({ title: 'Export e-mailed to the wrong address', severity: 'high', personal_data: true, affected_tenants: [CITY], affected_people: 12 })
    expect(Date.parse(i.deadline) - Date.parse(i.detected_at)).toBe(72 * 3600_000)
    await expect(cp.notifyIncident(i.id, ' ')).rejects.toThrow(/Write the notice/)
    expect(await cp.notifyIncident(i.id, 'We are sorry…')).toEqual([expect.objectContaining({ id: CITY, queued: 1 })])
    await cp.saveIncident({ id: i.id, status: 'contained', note: 'Recipient deleted the file', board_reported: true })
    await as('support')
    const [got] = await cp.incidents()
    expect(got).toMatchObject({ status: 'contained', hospitals: [{ id: CITY }] })
    expect(got.board_reported_at).toBeTruthy()
    expect(got.timeline.map((t) => t.note)).toEqual(['Incident recorded', 'Hospitals notified (1)', 'Status: contained — Recipient deleted the file'])
    await expect(cp.saveIncident({ title: 'nope' })).rejects.toThrow(/\(admin\)/)
    const health = await cp.health()
    expect(health.incidents_open).toBe(1)
    expect(health.hospitals.map((x) => x.id)).toEqual([CITY])           // support: assigned hospitals only
    expect(health.database.largest_tables).toEqual([])
  })

  test('retention: minimums enforced, run records the last run', async () => {
    await as('admin')
    await expect(cp.saveRetention({ auditDays: 100 })).rejects.toThrow(/at least 365/)
    expect((await cp.saveRetention({ outboxDays: 200 })).outboxDays).toBe(200)
    await cp.runRetention()
    expect((await cp.retention()).last_run?.at).toBeTruthy()
    await as('finance')
    await expect(cp.retention()).rejects.toThrow(/\(admin\)/)
  })
})

describe('control panel phase 8.2 sign-ups (demo)', () => {
  test('a request from the product page shows up; approve creates the hospital, reject records the note', async () => {
    localStorage.setItem('dch:platform-signups:v1', JSON.stringify([{ organisation: 'Ganga Eye Care', name: 'Dr. Asha', email: 'Asha@GangaEye.in', phone: '+91 98111 22233', city: 'Bhagalpur', plan: 'clinic', terms_version: '2026-10-02', created_at: new Date().toISOString() }]))
    await as('support')
    await expect(cp.signups()).rejects.toThrow(/\(admin\)/)
    await as('admin')
    const list = await cp.signups()
    const mine = list.find((s) => s.organisation === 'Ganga Eye Care')!
    expect(mine).toMatchObject({ email: 'asha@gangaeye.in', phone: '9811122233', slug: 'gangaeyecare', code: 'GEC', status: 'pending' })
    expect(list[0].status).toBe('pending')
    expect((await cp.signupSettings()).pending).toBe(3)
    const done = await cp.decideSignup(mine.id, 'approve')
    expect(done).toMatchObject({ status: 'created', owner_joined: false, decided_by_name: 'Aman Sinha' })
    const h = await cp.hospital(done.hospital_id!)
    expect(h).toMatchObject({ slug: 'gangaeyecare', owner_email: 'asha@gangaeye.in' })
    expect(h.license.status).toBe('trial')
    await expect(cp.decideSignup(mine.id, 'reject')).rejects.toThrow(/already handled/)
    expect(await cp.decideSignup('demo-signup-2', 'reject', 'Duplicate')).toMatchObject({ status: 'rejected', reason: 'Duplicate' })
    expect((await cp.signupSettings()).pending).toBe(1)
  }, 20_000)

  test('settings are validated and saved', async () => {
    await as('admin')
    await expect(cp.saveSignupSettings({ trialDays: 0 })).rejects.toThrow(/1 to 90/)
    await expect(cp.saveSignupSettings({ platformUrl: 'http://x' })).rejects.toThrow(/https/)
    expect(await cp.saveSignupSettings({ mode: 'instant', trialDays: 30, enabled: false })).toMatchObject({ mode: 'instant', trialDays: 30, enabled: false })
  }, 20_000)
})

describe('control panel phase 8.3 launch checklist (demo)', () => {
  test('admin only; the demo is honestly not ready', async () => {
    await as('support')
    await expect(cp.launchCheck()).rejects.toThrow(/\(admin\)/)
    await as('admin')
    const r = await cp.launchCheck()
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c.status]))
    expect(by).toMatchObject({ demo_logins: 'fail', seller: 'fail', rls: 'ok', isolation: 'ok' })
    expect(r.checks).toHaveLength(12)
  }, 20_000)
})
