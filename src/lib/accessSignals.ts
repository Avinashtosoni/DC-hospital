import type { MyContext } from '../tenancy/state'

/** Low-cardinality labels for non-invasive, best-effort UI access signals. Never include record ids or data. */
export const CLINICAL_ACCESS_SCREENS = [
  'dashboard', 'patient_list', 'patient_chart', 'appointments', 'prescriptions', 'lab_tests', 'admissions', 'beds',
] as const
export type ClinicalAccessScreen = (typeof CLINICAL_ACCESS_SCREENS)[number]

const isPath = (path: string, root: string) => path === root || path.startsWith(`${root}/`)

/**
 * Classify only selected clinical/operational app routes. The returned label is safe to send to
 * monitoring; the URL itself (which may contain a patient id) must not be included in telemetry.
 * Accountants keep their existing clinical-table access; provider accounts keep their assigned access.
 */
export function classifyClinicalAccess(
  pathname: string,
  role: string | null | undefined,
  context: Pick<MyContext, 'provider_role'> | null | undefined,
): ClinicalAccessScreen | null {
  const isAccountant = role === 'accountant'
  const isProvider = !!context?.provider_role
  if (!isAccountant && !isProvider) return null

  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/'
  if (path === '/') return 'dashboard'
  if (path === '/patients') return 'patient_list'
  if (/^\/patients\/[^/]+$/.test(path)) return 'patient_chart'
  if (isPath(path, '/lab-tests')) return 'lab_tests'
  if (isPath(path, '/admissions')) return 'admissions'

  // Accountants are not shown these screens in the app; provider support/admin modes may use them.
  if (isProvider) {
    if (isPath(path, '/appointments')) return 'appointments'
    if (isPath(path, '/prescriptions')) return 'prescriptions'
    if (isPath(path, '/beds')) return 'beds'
  }
  return null
}
