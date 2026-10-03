/**
 * Browser side of the WhatsApp chatbot simulator: asks the deployed `whatsapp-bot` Edge Function to simulate a chat.
 */
import { newBotState, type BotState } from '../../supabase/functions/_shared/bot'
import { supabase } from '../lib/supabase'
import { phone10 } from './api'
import type { SiteSettings } from '../site/cms/types'

export type { BotState }
export { newBotState }

/** One chat turn from the simulator: runs the real Edge Function (staff only), so the preview matches production. */
export async function simulateBot(phone: string, text: string, _state: BotState | null, _site: SiteSettings): Promise<{ state: BotState; replies: string[] }> {
  const { data, error } = await supabase!.functions.invoke('whatsapp-bot', { body: { simulate: { from: phone10(phone), text } } })
  if (error) throw new Error(`${error.message}. Is the whatsapp-bot function deployed? (supabase functions deploy whatsapp-bot --no-verify-jwt)`)
  return data as { state: BotState; replies: string[] }
}
