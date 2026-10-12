/** Meta Cloud API's signature authenticates the app, not the receiving hospital's phone number. */
export function metaReceiverMatches(payload: unknown, expectedPhoneNumberId: string): boolean {
  const expected = expectedPhoneNumberId.trim()
  if (!expected || !payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const entries = (payload as { entry?: unknown }).entry
  if (!Array.isArray(entries) || entries.length === 0) return false

  const received: string[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const changes = (entry as { changes?: unknown }).changes
    if (!Array.isArray(changes) || changes.length === 0) return false
    for (const change of changes) {
      if (!change || typeof change !== 'object' || Array.isArray(change)) return false
      const value = (change as { value?: unknown }).value
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      const metadata = (value as { metadata?: unknown }).metadata
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
      const id = (metadata as { phone_number_id?: unknown }).phone_number_id
      if (typeof id !== 'string' || !id.trim()) return false
      received.push(id.trim())
    }
  }
  return received.length > 0 && received.every((id) => id === expected)
}
