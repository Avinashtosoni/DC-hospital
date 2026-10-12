import type { ReactNode } from 'react'
import { BellRing, Mail, MessageCircle, Smartphone } from 'lucide-react'
import type { Channel } from '../../../settings/types'

export const CHANNEL_META: Record<Channel, { label: string; icon: ReactNode; to: string; toLabel: string }> = {
  sms: { label: 'SMS', icon: <Smartphone className="h-4 w-4" />, to: 'phone', toLabel: 'Mobile number' },
  whatsapp: { label: 'WhatsApp', icon: <MessageCircle className="h-4 w-4" />, to: 'phone', toLabel: 'WhatsApp number' },
  email: { label: 'Email', icon: <Mail className="h-4 w-4" />, to: 'email', toLabel: 'Email address' },
  push: { label: 'Push (FCM)', icon: <BellRing className="h-4 w-4" />, to: 'device', toLabel: 'Your devices' },
}
