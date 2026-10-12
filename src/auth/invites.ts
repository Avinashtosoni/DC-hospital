import { supabase } from '../lib/supabase'
import type { InviteInfo } from '../data/adapter'

/** Who a /register?invite=… link is for (works signed-out). */
export async function lookupInvite(token: string): Promise<InviteInfo> {
  const { data, error } = await supabase!.rpc('invite_lookup', { p_token: token })
  if (error) return { ok: false, error: error.message }
  return data as InviteInfo
}
