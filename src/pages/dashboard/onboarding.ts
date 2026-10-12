import { supabase } from '../../lib/supabase'

export const ONBOARDING_QK = ['tenant-onboarding'] as const
export interface OnboardingProgress {
  current_step: string
  completed_steps: string[]
  followup_consent: boolean
  consent_updated_at: string | null
  reminder_count: number
  last_activity_at: string
  next_followup_at: string | null
  completed_at: string | null
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('The service is not connected.')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const loadOnboardingProgress = () => rpc<OnboardingProgress>('my_onboarding')
export const saveOnboardingProgress = (completed: string[], followupConsent?: boolean) => rpc<OnboardingProgress>('save_onboarding_progress', {
  p: { completed_steps: completed, ...(followupConsent === undefined ? {} : { followup_consent: followupConsent }) },
})
export const requestOnboardingHelp = (message: string) => rpc<{ id: string; status: 'open' }>('request_onboarding_help', { p_message: message })
