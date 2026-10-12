/**
 * Canonical inventory for Supabase Edge Functions.
 *
 * Keep deploy security, preflight probes and System health pointed at this list. Functions which opt out of the
 * Supabase gateway JWT check must validate their own caller/webhook credentials in the handler.
 */
export const FUNCTION_MANIFEST = [
  { name: 'ai-page-builder', verifyJwt: true },
  { name: 'billing', verifyJwt: false },
  { name: 'domains', verifyJwt: true },
  { name: 'impersonate', verifyJwt: true },
  { name: 'notify', verifyJwt: true },
  { name: 'ops', verifyJwt: true },
  { name: 'whatsapp-bot', verifyJwt: false },
] as const

export type FunctionName = (typeof FUNCTION_MANIFEST)[number]['name']
export const EDGE_FUNCTIONS = FUNCTION_MANIFEST.map(({ name }) => name)

/** Headers used by the app's Supabase functions client, including multi-tenant and provider-mode context. */
export const REQUIRED_FUNCTION_CORS_HEADERS = [
  'authorization',
  'apikey',
  'content-type',
  'x-client-info',
  'x-tenant-id',
  'x-provider-mode',
] as const
