/**
 * The platform's own accounts (Platform settings → Integrations): Razorpay for hospitals paying the platform, and the
 * shared accounts Hospital Comrade sends through (team alerts, broadcasts, hospitals on "use Hospital Comrade's
 * account"). Every field is a PLATFORM_* name read by supabase/functions/_shared/platform.ts; `secret` ones are saved
 * write-only (Vault) and never shown again.
 */
export interface AccountField { key: string; label: string; placeholder?: string; hint?: string; secret?: boolean; multiline?: boolean; upper?: boolean }
export interface AccountProvider { label: string; fields: AccountField[]; help?: string }
export type IntegrationId = 'razorpay' | 'sms' | 'whatsapp' | 'email' | 'push'
/** providerKey: the setting that picks the provider; without one the single provider is always used and `primaryKey` says "set up" */
export interface AccountSpec { channel: IntegrationId; title: string; blurb: string; providerKey?: string; primaryKey?: string; common?: AccountField[]; providers: Record<string, AccountProvider> }

export const ACCOUNTS: AccountSpec[] = [
  {
    channel: 'razorpay', title: 'Razorpay', blurb: 'Hospitals pay their plan and wallet top-ups online. Money goes to your Razorpay account.', primaryKey: 'PLATFORM_RAZORPAY_KEY_ID',
    providers: {
      razorpay: { label: 'Razorpay', help: 'Razorpay Dashboard → Account & Settings → API keys. Use rzp_test_ keys to try it, rzp_live_ keys to collect real money.', fields: [
        { key: 'PLATFORM_RAZORPAY_KEY_ID', label: 'Key ID', placeholder: 'rzp_live_…', hint: 'Public — shown to the browser at checkout' },
        { key: 'PLATFORM_RAZORPAY_KEY_SECRET', label: 'Key secret', secret: true, placeholder: 'From the same screen as the key ID' },
        { key: 'PLATFORM_RAZORPAY_WEBHOOK_SECRET', label: 'Webhook secret', secret: true, placeholder: 'The secret you type when adding the webhook', hint: 'Confirms payments even when the hospital closes the browser early' },
      ] },
    },
  },
  {
    channel: 'sms', title: 'SMS', blurb: 'DLT-registered SMS for OTPs and reminders on the shared account.', providerKey: 'PLATFORM_SMS_PROVIDER',
    common: [
      { key: 'PLATFORM_SMS_SENDER_ID', label: 'Sender ID', placeholder: 'HCOMRD', hint: '6 letters, approved on DLT', upper: true },
      { key: 'PLATFORM_DLT_ENTITY_ID', label: 'DLT entity ID', placeholder: '1201…' },
    ],
    providers: {
      msg91: { label: 'MSG91', fields: [{ key: 'PLATFORM_MSG91_AUTH_KEY', label: 'MSG91 auth key', secret: true, placeholder: '4xxxxxxxxxxxxxxxxxxxxxx' }] },
      fast2sms: { label: 'Fast2SMS', fields: [{ key: 'PLATFORM_FAST2SMS_API_KEY', label: 'Fast2SMS API key', secret: true, placeholder: 'API authorization key' }] },
    },
  },
  {
    channel: 'whatsapp', title: 'WhatsApp', blurb: 'Approved templates for messages to patients, hospitals and your team.', providerKey: 'PLATFORM_WHATSAPP_PROVIDER',
    common: [
      { key: 'PLATFORM_WHATSAPP_NUMBER', label: 'WhatsApp number (shown to hospitals)', placeholder: '+91 98xxxxxxxx' },
      { key: 'PLATFORM_WHATSAPP_LANGUAGE', label: 'Template language', placeholder: 'en' },
    ],
    providers: {
      aisensy: { label: 'AiSensy', fields: [
        { key: 'PLATFORM_AISENSY_API_KEY', label: 'AiSensy API key', secret: true, placeholder: 'eyJ…' },
        { key: 'PLATFORM_AISENSY_TEST_CAMPAIGN', label: 'Campaign for test messages', placeholder: 'hc_test', hint: 'A live API campaign with no parameters' },
      ] },
      meta: { label: 'Meta Cloud API', fields: [
        { key: 'PLATFORM_META_PHONE_NUMBER_ID', label: 'Phone number ID', placeholder: '1234567890' },
        { key: 'PLATFORM_META_ACCESS_TOKEN', label: 'Permanent access token', secret: true, placeholder: 'EAAG…' },
      ] },
      msg91: { label: 'MSG91 WhatsApp', fields: [
        { key: 'PLATFORM_MSG91_WA_NUMBER', label: 'Integrated number', placeholder: '9198xxxxxxxx' },
        { key: 'PLATFORM_MSG91_WA_NAMESPACE', label: 'Template namespace', placeholder: 'xxxxxxxx_xxxx_…' },
        { key: 'PLATFORM_MSG91_AUTH_KEY', label: 'MSG91 auth key (same as SMS)', secret: true },
      ] },
      openwa: { label: 'WA CRM / OpenWA', help: 'Free text, no templates — fine for your own team, not for bulk marketing.', fields: [
        { key: 'PLATFORM_OPENWA_URL', label: 'OpenWA address', placeholder: 'https://wa.example.com' },
        { key: 'PLATFORM_OPENWA_SESSION', label: 'Session ID', placeholder: 'default' },
        { key: 'PLATFORM_OPENWA_CHAT_ID_FORMAT', label: 'Chat ID format (optional)', placeholder: '91{phone}@c.us' },
        { key: 'PLATFORM_OPENWA_API_KEY', label: 'API key', secret: true, placeholder: 'owa_k1_…' },
      ] },
    },
  },
  {
    channel: 'email', title: 'E-mail', blurb: 'Alerts, broadcasts and hospital e-mails on the shared account.', providerKey: 'PLATFORM_EMAIL_PROVIDER',
    common: [{ key: 'PLATFORM_EMAIL_FROM', label: 'From address', placeholder: 'alerts@hospital.digitalcomrade.in', hint: 'On a domain verified with the provider' }],
    providers: {
      resend: { label: 'Resend', fields: [{ key: 'PLATFORM_RESEND_API_KEY', label: 'Resend API key', secret: true, placeholder: 're_…' }] },
      sendgrid: { label: 'SendGrid', fields: [{ key: 'PLATFORM_SENDGRID_API_KEY', label: 'SendGrid API key', secret: true, placeholder: 'SG.…' }] },
    },
  },
  {
    channel: 'push', title: 'Browser push (Firebase)', primaryKey: 'PLATFORM_FCM_PROJECT_ID', blurb: 'Notifications to the control-panel team’s browsers. The web config is public; the service account is secret.',
    providers: {
      firebase: { label: 'Firebase Cloud Messaging', help: 'Firebase console → Project settings → General (web app) and Cloud Messaging → Web push certificates.', fields: [
        { key: 'PLATFORM_FCM_PROJECT_ID', label: 'Project ID', placeholder: 'hospital-comrade' },
        { key: 'PLATFORM_FCM_API_KEY', label: 'Web API key', placeholder: 'AIza…' },
        { key: 'PLATFORM_FCM_SENDER_ID', label: 'Messaging sender ID', placeholder: '1234567890' },
        { key: 'PLATFORM_FCM_APP_ID', label: 'App ID', placeholder: '1:123:web:abc' },
        { key: 'PLATFORM_FCM_VAPID_KEY', label: 'VAPID key (web push certificate)', placeholder: 'BP…' },
        { key: 'PLATFORM_FCM_SERVICE_ACCOUNT', label: 'Service-account JSON', secret: true, multiline: true, placeholder: 'Paste the whole JSON (Service accounts → Generate new private key)' },
      ] },
    },
  },
]

