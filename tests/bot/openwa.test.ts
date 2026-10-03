/** Incoming OpenWA / WA CRM webhook: signature, filtering and sender extraction (supabase/functions/_shared/openwa.ts). */
import { describe, expect, test } from 'vitest'
import { openwaSignature, parseOpenwa } from '../../supabase/functions/_shared/openwa'

const SECRET = 'whsec_test'
const SESSION = '9b11cfeb-b5a2-4636-8415-d29cf3555089'
const event = (data: Record<string, unknown>, extra: Record<string, unknown> = {}) => JSON.stringify({
  event: 'message.received', timestamp: '2026-10-01T10:30:00Z', sessionId: SESSION, idempotencyKey: 'idem-1', deliveryId: 'd-1',
  data: { id: '3EB0F5A2', chatId: '919876543210@c.us', from: '919876543210@c.us', body: 'hi', type: 'text', timestamp: 1759314600, ...data }, ...extra })
const opts = { secret: SECRET, session: SESSION }

describe('OpenWA inbound webhook', () => {
  test('a correctly signed message is accepted with the 10-digit sender', async () => {
    const raw = event({ body: '  1 ' })
    expect(await parseOpenwa(raw, await openwaSignature(SECRET, raw), opts)).toEqual({ kind: 'message', phone: '9876543210', text: '1', key: '3EB0F5A2' })
  })
  test('unsigned, wrongly signed or tampered requests are rejected', async () => {
    const raw = event({})
    expect(await parseOpenwa(raw, null, opts)).toMatchObject({ kind: 'reject', status: 401 })
    expect(await parseOpenwa(raw, 'sha256=00', opts)).toMatchObject({ kind: 'reject', status: 401 })
    const sig = await openwaSignature(SECRET, raw)
    expect(await parseOpenwa(raw.replace('919876543210@c.us', '919999999999@c.us'), sig, opts)).toMatchObject({ kind: 'reject' })
    expect(await parseOpenwa(raw, await openwaSignature('other', raw), opts)).toMatchObject({ kind: 'reject' })
  })
  test('without a configured secret nothing is trusted', async () => {
    const raw = event({})
    expect(await parseOpenwa(raw, await openwaSignature(SECRET, raw), { session: SESSION })).toMatchObject({ kind: 'reject', status: 401 })
  })
  test('own messages, groups, other events / sessions and foreign numbers are ignored', async () => {
    const check = async (raw: string) => (await parseOpenwa(raw, await openwaSignature(SECRET, raw), opts)).kind
    expect(await check(event({ fromMe: true }))).toBe('ignore')
    expect(await check(event({ chatId: '120363@g.us', from: '120363@g.us', isGroup: true }))).toBe('ignore')
    expect(await check(event({}, { event: 'message.ack' }))).toBe('ignore')
    expect(await check(event({}, { sessionId: 'someone-else' }))).toBe('ignore')
    expect(await check(event({ from: '14155550100@c.us', chatId: '14155550100@c.us' }))).toBe('ignore')
  })
  test('a LID sender falls back to the resolved phone; empty text opens the menu', async () => {
    const raw = event({ from: '2401234567@lid', chatId: '2401234567@lid', senderPhone: '919812345678@c.us', body: '' })
    expect(await parseOpenwa(raw, await openwaSignature(SECRET, raw), opts)).toMatchObject({ kind: 'message', phone: '9812345678', text: 'menu' })
  })
})
