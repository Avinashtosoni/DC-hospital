// AI-assisted tenant website page generation. Requires hospital-owner auth, plan/admin entitlement, ordered provider
// failover, an atomic per-hospital/per-owner daily allowance, and compact draft-only structured output.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, resolveCaller, forwardedTenantHeaders } from '../_shared/tenant.ts'
import { loadPlatformEnv } from '../_shared/ops.ts'
import { buildPrompt, errorCode, providerKey, sanitizeGeneratedPage, type AiProvider } from '../_shared/ai_builder.ts'

const cors = corsHeaders()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const userClient = (jwt: string, headers: Record<string, string>) => createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}`, ...headers } },
})

class ProviderFailure extends Error {
  code: string
  constructor(code: string) { super(code); this.code = code }
}
class BodyTooLarge extends Error {}
interface ProviderResult { text: string; inputTokens: number; outputTokens: number }
const MAX_REQUEST_BYTES = 8_192
const MAX_PROVIDER_RESPONSE_BYTES = 256_000

/** Read streaming bodies with a hard byte ceiling; do not allocate an unbounded response before checking it. */
async function readBounded(body: ReadableStream<Uint8Array> | null, maxBytes: number, providerError?: string): Promise<string> {
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        if (providerError) throw new ProviderFailure(providerError)
        throw new BodyTooLarge()
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(bytes)
}

async function requestJson(url: string, init: RequestInit): Promise<any> {
  const ctl = new AbortController()
  const timeout = setTimeout(() => ctl.abort(), 20_000)
  try {
    const response = await fetch(url, { ...init, signal: ctl.signal, redirect: 'error' })
    if (!response.ok) throw new ProviderFailure(errorCode(response.status))
    const length = Number(response.headers.get('content-length') ?? 0)
    if (Number.isFinite(length) && length > MAX_PROVIDER_RESPONSE_BYTES) throw new ProviderFailure('response_too_large')
    const text = await readBounded(response.body, MAX_PROVIDER_RESPONSE_BYTES, 'response_too_large')
    try { return JSON.parse(text) } catch { throw new ProviderFailure('invalid_json') }
  } catch (e) {
    if (e instanceof ProviderFailure) throw e
    if (e instanceof DOMException && e.name === 'AbortError') throw new ProviderFailure(errorCode(undefined, 'timeout'))
    throw new ProviderFailure(errorCode(undefined, 'network'))
  } finally { clearTimeout(timeout) }
}

async function generate(provider: AiProvider, model: string, key: string, brief: string, maxTokens: number): Promise<ProviderResult> {
  const prompt = buildPrompt(brief)
  if (provider === 'openai') {
    const d = await requestJson('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: maxTokens, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }] }),
    })
    const text = d?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text.trim()) throw new ProviderFailure('empty_response')
    return { text, inputTokens: Number(d?.usage?.prompt_tokens) || 0, outputTokens: Number(d?.usage?.completion_tokens) || 0 }
  }
  if (provider === 'anthropic') {
    const d = await requestJson('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.2, system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }] }),
    })
    const text = Array.isArray(d?.content) ? d.content.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('\n') : ''
    if (!text.trim()) throw new ProviderFailure('empty_response')
    return { text, inputTokens: Number(d?.usage?.input_tokens) || 0, outputTokens: Number(d?.usage?.output_tokens) || 0 }
  }
  const d = await requestJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: prompt.system }] }, contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: maxTokens } }),
  })
  const text = Array.isArray(d?.candidates?.[0]?.content?.parts) ? d.candidates[0].content.parts.map((p: any) => p?.text ?? '').join('\n') : ''
  if (!text.trim()) throw new ProviderFailure('empty_response')
  return { text, inputTokens: Number(d?.usageMetadata?.promptTokenCount) || 0, outputTokens: Number(d?.usageMetadata?.candidatesTokenCount) || 0 }
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function finishUsage(args: Record<string, unknown>) {
  try {
    const { error } = await admin.rpc('ai_builder_finish', args)
    if (error) console.warn('AI usage record could not be finalized.')
  } catch { console.warn('AI usage record could not be finalized.') }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) return json({ error: 'Request is too large.' }, 413)
  let body: any
  try {
    const text = await readBounded(req.body, MAX_REQUEST_BYTES)
    body = JSON.parse(text)
  } catch (e) {
    if (e instanceof BodyTooLarge) return json({ error: 'Request is too large.' }, 413)
    return json({ error: 'Request must be JSON.' }, 400)
  }
  const brief = typeof body?.brief === 'string' ? body.brief.trim() : ''
  if (Object.keys(body ?? {}).some((k) => k !== 'brief') || brief.length < 12 || brief.length > 500) {
    return json({ error: 'Describe the page in 12–500 characters.' }, 400)
  }

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt || jwt === SERVICE_KEY) return json({ error: 'Sign in as the hospital owner to use AI page assistance.' }, 401)
  const caller = await resolveCaller(req, { serviceKey: SERVICE_KEY, admin, userClient })
  if (caller.kind !== 'user' || !caller.id || !caller.tenant || caller.role !== 'owner' || caller.provider) {
    return json({ error: 'Only a hospital owner can generate a page.' }, 403)
  }
  const asUser = userClient(jwt, forwardedTenantHeaders(req))
  const { data: access, error: accessError } = await asUser.rpc('my_ai_access')
  if (accessError || !access?.enabled) return json({ error: access?.reason || 'AI page assistance is not enabled for this hospital.' }, 403)

  const [{ data: settingsRow, error: settingsError }, env] = await Promise.all([
    admin.from('platform_settings').select('data').eq('key', 'ai_builder').maybeSingle(),
    loadPlatformEnv(admin, (k) => Deno.env.get(k)),
  ])
  if (settingsError) return json({ error: 'AI provider settings could not be loaded.' }, 503)
  const settings = settingsRow?.data ?? {}
  if (!settings.enabled) return json({ error: 'AI page assistance is temporarily paused by the platform administrator.' }, 503)
  const providers = (Array.isArray(settings.providers) ? settings.providers : [])
    .filter((p: any) => p && p.enabled === true && ['openai', 'anthropic', 'gemini'].includes(p.id) && typeof p.model === 'string')
    .map((p: any) => ({ id: p.id as AiProvider, model: p.model as string, key: env(providerKey(p.id as AiProvider)) ?? '' }))
    .filter((p: any) => p.key.trim())
  if (!providers.length) return json({ error: 'No enabled AI provider is ready. Please ask a platform admin to configure one.' }, 503)

  const { data: reservation, error: reserveError } = await admin.rpc('ai_builder_reserve', {
    p_tenant: caller.tenant, p_actor: caller.id, p_request_hash: await sha256(`${crypto.randomUUID()}:${brief}`),
  })
  if (reserveError) {
    const m = reserveError.message ?? ''
    if (/AI_DAILY_LIMIT|AI_ACTOR_LIMIT/.test(m)) return json({ error: 'The AI page-building limit for today has been reached. Please try tomorrow.' }, 429)
    if (/AI_NOT_ENTITLED/.test(m)) return json({ error: 'AI page assistance is not included in this hospital’s plan and is not enabled by an admin.' }, 403)
    return json({ error: 'AI page generation could not be started. Please try again.' }, 503)
  }

  let lastCode = 'provider_error'
  for (const p of providers) {
    try {
      const result = await generate(p.id, p.model, p.key, brief, Math.max(200, Math.min(2000, Number(settings.maxOutputTokens) || 900)))
      const page = sanitizeGeneratedPage(result.text)
      const inputTokens = result.inputTokens || Math.ceil((buildPrompt(brief).system.length + brief.length) / 4)
      const outputTokens = result.outputTokens || Math.ceil(result.text.length / 4)
      await finishUsage({ p_id: reservation.id, p_status: 'success', p_provider: p.id, p_model: p.model,
        p_input_tokens: inputTokens, p_output_tokens: outputTokens, p_error_code: null })
      return json({ page, provider: p.id })
    } catch (e) {
      lastCode = e instanceof ProviderFailure ? e.code : 'invalid_response'
      console.warn(`AI provider ${p.id} failed: ${lastCode}`)
    }
  }
  await finishUsage({ p_id: reservation.id, p_status: 'failed', p_provider: null, p_model: null,
    p_input_tokens: 0, p_output_tokens: 0, p_error_code: lastCode })
  return json({ error: 'All configured AI providers are temporarily unavailable. Please try again shortly.' }, 502)
})
