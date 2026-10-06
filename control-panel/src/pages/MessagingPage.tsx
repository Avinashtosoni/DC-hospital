/**
 * Messaging: the template library (every message, with on/off, wording, locks and WhatsApp / DLT IDs) and every message from every hospital.
 * The accounts themselves (keys, checks, test sends) live in Platform settings → Integrations.
 */
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { PageHeader, Skeleton, Tabs } from '../../../src/components/ui'
import { cp } from '../api'
import { ErrorBox } from '../ui'
import { TemplateManager } from './messaging/TemplateManager'
import { DeliveryLogTab } from './messaging/DeliveryLogTab'

type Tab = 'templates' | 'log'
const TABS: { value: Tab; label: string }[] = [{ value: 'templates', label: 'Templates' }, { value: 'log', label: 'Delivery log' }]

export function MessagingPage() {
  const [sp, setSp] = useSearchParams()
  const asked = sp.get('tab')
  const tab = (TABS.find((t) => t.value === asked)?.value ?? 'templates') as Tab
  const setup = useQuery({ queryKey: ['cp-messaging-setup'], queryFn: () => cp.messagingSetup(), enabled: tab === 'templates' })
  // old links (Shared accounts / Test send) moved to Platform settings → Integrations
  if (asked === 'accounts' || asked === 'test') return <Navigate to="/settings?tab=integrations" replace />
  return (
    <>
      <PageHeader title="Messaging" description="Every message template — switch on/off, reword, lock, register — and the delivery log for every hospital."
        actions={<Link className="text-sm font-medium text-brand-700 hover:underline" to="/settings?tab=integrations">Accounts, keys & test sends → Integrations</Link>} />
      <div className="mb-5"><Tabs tabs={TABS} value={tab} onChange={(v) => setSp(v === 'templates' ? {} : { tab: v }, { replace: true })} /></div>
      {tab === 'templates' && (setup.error ? <ErrorBox error={setup.error} onRetry={() => setup.refetch()} /> : !setup.data ? <Skeleton className="h-72" /> : <TemplateManager setup={setup.data} />)}
      {tab === 'log' && <DeliveryLogTab />}
    </>
  )
}
