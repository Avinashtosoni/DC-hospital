import { describe, expect, it } from 'vitest'
import { buildAccessEvent, buildEvent, parseDsn, reportAccessSignal, reportError, scrub, setMonitoringContext } from '../src/lib/monitoring'

describe('error reporting (optional Sentry)', () => {
  it('parses DSNs and refuses bad ones', () => {
    expect(parseDsn('https://abc123@o42.ingest.sentry.io/4567')).toEqual({ endpoint: 'https://o42.ingest.sentry.io/api/4567/envelope/', key: 'abc123', dsn: 'https://abc123@o42.ingest.sentry.io/4567' })
    expect(parseDsn('https://k@sentry.example.in/sub/12')?.endpoint).toBe('https://sentry.example.in/sub/api/12/envelope/')
    expect(parseDsn('http://k@o1.ingest.sentry.io/1')).toBeNull()
    expect(parseDsn('https://o1.ingest.sentry.io/1')).toBeNull()
    expect(parseDsn('nonsense')).toBeNull()
  })
  it('never sends personal data', () => {
    expect(scrub('Patient rohan@example.com +91 98765 43210 MRN 100001234 token eyJhbGc.eyJzdWIi.abc')).toBe('Patient [email] [phone] MRN [number] token [token]')
    setMonitoringContext({ tenant: 'citycare', role: 'doctor' })
    const ev = buildEvent(new Error('Cannot save for 9876543210'), { source: 'screen' })
    expect(ev.exception.values[0].value).toBe('Cannot save for [phone]')
    expect(ev.tags).toEqual({ tenant: 'citycare', role: 'doctor', source: 'screen' })
    expect(Object.keys(ev)).not.toContain('user')
    const top = ev.exception.values[0].stacktrace!.frames.at(-1)!
    expect(top).toMatchObject({ filename: expect.stringMatching(/monitoring\.test\.ts$/), in_app: true })
    expect(typeof top.lineno).toBe('number')
    const access = buildAccessEvent('patient_chart')
    expect(access.tags).toEqual({ tenant: 'citycare', role: 'doctor', source: 'clinical_access_signal', screen: 'patient_chart' })
    expect(access).not.toHaveProperty('request')
    expect(access).not.toHaveProperty('exception')
    expect(access).not.toHaveProperty('user')
    expect(JSON.stringify(access)).not.toContain('9b6c4a87-2450-477c-9fee-e4eadd8fef3d')
    const ff = buildEvent(Object.assign(new Error('ff'), { stack: 'Error: ff\nsave@https://h.in/assets/index-abc.js?v=1:10:20\n' }))
    expect(ff.exception.values[0].stacktrace!.frames[0]).toEqual({ function: 'save', filename: 'https://h.in/assets/index-abc.js', lineno: 10, colno: 20, in_app: true })
    expect(ev.event_id).toMatch(/^[0-9a-z]{32}$/)
  })
  it('sends a rate-limited, low-data access signal only when a Sentry DSN is configured', () => {
    expect(reportAccessSignal('patient_list', null)).toBe(false)
    const previousFetch = globalThis.fetch
    const calls: { url: string; body: string }[] = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') })
      return new Response('')
    }) as typeof fetch
    try {
      const dsn = parseDsn('https://k@o1.ingest.sentry.io/10')
      expect(reportAccessSignal('patient_list', dsn)).toBe(true)
      expect(reportAccessSignal('patient_list', dsn)).toBe(false)
      expect(calls).toHaveLength(1)
      expect(calls[0].body).toContain('"level":"info"')
      expect(calls[0].body).toContain('"screen":"patient_list"')
      expect(calls[0].body).not.toContain('patient_id')
      expect(calls[0].body).not.toContain('full_name')
      expect(calls[0].body).not.toContain('request')
    } finally {
      globalThis.fetch = previousFetch
    }
  })

  it('is a no-op without a DSN; deduplicates and caps with one', async () => {
    expect(reportError(new Error('x'))).toBe(false)
    const calls: string[] = []
    globalThis.fetch = (async (url: string) => { calls.push(url); return new Response('') }) as typeof fetch
    const dsn = parseDsn('https://k@o1.ingest.sentry.io/9')
    expect(reportError(new Error('boom'), {}, dsn)).toBe(true)
    expect(reportError(new Error('boom'), {}, dsn)).toBe(false)
    for (let i = 0; i < 20; i++) reportError(new Error(`e${i}`), {}, dsn)
    expect(calls.length).toBe(10)
    expect(calls[0]).toBe('https://o1.ingest.sentry.io/api/9/envelope/?sentry_key=k&sentry_version=7')
  })
})