/** the provider currently picked for a card ('' = not set up) */
export const providerOf = (spec: AccountSpec, settings: Record<string, string>) =>
  spec.providerKey ? (settings[spec.providerKey] ?? '').toLowerCase() : Object.keys(spec.providers)[0]

/** saved in the panel? (a provider picked, or the single provider's main field filled) */
export const isSetUp = (spec: AccountSpec, settings: Record<string, string>) =>
  spec.providerKey ? !!providerOf(spec, settings) : !!(settings[spec.primaryKey ?? ''] ?? '').trim()

/** every key name a card can use (for "saved in the panel / Edge secret") */
export const keysOf = (spec: AccountSpec) => [...new Set([...(spec.providerKey ? [spec.providerKey] : []), ...(spec.common ?? []).map((f) => f.key),
  ...Object.values(spec.providers).flatMap((p) => p.fields.map((f) => f.key))])]

/** Razorpay key mode from its prefix */
export const keyMode = (keyId: string) => (keyId.startsWith('rzp_live_') ? 'live' : keyId.startsWith('rzp_test_') ? 'test' : null)

/** fields shown for a provider */
export const fieldsFor = (spec: AccountSpec, provider: string): AccountField[] =>
  provider && spec.providers[provider] ? [...(spec.common ?? []), ...spec.providers[provider].fields] : []

/**
 * What to send to cp_save_messaging_setup for one card: changed plain settings (incl. the provider), new keys and
 * keys marked for removal (''). Untouched key inputs (empty) are left alone.
 */
export function diffAccount(spec: AccountSpec, saved: Record<string, string>, draft: Record<string, string>, keys: Record<string, string>, remove: string[]) {
  const settings: Record<string, string> = {}
  const secrets: Record<string, string> = {}
  const provider = spec.providerKey ? (draft[spec.providerKey] ?? '') : Object.keys(spec.providers)[0]
  if (spec.providerKey && (saved[spec.providerKey] ?? '') !== provider) settings[spec.providerKey] = provider
  for (const f of fieldsFor(spec, provider)) {
    if (f.secret) {
      const v = (keys[f.key] ?? '').trim()
      if (v) secrets[f.key] = v
      else if (remove.includes(f.key)) secrets[f.key] = ''
    } else {
      const v = (draft[f.key] ?? '').trim()
      if (v !== (saved[f.key] ?? '')) settings[f.key] = f.upper ? v.toUpperCase() : v
    }
  }
  return { settings, secrets }
}
