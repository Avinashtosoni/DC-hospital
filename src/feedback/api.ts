import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { localFeedbackContext, localSubmitFeedback } from '../data/localAdapter'

export type FeedbackContext =
  | { ok: true; first_name: string; doctor: string; specialization: string; date: string; submitted: boolean }
  | { ok: false; error: string }
export interface FeedbackInput { rating: number; comment?: string | null; tags?: string[]; would_recommend?: boolean | null }

/** What patients can praise or flag (stored as keys, shown translated). */
export const FEEDBACK_TAGS = [
  ['doctor', 'Doctor'], ['explanation', 'Clear explanation'], ['staff', 'Helpful staff'], ['waiting_time', 'Waiting time'],
  ['cleanliness', 'Cleanliness'], ['billing', 'Billing'], ['pharmacy', 'Pharmacy'],
] as const
export const TAG_LABEL: Record<string, string> = Object.fromEntries(FEEDBACK_TAGS)

export const feedbackApi = {
  async context(apptId: string): Promise<FeedbackContext> {
    if (!isSupabaseConfigured) return localFeedbackContext(apptId)
    const { data, error } = await supabase!.rpc('feedback_context', { p_appt: apptId })
    if (error) return { ok: false, error: /uuid/i.test(error.message) ? 'This feedback link is not valid.' : error.message }
    return data as FeedbackContext
  },
  async submit(apptId: string, input: FeedbackInput, source: 'portal' | 'link' = 'link') {
    if (!isSupabaseConfigured) return localSubmitFeedback(apptId, input, source)
    const { error } = await supabase!.rpc('submit_feedback', {
      p_appt: apptId, p_rating: input.rating, p_comment: input.comment ?? null, p_tags: input.tags ?? [], p_recommend: input.would_recommend ?? null,
    })
    if (error) throw new Error(error.message)
  },
}
