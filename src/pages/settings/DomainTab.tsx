import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock, Copy, ExternalLink, Globe, Plus, RefreshCw, Star, Trash2, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, Button, ConfirmDialog, EmptyState, Field, Input, Select, Skeleton } from '../../components/ui'
import { platformName } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { DOMAINS_QK, dnsHostLabel, domainHealth, domainsApi, type DomainAction, type DomainRow, type DomainsState } from '../../tenancy/domains'
import { activeTenantId } from '../../tenancy/state'
import { looksLikeApex, normaliseDomain } from '../../../supabase/functions/_shared/cloudflare'
import { Section } from './shared'

const HEALTH = {
  live: { label: 'Live · SSL active', tone: 'green' as const, icon: CheckCircle2 },
  pending: { label: 'Waiting for DNS', tone: 'amber' as const, icon: Clock },
  manual: { label: 'Set up by the platform team', tone: 'blue' as const, icon: Wrench },
  problem: { label: 'Needs attention', tone: 'red' as const, icon: AlertTriangle },
}

function CopyValue({ value, label }: { value: string; label: string }) {
  return (
    <button type="button" onClick={() => { void navigator.clipboard?.writeText(value); toast.success(`${label} copied`) }}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-md bg-white px-2 py-1 font-mono text-xs text-brand-950 ring-1 ring-brand-100 transition hover:ring-brand-300"
      title={`Copy ${label.toLowerCase()}`}>
      <span className="truncate">{value}</span><Copy className="h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-brand-700" />
    </button>
  )
}

/** the one DNS record the hospital adds at its domain provider */
function DnsInstructions({ d }: { d: DomainRow }) {
  if (!d.dns_target) return null
  const host = dnsHostLabel(d.domain)
  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm">
      <p className="font-medium text-amber-900">Add this record where you bought the domain (GoDaddy, Hostinger, BigRock, Cloudflare…):</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-xs">
          <thead className="text-slate-500"><tr><th className="pb-1.5 pr-3 font-medium">Type</th><th className="pb-1.5 pr-3 font-medium">Name / Host</th><th className="pb-1.5 pr-3 font-medium">Value / Points to</th><th className="pb-1.5 font-medium">TTL</th></tr></thead>
          <tbody><tr>
            <td className="pr-3 font-mono font-semibold text-brand-950">CNAME</td>
            <td className="pr-3"><CopyValue value={host} label="Name" /></td>
            <td className="pr-3"><CopyValue value={d.dns_target} label="Value" /></td>
            <td className="text-slate-600">Auto</td>
          </tr></tbody>
        </table>
      </div>
      {host === '@' && <p className="mt-3 text-xs text-amber-900">Most providers don’t allow a CNAME on the root domain. Use <b>www.{d.domain}</b> instead and set a redirect from {d.domain} to it at your provider.</p>}
      <p className="mt-3 text-xs text-slate-600">DNS changes usually take 5–30 minutes (sometimes a few hours). The SSL certificate is issued automatically once the record is found — then press <b>Check status</b>.</p>
      {d.verification?.txt && (
        <details className="mt-3 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium text-brand-800">Moving from another provider without downtime?</summary>
          <p className="mt-2">Add this TXT record first — it proves ownership and gets the certificate ready before you switch the CNAME:</p>
          <div className="mt-2 flex flex-wrap items-center gap-2"><span className="font-mono font-semibold">TXT</span><CopyValue value={d.verification.txt.name} label="TXT name" /><CopyValue value={d.verification.txt.value} label="TXT value" /></div>
        </details>
      )}
    </div>
  )
}

