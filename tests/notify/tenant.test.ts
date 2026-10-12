import { describe, expect, test } from 'vitest'
import { corsHeaders, forwardedTenantHeaders, groupByTenant, PRIMARY_TENANT, webhookTenantRef, webhookUrl } from '../../supabase/functions/_shared/tenant'

const B = 'b0000000-0000-4000-8000-000000000002'

describe('edge functions: which hospital (supabase/functions/_shared/tenant.ts)', () => {
  test('a webhook address names its hospital; none means the primary hospital; junk is refused', () => {
    const ref = (q: string) => webhookTenantRef(new URL(`https://x.supabase.co/functions/v1/whatsapp-bot${q}`))
    expect(ref('')).toEqual({ primary: true })
    expect(ref('?hospital=CityCare')).toEqual({ slug: 'citycare' })
    expect(ref(`?hospital=${B}`)).toEqual({ id: B })
    expect(ref(`?tenant=${B}`)).toEqual({ id: B })
    expect(ref('?hospital=../etc')).toEqual({ invalid: true })
    expect(ref("?hospital=a' or 1=1")).toEqual({ invalid: true })
  })

  test('the webhook address shown in Settings', () => {
    expect(webhookUrl('https://x.supabase.co/', null)).toBe('https://x.supabase.co/functions/v1/whatsapp-bot')
    expect(webhookUrl('https://x.supabase.co', { slug: 'main', is_primary: true })).toBe('https://x.supabase.co/functions/v1/whatsapp-bot')
    expect(webhookUrl('https://x.supabase.co', { slug: 'citycare', is_primary: false })).toBe('https://x.supabase.co/functions/v1/whatsapp-bot?hospital=citycare')
  })

  test('queue rows are grouped per hospital (old rows → primary)', () => {
    const g = groupByTenant([{ id: 1, tenant_id: B }, { id: 2, tenant_id: null }, { id: 3, tenant_id: B }, { id: 4 }])
    expect([...g.keys()]).toEqual([B, PRIMARY_TENANT])
    expect(g.get(B)!.map((r) => r.id)).toEqual([1, 3])
    expect(g.get(PRIMARY_TENANT)!.map((r) => r.id)).toEqual([2, 4])
  })

  test('only well-formed hospital / mode headers are forwarded; CORS allows them', () => {
    const req = (h: Record<string, string>) => new Request('https://x.test', { headers: h })
    expect(forwardedTenantHeaders(req({ 'x-tenant-id': B, 'x-provider-mode': 'support' }))).toEqual({ 'x-tenant-id': B, 'x-provider-mode': 'support' })
    expect(forwardedTenantHeaders(req({ 'x-tenant-id': 'nope', 'x-provider-mode': 'root' }))).toEqual({})
    expect(corsHeaders()['Access-Control-Allow-Headers']).toMatch(/x-tenant-id.*x-provider-mode/)
  })
})
