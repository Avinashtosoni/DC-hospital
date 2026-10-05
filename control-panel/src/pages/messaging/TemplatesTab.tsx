import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge, Button, Card, Input } from '../../../../src/components/ui'
import { EVENTS } from '../../../../src/settings/types'
import { cp, friendly } from '../../api'
import type { MessagingSetup, PlatformTemplateIds } from '../../types'

/** platform messages + every hospital event that can go out on the shared accounts */
export const TEMPLATE_EVENTS: { id: string; label: string; hint: string; tokens: string[] }[] = [
  { id: 'platform_alert', label: 'Team alert', hint: 'Alerts to your own team (WhatsApp / SMS)', tokens: ['title', 'body', 'link'] },
  { id: 'platform_broadcast', label: 'Broadcast', hint: 'Broadcasts to hospital owners and staff', tokens: ['name', 'hospital', 'title', 'link'] },
  ...EVENTS.map((e) => ({ id: e.id, label: e.label, hint: e.hint, tokens: e.tokens })),
]

/**
 * WhatsApp template names + parameter order and DLT template IDs approved on the SHARED accounts. A hospital's own
 * wording is kept; only the IDs come from here (a hospital's own registration wins).
 */
export function TemplatesTab({ setup }: { setup: MessagingSetup }) {
  const qc = useQueryClient()
  const [t, setT] = useState<Record<string, PlatformTemplateIds>>(() => structuredClone(setup.templates ?? {}))
  const dirty = JSON.stringify(t) !== JSON.stringify(setup.templates ?? {})
  const save = useMutation({
    mutationFn: () => cp.saveTemplates(t),
    onSuccess: (templates) => { qc.setQueryData(['cp-messaging-setup'], { ...setup, templates }); setT(structuredClone(templates)); toast.success('Templates saved') },
    onError: (e) => toast.error(friendly(e)),
  })
  const set = (id: string, k: keyof PlatformTemplateIds, v: string) => setT({ ...t, [id]: { ...(t[id] ?? {}), [k]: v } })
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
        <p className="min-w-0 flex-1 text-sm text-slate-600">Approved IDs per message. <span className="text-slate-500">WhatsApp parameters are the variable names in order, e.g. <code className="rounded bg-slate-100 px-1">name,doctor,date</code>.</span></p>
        <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save templates</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-2.5">Message</th><th className="px-3 py-2.5">WhatsApp template</th><th className="px-3 py-2.5">WhatsApp parameters</th><th className="px-3 py-2.5">SMS DLT template ID</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {TEMPLATE_EVENTS.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="px-4 py-3">
                  <p className="font-medium text-brand-950">{e.label} {e.id.startsWith('platform_') && <Badge tone="violet" className="ml-1">platform</Badge>}</p>
                  <p className="text-xs text-slate-500">{e.hint}</p>
                  <p className="mt-1 font-mono text-[11px] text-slate-400">{e.tokens.join(' · ')}</p>
                </td>
                <td className="px-3 py-3"><Input value={t[e.id]?.waTemplate ?? ''} placeholder="template_name" maxLength={120} onChange={(x) => set(e.id, 'waTemplate', x.target.value)} /></td>
                <td className="px-3 py-3"><Input value={t[e.id]?.waParams ?? ''} placeholder={e.tokens.slice(0, 3).join(',')} maxLength={300} onChange={(x) => set(e.id, 'waParams', x.target.value)} /></td>
                <td className="px-3 py-3"><Input value={t[e.id]?.smsTemplateId ?? ''} placeholder="1207…" maxLength={40} onChange={(x) => set(e.id, 'smsTemplateId', x.target.value.replace(/\s/g, ''))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