function DomainCard({ d, state, busy, run, onRemove }: { d: DomainRow; state: DomainsState; busy: string | null; run: (a: DomainAction) => void; onRemove: () => void }) {
  const h = HEALTH[domainHealth(d)]
  return (
    <li className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Globe className="h-4 w-4 text-brand-600" />
        <a href={`https://${d.domain}`} target="_blank" rel="noreferrer" className="font-semibold text-brand-950 hover:underline">{d.domain}<ExternalLink className="ml-1 inline h-3.5 w-3.5 text-slate-400" /></a>
        {d.is_primary && <Badge tone="violet"><Star className="mr-1 h-3 w-3" />Primary</Badge>}
        <Badge tone={h.tone}><h.icon className="mr-1 h-3 w-3" />{h.label}</Badge>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {d.method === 'cloudflare' && <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={busy === `check:${d.domain}`} onClick={() => run({ action: 'check', domain: d.domain })}>Check status</Button>}
          {state.canManage && !d.is_primary && <Button size="sm" variant="ghost" loading={busy === `primary:${d.domain}`} onClick={() => run({ action: 'primary', domain: d.domain })}>Make primary</Button>}
          {state.canManage && <Button size="sm" variant="ghost" aria-label={`Remove ${d.domain}`} onClick={onRemove}><Trash2 className="h-3.5 w-3.5 text-rose-600" /></Button>}
        </span>
      </div>
      {d.last_error && domainHealth(d) !== 'live' && <p className="mt-2 text-xs text-slate-500">Cloudflare says: {d.last_error}</p>}
      {d.checked_at && <p className="mt-1 text-[11px] text-slate-400">Last checked {new Date(d.checked_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
      {domainHealth(d) === 'pending' && <DnsInstructions d={d} />}
      {domainHealth(d) === 'manual' && <p className="mt-2 text-xs text-slate-600">DNS and SSL for this address are configured by hand on the server{d.dns_target ? <> — point it at <b className="font-mono">{d.dns_target}</b></> : null}.</p>}
    </li>
  )
}

export function DomainTab() {
  const { context } = useAuth()
  const demoCanManage = context?.provider_role === 'admin'
  const tenant = activeTenantId()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: [...DOMAINS_QK, tenant], queryFn: () => domainsApi({ action: 'list' }, demoCanManage), retry: 0 })
  const [busy, setBusy] = useState<string | null>(null)
  const [del, setDel] = useState<string | null>(null)
  const [domain, setDomain] = useState('')
  const [method, setMethod] = useState<'cloudflare' | 'manual'>('cloudflare')

  const m = useMutation({
    mutationFn: (a: DomainAction) => domainsApi(a, demoCanManage),
    onMutate: (a) => setBusy(`${a.action}:${'domain' in a ? normaliseDomain(a.domain) : ''}`),
    onSuccess: (data, a) => {
      qc.setQueryData([...DOMAINS_QK, tenant], data)
      if (a.action === 'add') { setDomain(''); toast.success('Domain added', { description: 'Share the DNS record below with the hospital.' }) }
      if (a.action === 'remove') toast.success('Domain removed')
      if (a.action === 'primary') toast.success('Primary address changed')
      if (a.action === 'check') {
        const d = data.domains.find((x) => x.domain === normaliseDomain(a.domain))
        if (d && domainHealth(d) === 'live') toast.success(`${d.domain} is live`)
        else toast.info('Not live yet', { description: 'The DNS record isn’t visible yet. Try again in a few minutes.' })
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Something went wrong'),
    onSettled: () => { setBusy(null); setDel(null) },
  })

  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!domain.trim()) return
    m.mutate({ action: 'add', domain, method })
  }
  const s = q.data
  const typed = normaliseDomain(domain)

  return (
    <div className="space-y-6">
      <Section title="Website address" icon={<Globe className="h-4 w-4" />}
        description="The domain your website, patient portal and staff dashboard open on. SSL certificates are issued and renewed automatically.">
        {q.isPending ? (
          <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
        ) : q.isError ? (
          <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{q.error instanceof Error ? q.error.message : 'Could not load domains.'}</p>
        ) : !s?.domains.length ? (
          <EmptyState icon={<Globe className="h-6 w-6" />} title="No domain connected yet"
            description={s?.canManage ? 'Add the hospital’s domain below.' : `Ask the ${platformName} team to connect your domain (for example www.yourhospital.in).`} />
        ) : (
          <ul className="space-y-3">
            {s.domains.map((d) => <DomainCard key={d.domain} d={d} state={s} busy={busy} run={(a) => m.mutate(a)} onRemove={() => setDel(d.domain)} />)}
          </ul>
        )}
        {s && !s.canManage && (
          <p className="mt-4 text-xs text-slate-500">Domains are connected by the {platformName} team. To use a new domain, send them the address — they’ll give you the one DNS record to add.</p>
        )}
      </Section>

      {s?.canManage && (
        <Section title="Connect a domain" icon={<Plus className="h-4 w-4" />}
          description={s.cloudflare
            ? 'Registers the domain with Cloudflare for SaaS. The hospital then adds one CNAME record; the certificate follows automatically.'
            : 'Cloudflare isn’t configured on the server (CF_API_TOKEN / CF_ZONE_ID), so domains are added as manual — set DNS and SSL up on the server yourself.'}>
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <Field label="Domain" hint={typed && looksLikeApex(typed) ? `Root domains can’t use a CNAME at most providers — consider www.${typed}` : `e.g. www.yourhospital.in or name.${s.platform}`}>
              <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="www.yourhospital.in" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </Field>
            {s.cloudflare && (
              <Field label="Method">
                <Select value={method} onChange={(e) => setMethod(e.target.value as 'cloudflare' | 'manual')}>
                  <option value="cloudflare">Cloudflare (automatic SSL)</option>
                  <option value="manual">Manual</option>
                </Select>
              </Field>
            )}
            <Button type="submit" icon={<Plus className="h-4 w-4" />} loading={m.isPending && busy?.startsWith('add:')} disabled={!domain.trim()}>Add domain</Button>
          </form>
          <p className={cn('mt-3 text-xs text-slate-500')}>Sub-domains of {s.platform} work straight away (they’re served by the platform’s own wildcard).</p>
        </Section>
      )}

      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && m.mutate({ action: 'remove', domain: del })} loading={busy === `remove:${del}`}
        title={`Remove ${del}?`} confirmLabel="Remove domain"
        description="The website stops opening on this address. Its Cloudflare hostname and certificate are deleted too. You can add it again later." />
    </div>
  )
}
