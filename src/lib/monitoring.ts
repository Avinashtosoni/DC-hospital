/**
 * Optional error reporting (phase 8.3) — off unless SENTRY_DSN is set (runtime env.js or VITE_SENTRY_DSN).
 * A tiny client for Sentry's envelope endpoint instead of the SDK: no extra dependency, nothing loaded when off.
 * Privacy: hospital data must never leave — messages are scrubbed of e-mails / phone numbers / long numbers, the URL is
 * sent without query string or hash, and no user id, name or e-mail is attached (only the hospital's short name and role).
 */
import { appEnv, sentryDsn } from './supabase'

declare const __APP_BUILD__: string
const build = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev'

export interface Dsn { endpoint: string; key: string; dsn: string }

/** https://<key>@o123.ingest.sentry.io/456 → envelope endpoint + public key */
export function parseDsn(dsn: string): Dsn | null {
  try {
    const u = new URL(dsn.trim())
    const project = u.pathname.replace(/^\/+|\/+$/g, '')
    if (u.protocol !== 'https:' || !u.username || !/^\d+$/.test(project.split('/').pop() ?? '')) return null
    const prefix = project.includes('/') ? `/${project.slice(0, project.lastIndexOf('/'))}` : ''
    const id = project.split('/').pop()
    return { endpoint: `https://${u.host}${prefix}/api/${id}/envelope/`, key: u.username, dsn: dsn.trim() }
  } catch { return null }
}

/** remove anything that could identify a patient or person */
export function scrub(s: string): string {
  return s
    .replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/gi, '[email]')
    .replace(/(\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, '[phone]')
    .replace(/\b\d{7,}\b/g, '[number]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]')
    .slice(0, 2000)
}

let context: { tenant?: string; role?: string } = {}
/** hospital short name + role of the signed-in person (never their id / name / e-mail) */
export function setMonitoringContext(c: { tenant?: string | null; role?: string | null }) {
  context = { tenant: c.tenant ?? undefined, role: c.role ?? undefined }
}

export function buildEvent(error: unknown, extra: { source?: string } = {}) {
  const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error ?? 'Unknown error'))
  // Chrome / Edge "    at fn (url:1:2)" · Firefox / Safari "fn@url:1:2"
  const frames = (e.stack ?? '').split('\n').map((l) => {
    const m = l.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/) ?? l.match(/^\s*(.*?)@(.+?):(\d+):(\d+)$/)
    return m ? { function: scrub(m[1] || '?'), filename: m[2].replace(/[?#].*$/, ''), lineno: Number(m[3]), colno: Number(m[4]), in_app: !/node_modules/.test(m[2]) } : null
  }).filter(Boolean).slice(0, 30).reverse()
  return {
    event_id: (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/-/g, '').slice(0, 32).padEnd(32, '0'),
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    environment: appEnv,
    release: `hospital-comrade@${build}`,
    tags: { ...context, source: extra.source ?? 'app' },
    request: typeof location === 'undefined' ? undefined : { url: `${location.origin}${location.pathname}` },
    exception: { values: [{ type: e.name || 'Error', value: scrub(e.message || String(e)), stacktrace: frames.length ? { frames } : undefined }] },
  }
}

let sent = 0
const seen = new Set<string>()
/** report one error (deduplicated, at most 10 per page load); no-op without a DSN */
export function reportError(error: unknown, extra: { source?: string } = {}, dsn: Dsn | null = parsed) {
  if (!dsn || sent >= 10) return false
  const ev = buildEvent(error, extra)
  const sig = `${ev.exception.values[0].type}:${ev.exception.values[0].value}`
  if (seen.has(sig)) return false
  seen.add(sig); sent++
  const body = `${JSON.stringify({ event_id: ev.event_id, sent_at: new Date().toISOString(), dsn: dsn.dsn })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(ev)}\n`
  const url = `${dsn.endpoint}?sentry_key=${encodeURIComponent(dsn.key)}&sentry_version=7`
  try { void fetch(url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(() => {}) } catch { /* never let reporting break the app */ }
  return true
}

const parsed = sentryDsn ? parseDsn(sentryDsn) : null
let installed = false
/** global handlers for uncaught errors and promise rejections (call once at start) */
export function initMonitoring(source = 'app') {
  if (!parsed || installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => { if (e.error) reportError(e.error, { source }) })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    // network blips and expected "not allowed" answers are not bugs
    if (/Failed to fetch|NetworkError|Load failed|JWT|row-level security|42501/i.test(String((r as Error)?.message ?? r))) return
    reportError(r, { source })
  })
}
