// Firebase Cloud Messaging (HTTP v1) for the notify Edge Function.
//   service account JSON (Settings → Notifications → Push → write-only secret `fcm_service_account`)
//   → signed RS256 JWT (WebCrypto) → OAuth access token → POST projects/{id}/messages:send, one request per device.
// Unit-tested with a mocked fetch in tests/notify/fcm.test.ts.
// deno-lint-ignore-file no-explicit-any

export interface ServiceAccount { project_id: string; client_email: string; private_key: string; token_uri?: string }
export interface PushPayload { title: string; body: string; link?: string; icon?: string; tag?: string; data?: Record<string, string> }
export interface PushResult { ok: boolean; sent: number; ref?: string; error?: string; invalid: string[] }

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

export function parseServiceAccount(raw: string | undefined): ServiceAccount {
  if (!raw) throw new Error('Firebase service-account JSON is not configured')
  let j: any
  try { j = JSON.parse(raw) } catch { throw new Error('Firebase service-account JSON is not configured correctly (not valid JSON)') }
  if (!j.project_id || !j.client_email || !String(j.private_key ?? '').includes('PRIVATE KEY')) {
    throw new Error('Firebase service-account JSON is not configured correctly (needs project_id, client_email and private_key)')
  }
  return { project_id: j.project_id, client_email: j.client_email, private_key: j.private_key, token_uri: j.token_uri }
}

const b64url = (bytes: Uint8Array | string) => {
  const s = typeof bytes === 'string' ? btoa(unescape(encodeURIComponent(bytes))) : btoa(String.fromCharCode(...bytes))
  return s.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function importKey(pem: string): Promise<CryptoKey> {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '')), (ch) => ch.charCodeAt(0))
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
}

export async function signJwt(sa: ServiceAccount, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri || TOKEN_URL, iat: now, exp: now + 3600 }))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await importKey(sa.private_key), new TextEncoder().encode(`${head}.${claims}`))
  return `${head}.${claims}.${b64url(new Uint8Array(sig))}`
}

const cache = new Map<string, { token: string; until: number }>()
export const clearTokenCache = () => cache.clear()

export async function accessToken(sa: ServiceAccount): Promise<string> {
  const hit = cache.get(sa.client_email)
  if (hit && hit.until > Date.now()) return hit.token
  const r = await fetch(sa.token_uri || TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await signJwt(sa) }).toString(),
  })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) throw new Error(`Google rejected the API key / service account: ${j.error_description || j.error || `HTTP ${r.status}`}`)
  cache.set(sa.client_email, { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60_000 })
  return j.access_token
}

/** Sends to every device; tokens Firebase reports as gone come back in `invalid` so the caller can forget them. */
export async function sendPush(sa: ServiceAccount, tokens: string[], p: PushPayload): Promise<PushResult> {
  if (!tokens.length) return { ok: false, sent: 0, error: 'No devices — the person has not allowed notifications', invalid: [] }
  const bearer = await accessToken(sa)
  const invalid: string[] = []
  const errors: string[] = []
  let sent = 0, ref: string | undefined
  for (const token of tokens.slice(0, 10)) {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
      method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: {
        token,
        notification: { title: p.title.slice(0, 200), body: p.body.slice(0, 1000) },
        data: { ...(p.data ?? {}), ...(p.link ? { link: p.link } : {}) },
        webpush: {
          notification: { ...(p.icon ? { icon: p.icon } : {}), ...(p.tag ? { tag: p.tag } : {}) },
          ...(p.link?.startsWith('https://') ? { fcm_options: { link: p.link } } : {}),
        },
      } }),
    })
    const j: any = await r.json().catch(() => ({}))
    if (r.ok) { sent++; ref = ref ?? String(j.name ?? '').split('/').pop(); continue }
    const code = j.error?.details?.find((d: any) => d.errorCode)?.errorCode ?? j.error?.status
    if (r.status === 404 || code === 'UNREGISTERED' || (code === 'INVALID_ARGUMENT' && /token/i.test(j.error?.message ?? ''))) invalid.push(token)
    else errors.push(j.error?.message || `FCM HTTP ${r.status}`)
  }
  if (sent) return { ok: true, sent, ref: `${ref ?? 'sent'}${tokens.length > 1 ? ` · ${sent}/${tokens.length} devices` : ''}`, invalid }
  return { ok: false, sent: 0, error: errors[0] ?? 'The device is no longer registered for notifications', invalid }
}
