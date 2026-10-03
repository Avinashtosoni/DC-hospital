import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe, Plus, RefreshCw, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, ConfirmDialog, EmptyState, Field, Input, Select, Skeleton } from '../../../../src/components/ui'
import { cp, friendly } from '../../api'
import type { CpHospitalDetail } from '../../types'
import { dateTime, ErrorBox, Section } from '../../ui'

interface DomainRow { domain: string; is_primary: boolean; method: 'cloudflare' | 'manual'; status: string | null; ssl_status: string | null; dns_target: string | null; last_error: string | null; checked_at: string | null; verification?: { txt?: { name?: string; value?: string; type?: string } } | null }
interface DomainsResp { cloudflare: boolean; target: string | null; platform: string; canManage: boolean; domains: DomainRow[] }

/** Phase D: the hospital's website addresses (the domains Edge Function — Cloudflare for SaaS, or manual). Admins only. */
export function DomainsTab({ h }: { h: CpHospitalDetail }) {
  const qc = useQueryClient()
  const key = ['cp-domains', h.id]
  const q = useQuery({ queryKey: key, queryFn: () => cp.domains(h.id, 'list') as Promise<DomainsResp>, retry: false })
  const [domain, setDomain] = useState('')
  const [method, setMethod] = useState<'cloudflare' | 'manual'>('cloudflare')
  const [removing, setRemoving] = useState<string | null>(null)
  const act = useMutation({
    mutationFn: ({ action, d }: { action: 'add' | 'check' | 'remove' | 'primary'; d: string; ok: string }) =>
      cp.domains(h.id, action, { domain: d, ...(action === 'add' ? { method } : {}) }) as Promise<DomainsResp>,
    onSuccess: (r, v) => { qc.setQueryData(key, r); qc.invalidateQueries({ queryKey: ['cp-hospital'] }); toast.success(v.ok); if (v.action === 'add') setDomain(''); setRemoving(null) },
    onError: (e) => toast.error(friendly(e)),
  })
  const busy = (a: string, d: string) => act.isPending && act.variables?.action === a && act.variables.d === d

  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <Skeleton className="h-60" />
  const r = q.data
  return (
    <div className="space-y-6">
      <Section title="Add an address" subtitle={r.cloudflare ? `Cloudflare is connected — SSL is automatic. The hospital points a CNAME to ${r.target}.` : 'Cloudflare is not configured: addresses are added as manual (set up DNS + SSL in Coolify yourself).'}>
        <form className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); if (domain.trim()) act.mutate({ action: 'add', d: domain.trim(), ok: `${domain.trim()} added` }) }}>
          <Field label="Domain" hint={`e.g. www.cityhospital.in or city.${r.platform}`}><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="www.example.in" /></Field>
          <Field label="Set-up"><Select value={method} onChange={(e) => setMethod(e.target.value as 'cloudflare' | 'manual')} disabled={!r.cloudflare}>
            <option value="cloudflare">Automatic (Cloudflare)</option><option value="manual">Manual</option></Select></Field>
          <Button type="submit" icon={<Plus className="h-4 w-4" />} loading={act.isPending && act.variables?.action === 'add'} disabled={!domain.trim()}>Add</Button>
        </form>
      </Section>
      <Section title="Addresses">
        {!r.domains.length ? <EmptyState icon={<Globe className="h-6 w-6" />} title="No custom address" description={`It opens at ${location.origin}/?hospital=${h.slug}`} /> : (
          <ul className="space-y-3">
            {r.domains.map((d) => (
              <li key={d.domain} className="rounded-xl border border-slate-100 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Globe className="h-4 w-4 text-brand-600" />
                  <a href={`https://${d.domain}`} target="_blank" rel="noreferrer" className="font-medium text-brand-900 hover:underline">{d.domain}</a>
                  {d.is_primary && <Badge tone="violet">primary</Badge>}
                  <Badge tone={d.status === 'active' ? 'green' : d.status === 'manual' ? 'blue' : 'amber'}>{d.status ?? 'pending'}</Badge>
                  {d.ssl_status && <Badge tone={d.ssl_status === 'active' ? 'green' : 'amber'}>SSL {d.ssl_status}</Badge>}
                  <span className="text-xs text-slate-400">{d.method}{d.checked_at ? ` · checked ${dateTime(d.checked_at)}` : ''}</span>
                  <div className="ml-auto flex gap-1">
                    {d.method === 'cloudflare' && <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={busy('check', d.domain)} onClick={() => act.mutate({ action: 'check', d: d.domain, ok: 'Status refreshed' })}>Check</Button>}
                    {!d.is_primary && <Button size="sm" variant="ghost" icon={<Star className="h-3.5 w-3.5" />} loading={busy('primary', d.domain)} onClick={() => act.mutate({ action: 'primary', d: d.domain, ok: `${d.domain} is now the main address` })}>Make primary</Button>}
                    <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5 text-rose-600" />} onClick={() => setRemoving(d.domain)}><span className="sr-only">Remove</span></Button>
                  </div>
                </div>
                {d.dns_target && d.status !== 'active' && <p className="mt-2 text-xs text-slate-600">DNS: <code className="rounded bg-slate-100 px-1">CNAME {d.domain} → {d.dns_target}</code></p>}
                {d.status !== 'active' && d.verification?.txt?.name && <p className="mt-1 text-xs text-slate-600">Verify: <code className="rounded bg-slate-100 px-1">TXT {d.verification.txt.name} = {d.verification.txt.value}</code></p>}
                {d.last_error && <p className="mt-1 text-xs text-rose-700">{d.last_error}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} loading={act.isPending} title={`Remove ${removing}?`} confirmLabel="Remove"
        description="The hospital stops opening at this address (it is also removed from Cloudflare)." onConfirm={() => removing && act.mutate({ action: 'remove', d: removing, ok: `${removing} removed` })} />
    </div>
  )
}
