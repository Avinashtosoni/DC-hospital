// The public demo hospital (scripts/sql/demo.sql): what its site shows — one-click sign-ins, the nightly reset.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { siteTenant } from '../tenancy/state'

export interface DemoLogin { role: string; email: string; name: string }
export interface DemoInfo {
  demo: true
  otp: 'screen' | 'real'
  nightly: boolean
  resets_at: string
  last_reset_at?: string | null
  logins: DemoLogin[]
  password?: string | null
}

/** is this website the demo hospital? (resolve_tenant → is_demo) */
export const isDemoSite = () => !!siteTenant()?.is_demo

export function useDemoInfo() {
  return useQuery({
    queryKey: ['demo-info'],
    enabled: isDemoSite() && !!supabase,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase!.rpc('public_demo_info')
      return error ? null : (data as DemoInfo | null)
    },
  })
}

export const DEMO_ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', doctor: 'Doctor', receptionist: 'Receptionist', accountant: 'Accountant', staff: 'Staff', patient: 'Patient',
}
