import { describe, expect, it } from 'vitest'
import { classifyClinicalAccess } from '../src/lib/accessSignals'

const accountant = { provider_role: null }
const support = { provider_role: 'support' as const }
const platformAdminInSupportMode = { provider_role: 'admin' as const }

describe('clinical access route signals', () => {
  it('classifies selected accountant screens without returning route identifiers', () => {
    expect(classifyClinicalAccess('/patients', 'accountant', accountant)).toBe('patient_list')
    expect(classifyClinicalAccess('/patients/9b6c4a87-2450-477c-9fee-e4eadd8fef3d', 'accountant', accountant)).toBe('patient_chart')
    expect(classifyClinicalAccess('/lab-tests', 'accountant', accountant)).toBe('lab_tests')
    expect(classifyClinicalAccess('/admissions?status=current', 'accountant', accountant)).toBe('admissions')
    expect(classifyClinicalAccess('/reports', 'accountant', accountant)).toBeNull()
  })

  it('classifies provider screens, including support chart routes', () => {
    expect(classifyClinicalAccess('/patients/9b6c4a87-2450-477c-9fee-e4eadd8fef3d', 'owner', support)).toBe('patient_chart')
    expect(classifyClinicalAccess('/prescriptions/123', 'owner', support)).toBe('prescriptions')
    expect(classifyClinicalAccess('/appointments', 'owner', platformAdminInSupportMode)).toBe('appointments')
    expect(classifyClinicalAccess('/beds', 'owner', support)).toBe('beds')
  })

  it('does not classify ordinary staff or patient routes as internal-access signals', () => {
    expect(classifyClinicalAccess('/patients/123', 'doctor', null)).toBeNull()
    expect(classifyClinicalAccess('/lab-tests', 'staff', null)).toBeNull()
    expect(classifyClinicalAccess('/patients/123', 'patient', null)).toBeNull()
    expect(classifyClinicalAccess('/settings', 'accountant', accountant)).toBeNull()
  })
})
