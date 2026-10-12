import { describe, expect, it } from 'vitest'
import { metaReceiverMatches } from '../../supabase/functions/_shared/meta'

const envelope = (...ids: string[]) => ({
  entry: [{ changes: ids.map((phone_number_id) => ({ value: { metadata: { phone_number_id } } })) }],
})

describe('Meta webhook receiver binding', () => {
  it('accepts only a non-empty payload whose every change matches the configured phone number ID', () => {
    expect(metaReceiverMatches(envelope('1234567890'), '1234567890')).toBe(true)
    expect(metaReceiverMatches(envelope('1234567890', '1234567890'), '1234567890')).toBe(true)
    expect(metaReceiverMatches(envelope('1234567890'), ' 1234567890 ')).toBe(true)
  })

  it('rejects a missing configuration, missing or malformed metadata, and mixed/wrong receiver IDs', () => {
    expect(metaReceiverMatches(envelope('1234567890'), '')).toBe(false)
    expect(metaReceiverMatches({ entry: [{ changes: [{ value: { messages: [] } }] }] }, '1234567890')).toBe(false)
    expect(metaReceiverMatches(envelope('9876543210'), '1234567890')).toBe(false)
    expect(metaReceiverMatches(envelope('1234567890', '9876543210'), '1234567890')).toBe(false)
    expect(metaReceiverMatches({ entry: [] }, '1234567890')).toBe(false)
    expect(metaReceiverMatches(null, '1234567890')).toBe(false)
  })
})
