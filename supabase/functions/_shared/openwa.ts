// Incoming OpenWA webhook → chatbot message. Shared by supabase/functions/whatsapp-bot and the tests.
// OpenWA signs every delivery: X-OpenWA-Signature: sha256=<hex HMAC-SHA256 of the raw body, keyed with the webhook secret>.
// deno-lint-ignore-file no-explicit-any
import { phoneFromChatId } from './providers.ts'

const enc = new TextEncoder()
async function hmacHex(key: string, data: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data))), (x) => x.toString(16).padStart(2, '0')).join('')
}
const safeEq = (a: string, b: string) => a.length === b.length && [...a].reduce((d, c, i) => d | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0

export const openwaSignature = async (secret: string, raw: string) => 'sha256=' + await hmacHex(secret, raw)

export type OpenwaInbound =
  | { kind: 'reject'; status: number; reason: string }
  | { kind: 'ignore'; reason: string }
  | { kind: 'message'; phone: string; text: string; key: string }

/**
 * The sender's number is the patient's identity for booking / cancelling, so:
 *  - no secret configured → reject (never trust unsigned requests)
 *  - wrong signature → reject
 *  - other sessions, our own messages, groups, non-Indian numbers → ignore
 */
export async function parseOpenwa(raw: string, signature: string | null, opts: { secret?: string; session?: string }): Promise<OpenwaInbound> {
  if (!opts.secret) return { kind: 'reject', status: 401, reason: 'openwa webhook secret is not configured' }
  if (!safeEq(await openwaSignature(opts.secret, raw), signature ?? '')) return { kind: 'reject', status: 401, reason: 'bad signature' }
  let body: any
  try { body = JSON.parse(raw) } catch { return { kind: 'reject', status: 400, reason: 'invalid JSON' } }
  if (opts.session && body.sessionId && body.sessionId !== opts.session) return { kind: 'ignore', reason: 'other session' }
  if (body.event !== 'message.received') return { kind: 'ignore', reason: `event ${body.event}` }
  const d = body.data ?? {}
  if (d.fromMe) return { kind: 'ignore', reason: 'own message' }
  if (d.isGroup || /@g\.us$/.test(d.chatId ?? d.from ?? '')) return { kind: 'ignore', reason: 'group' }
  const phone = phoneFromChatId(d.from ?? d.chatId ?? '') || phoneFromChatId(String(d.senderPhone ?? d.sender_phone ?? d.contact?.number ?? ''))
  if (!/^[6-9]\d{9}$/.test(phone)) return { kind: 'ignore', reason: 'not an Indian mobile' }
  return { kind: 'message', phone, text: String(d.body ?? '').trim() || 'menu', key: String(d.id ?? body.idempotencyKey ?? '') }
}
