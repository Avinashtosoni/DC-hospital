/**
 * Demo mode (no database): two hospitals and three Hospital Comrade provider logins live in the browser, so the
 * multi-hospital experience can be tried on the public demo. Each hospital has its OWN browser store
 * (`dch:db:v3` for DC Hospital, `dch:db:v3@citycare` for City Care Clinic) — they never share a row.
 *
 *   ?hospital=citycare   opens City Care Clinic's website (the domain picks it in a real install)
 *   ?hospital=main       back to DC Hospital
 */
import type { Profile, Role } from '../types'
import { activeTenantId, type ProviderRole, type TenantInfo } from './state'

export const PRIMARY_TENANT_ID = 'a0000000-0000-4000-8000-000000000001'
export const CITY_TENANT_ID = 'b0000000-0000-4000-8000-000000000002'

const MODULES = ['general', 'appearance', 'dashboard', 'notifications', 'forms', 'security', 'data', 'cms'] as const
const allHospital = Object.fromEntries(MODULES.map((m) => [m, 'hospital'])) as Record<string, 'hospital'>

export interface DemoTenant extends TenantInfo { code: string; domain: string; email: string }

export const DEMO_TENANTS: DemoTenant[] = [
  { id: PRIMARY_TENANT_ID, slug: 'main', name: 'DC Hospital', status: 'active', plan: 'enterprise', modules: allHospital, is_primary: true,
    code: 'DCH', domain: 'dchospital.com', email: 'dchospital.com' },
  // a newer clinic on the Clinic plan: the platform still manages its brand, website, messaging…; the owner runs the dashboard and forms
  { id: CITY_TENANT_ID, slug: 'citycare', name: 'City Care Clinic', status: 'trial', plan: 'clinic', modules: { dashboard: 'hospital', forms: 'hospital' }, is_primary: false,
    code: 'CCC', domain: 'citycareclinic.in', email: 'citycare.demo' },
]

export const demoTenantBySlug = (slug: string | null | undefined) => DEMO_TENANTS.find((t) => t.slug === slug)
export const demoTenantById = (id: string | null | undefined) => DEMO_TENANTS.find((t) => t.id === id)
/** the hospital whose store this tab uses: the provider's choice, else the website's hospital */
export const activeDemoTenant = (): DemoTenant => demoTenantById(activeTenantId()) ?? DEMO_TENANTS[0]

/** per-hospital browser-storage key (DC Hospital keeps the original keys, so existing demo data survives) */
export function demoKey(base: string): string {
  const t = activeDemoTenant()
  return t.is_primary ? base : `${base}@${t.slug}`
}

// ------------------------------------------------------------------ provider (Hospital Comrade team) demo logins
export interface DemoProvider { id: string; email: string; full_name: string; role: ProviderRole; phone: string; tenants: string[] | null }
export const DEMO_PROVIDERS: DemoProvider[] = [
  { id: 'e0e00000-0000-4000-8000-000000000001', email: 'admin@hospitalcomrade.demo', full_name: 'Aman Sinha', role: 'admin', phone: '+91 98100 20001', tenants: null },
  { id: 'e0e00000-0000-4000-8000-000000000002', email: 'support@hospitalcomrade.demo', full_name: 'Kavya Rao', role: 'support', phone: '+91 98100 20002', tenants: [CITY_TENANT_ID] },
  { id: 'e0e00000-0000-4000-8000-000000000003', email: 'finance@hospitalcomrade.demo', full_name: 'Farhan Ali', role: 'finance', phone: '+91 98100 20003', tenants: [PRIMARY_TENANT_ID, CITY_TENANT_ID] },
]
export const providerCan = (p: DemoProvider, tenantId: string) => p.tenants === null || p.tenants.includes(tenantId)
export const providerTenants = (p: DemoProvider) => DEMO_TENANTS.filter((t) => providerCan(p, t.id))
/** what a provider acts as inside a hospital */
export const providerAppRole = (mode: ProviderRole): Role => (mode === 'finance' ? 'accountant' : 'owner')
export const providerProfile = (p: DemoProvider, mode: ProviderRole): Profile => ({
  id: p.id, full_name: p.full_name, email: p.email, phone: p.phone, role: providerAppRole(mode), avatar_url: null,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
})

// ------------------------------------------------------------------ City Care Clinic's people (same roles as DC Hospital's demo logins)
const FIRST = ['Aarav', 'Ishita', 'Kunal', 'Sneha', 'Vivek', 'Pooja', 'Manish', 'Ritu', 'Saurabh', 'Anjali', 'Nikhil', 'Divya', 'Rakesh', 'Swati',
  'Abhishek', 'Komal', 'Gaurav', 'Nisha', 'Pankaj', 'Shalini', 'Amit', 'Preeti', 'Rajeev', 'Megha', 'Sandeep', 'Kiran', 'Tarun', 'Bhavna']
const LAST = ['Sinha', 'Jha', 'Mishra', 'Pandey', 'Thakur', 'Choudhary', 'Prasad', 'Ranjan', 'Kumari', 'Singh', 'Tiwari', 'Srivastava', 'Dubey', 'Yadav']

/** deterministic replacement names (Bihar flavour) so City Care's people never look like DC Hospital's */
export function cityName(i: number): string {
  // every (first, last) pair exactly once for i < 28 × 14 = 392
  return `${FIRST[i % FIRST.length]} ${LAST[(Math.floor(i / FIRST.length) + 3 * i) % LAST.length]}`
}

/** website basics for City Care Clinic's CMS (everything else falls back to the built-in sample content) */
export const CITY_SITE_SETTINGS = {
  name: 'City Care Clinic', tagline: 'Family clinic · Patna',
  about: 'A neighbourhood multi-speciality clinic in Patna — consultations, diagnostics and day care for the whole family.',
  address: 'Boring Road, Patna, Bihar 800001', phone: '+91 612 400 1100', appointmentsPhone: '+91 612 400 1101',
  whatsapp: '+91 98100 50001', email: 'hello@citycareclinic.in',
  seoDescription: 'City Care Clinic, Patna — book a consultation online in 30 seconds.',
  brand: { shortName: 'City Care', appSubtitle: 'Clinic Management', logoUrl: '', faviconUrl: '', showName: true },
  // its own invoice letterhead (sample values)
  billing: { legalName: 'City Care Clinic LLP', gstin: '10AAKFC4321M1Z2', regNo: 'BR/CE/2022/001187', pan: 'AAKFC4321M', upiId: 'citycareclinic@sbi' },
}
