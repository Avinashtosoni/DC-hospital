import { describe, expect, it } from 'vitest'
import { isIndianMobile } from '../src/lib/validation'
import { channelIssues, type SecretStatus } from '../src/settings/store'
import { DEFAULT_APP_SETTINGS } from '../src/settings/types'

describe('isIndianMobile', () => {
  it.each(['9812345678', '+91 98123 45678', '+919812345678', '09812345678', '98123-45678', '6000000000'])('accepts %s', (p) => expect(isIndianMobile(p)).toBe(true))
  it.each(['', '12345', '5812345678', '98123456789', '+1 415 555 0100', 'abc9812345678', '+91 11 4000 2100'])('rejects %s', (p) => expect(isIndianMobile(p)).toBe(false))
})

describe('OpenWA client URL validation', () => {
  const issuesFor = (openwaUrl: string) => {
    const settings = structuredClone(DEFAULT_APP_SETTINGS)
    settings.notifications.whatsapp.provider = 'openwa'
    settings.notifications.whatsapp.openwaUrl = openwaUrl
    settings.notifications.whatsapp.openwaSession = 'main'
    const secrets: SecretStatus[] = [{ key: 'openwa_api_key', hint: '••••', updated_at: '', updated_by_name: null }]
    return channelIssues('whatsapp', settings, secrets)
  }
  it.each(['http://wa.example.in', 'https://user:pass@wa.example.in', 'https://wa.example.in/?next=x', 'https://wa.example.in/#fragment'])('rejects unsafe URL %s', (url) => {
    expect(issuesFor(url).some((x) => /OpenWA gateway URL.*https/i.test(x))).toBe(true)
  })
  it('accepts a clean HTTPS base URL', () => expect(issuesFor('https://wa.example.in/api')).toEqual([]))
})
