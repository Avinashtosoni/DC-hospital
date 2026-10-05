/**
 * Messaging (admin; support sees the delivery log): the shared SMS / WhatsApp / e-mail / push accounts, their
 * approved template IDs, test sends and every message from every hospital.
 */
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { PageHeader, Skeleton, Tabs } from '../../../src/components/ui'
import { cp } from '../api'
import { ErrorBox, isAdmin, useMe } from '../ui'
import { AccountsTab } from './messaging/AccountsTab'
import { TemplatesTab } from './messaging/TemplatesTab'
import { TestTab } from './messaging/TestTab'
import { DeliveryLogTab } from './messaging/DeliveryLogTab'

type Tab = 'accounts' | 'templates' | 'test' | 'log'

export function MessagingPage() {
  const { me } = useMe()
  const admin = isAdmin(me.role)
  const [sp, setSp] = useSearchParams()
  const tabs: { value: Tab; label: string }[] = admin
    ? [{ value: 'accounts', label: 'Shared accounts' }, { value: 'templates', label: 'Templates' }, { value: 'test', label: 'Test send' }, { value: 'log', label: 'Delivery log' }]
    : [{ value: 'log', label: 'Delivery log' }]
  const tab = (tabs.find((t) => t.value === sp.get('tab'))?.value ?? tabs[0].value) as Tab
  const setup = useQuery({ queryKey: ['cp-messaging-setup'], queryFn: () => cp.messagingSetup(), enabled: admin && (tab === 'accounts' || tab === 'templates') })
  return (
    <>
      <PageHeader title="Messaging" description="Hospital Comrade’s own SMS, WhatsApp, e-mail and push accounts — used for team alerts, broadcasts and hospitals that send through the platform." />
      <div className="mb-5"><Tabs tabs={tabs} value={tab} onChange={(v) => setSp(v === tabs[0].value ? {} : { tab: v }, { replace: true })} /></div>
      {(tab === 'accounts' || tab === 'templates') && (
        setup.error ? <ErrorBox error={setup.error} onRetry={() => setup.refetch()} /> : !setup.data ? <Skeleton className="h-72" />
          : tab === 'accounts' ? <AccountsTab setup={setup.data} /> : <TemplatesTab setup={setup.data} />
      )}
      {tab === 'test' && <TestTab />}
      {tab === 'log' && <DeliveryLogTab />}
    </>
  )
}
