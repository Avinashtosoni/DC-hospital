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
