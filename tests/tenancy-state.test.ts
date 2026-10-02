import { afterEach, describe, expect, test } from 'vitest'
import {
  activeTenantId, chooseProviderMode, chooseProviderTenant, clearProviderChoice, contextProblem, enableTenancy,
  setSiteTenant, slugHint, tenantHeaders, type MyContext, type TenantInfo,
} from '../src/tenancy/state'

const A: TenantInfo = { id: 'a0000000-0000-4000-8000-000000000001', slug: 'main', name: 'DC Hospital', status: 'active' }
const B: TenantInfo = { id: 'b0000000-0000-4000-8000-000000000002', slug: 'city', name: 'City Hospital', status: 'active' }
const ctx = (over: Partial<MyContext>): MyContext => ({ tenant: A, role: 'owner', provider_role: null, provider_mode: null, ...over })

afterEach(() => { clearProviderChoice(); setSiteTenant(null); enableTenancy(false) })

describe('tenancy state (multi-hospital mode)', () => {
  test('no headers in single-hospital mode', () => {
    setSiteTenant(B)
    expect(tenantHeaders()).toEqual({})
  })

  test("the website's hospital goes into x-tenant-id; a provider's choice overrides it, plus the mode", () => {
    enableTenancy(true)
    setSiteTenant(A)
    expect(tenantHeaders()).toEqual({ 'x-tenant-id': A.id })
    chooseProviderTenant(B.id)
    chooseProviderMode('support')
    expect(activeTenantId()).toBe(B.id)
    expect(tenantHeaders()).toEqual({ 'x-tenant-id': B.id, 'x-provider-mode': 'support' })
    chooseProviderTenant('not-a-uuid')
    expect(activeTenantId()).toBe(A.id)
  })

  test('one account = one hospital: a hospital account only works on its own website', () => {
    expect(contextProblem(ctx({}), A)).toBeNull()
    expect(contextProblem(ctx({}), B)).toMatch(/belongs to DC Hospital/)
    expect(contextProblem(ctx({ tenant: null, role: null }), A)).toMatch(/not linked/)
    // providers can open any hospital they are allowed to (the database decides)
    expect(contextProblem(ctx({ tenant: B, provider_role: 'support', provider_mode: 'support' }), A)).toBeNull()
  })

  test('?hospital=slug is remembered for the tab and can be cleared', () => {
    expect(slugHint('?hospital=City')).toBe('city')
    expect(slugHint('')).toBe(null)   // no sessionStorage in node: nothing remembered
    expect(slugHint('?hospital=')).toBe(null)
  })
})

describe('module locks (what the app hides)', async () => {
  const { moduleLocked } = await import('../src/tenancy/modules')
  test('single installs / demo mode: nothing is locked; new hospitals: everything until switched over; providers: never', () => {
    expect(moduleLocked(null, 'cms')).toBe(false)
    expect(moduleLocked(ctx({ tenant: { ...B, modules: {} } }), 'cms')).toBe(true)
    expect(moduleLocked(ctx({ tenant: { ...B, modules: { cms: 'hospital' } } }), 'cms')).toBe(false)
    expect(moduleLocked(ctx({ tenant: { ...B, modules: { cms: 'provider' } } }), 'cms')).toBe(true)
    expect(moduleLocked(ctx({ tenant: { ...B, modules: {} }, provider_role: 'support', provider_mode: 'support' }), 'cms')).toBe(false)
  })
})
