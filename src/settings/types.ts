import type { Role } from '../types'
import { THEME_PALETTES, type ThemeId } from './palettes'

// ------------------------------------------------------------------ notifications
export type Channel = 'sms' | 'whatsapp' | 'email' | 'push'
export const CHANNELS: Channel[] = ['sms', 'whatsapp', 'email', 'push']
export const CHANNEL_LABEL: Record<Channel, string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email', push: 'Push (FCM)' }
export type NotifyEvent =
  | 'otp' | 'password_otp' | 'appointment_booked' | 'appointment_reminder' | 'appointment_rescheduled' | 'appointment_cancelled'
  | 'invoice_created' | 'payment_received' | 'lab_report_ready' | 'feedback_request' | 'staff_invite'
  | 'account_created' | 'account_updated' | 'account_deleted' | 'password_changed' | 'notice_published'

export interface EventTemplate {
  /** SMS / WhatsApp text (and email body). Tokens like {name} are replaced. */
  text: string
  subject: string
  /** Approved WhatsApp template name (Meta / Interakt). Empty = send plain text (only works inside a 24h chat window). */
  waTemplate: string
  /** Optional WhatsApp-only wording (*bold*, emoji, line breaks). Empty = `text` is used on WhatsApp too.
   *  Sent as-is by OpenWA / Twilio / webhook; with Meta / Interakt it is used when no approved template is set. */
  waText?: string
  /** Comma-separated tokens that fill the WhatsApp template's {{1}}, {{2}}… in order. */
  waParams: string
  /** DLT template ID (India) — used by MSG91 flows and Fast2SMS DLT route. */
  smsTemplateId: string
  /** Short push-notification body (title = subject). Empty = `text`. */
  pushText?: string
}

export const EVENTS: { id: NotifyEvent; label: string; hint: string; channels: Channel[]; tokens: string[] }[] = [
  { id: 'otp', label: 'Booking OTP', hint: 'One-time code when a patient books online', channels: ['sms', 'whatsapp'], tokens: ['code', 'hospital'] },
  { id: 'password_otp', label: 'Password reset OTP', hint: '"Forgot password → Use mobile" on the sign-in page', channels: ['sms', 'whatsapp'], tokens: ['code', 'hospital'] },
  { id: 'appointment_booked', label: 'Appointment booked', hint: 'Online, portal and desk bookings', channels: ['sms', 'whatsapp', 'email'], tokens: ['name', 'doctor', 'date', 'time', 'ref', 'hospital', 'hospital_phone', 'address'] },
  { id: 'appointment_reminder', label: 'Appointment reminder', hint: 'Day before the visit (queued daily)', channels: ['sms', 'whatsapp', 'email'], tokens: ['name', 'doctor', 'date', 'time', 'ref', 'hospital', 'hospital_phone', 'address'] },
  { id: 'appointment_rescheduled', label: 'Appointment rescheduled', hint: 'Date or time changed', channels: ['sms', 'whatsapp', 'email'], tokens: ['name', 'doctor', 'date', 'time', 'ref', 'hospital', 'hospital_phone'] },
  { id: 'appointment_cancelled', label: 'Appointment cancelled', hint: 'Status set to cancelled', channels: ['sms', 'whatsapp', 'email'], tokens: ['name', 'doctor', 'date', 'time', 'ref', 'hospital', 'hospital_phone'] },
  { id: 'invoice_created', label: 'Invoice created', hint: 'New unpaid bill', channels: ['sms', 'whatsapp', 'email'], tokens: ['name', 'invoice', 'amount', 'due_date', 'hospital', 'hospital_phone'] },
  { id: 'payment_received', label: 'Payment received', hint: 'Receipt after a payment is recorded', channels: ['sms', 'whatsapp', 'email'], tokens: ['name', 'invoice', 'amount', 'method', 'hospital'] },
  { id: 'lab_report_ready', label: 'Lab report ready', hint: 'Lab test marked completed', channels: ['sms', 'whatsapp', 'email'], tokens: ['name', 'test', 'hospital', 'hospital_phone'] },
  { id: 'feedback_request', label: 'Feedback request', hint: 'After a visit is marked completed (needs the website address)', channels: ['sms', 'whatsapp', 'email'], tokens: ['name', 'doctor', 'link', 'hospital'] },
  { id: 'staff_invite', label: 'Staff invitation', hint: 'Owner invites a team member from Users & Roles', channels: ['sms', 'whatsapp', 'email'], tokens: ['name', 'role', 'link', 'hospital'] },
  { id: 'account_created', label: 'Account created', hint: 'Welcome message when an account is created (sign-up, invitation or Settings → Users)', channels: ['sms', 'whatsapp', 'email', 'push'], tokens: ['name', 'role', 'email', 'link', 'hospital'] },
  { id: 'account_updated', label: 'Account updated', hint: 'Role, e-mail or mobile number changed', channels: ['sms', 'whatsapp', 'email', 'push'], tokens: ['name', 'role', 'changes', 'link', 'hospital'] },
  { id: 'account_deleted', label: 'Account deleted', hint: 'Sign-in removed by the owner (records are kept)', channels: ['sms', 'whatsapp', 'email'], tokens: ['name', 'role', 'email', 'hospital', 'hospital_phone'] },
  { id: 'password_changed', label: 'Password changed', hint: 'Security alert after any password change', channels: ['sms', 'whatsapp', 'email', 'push'], tokens: ['name', 'time', 'link', 'hospital', 'hospital_phone'] },
  { id: 'notice_published', label: 'New notice', hint: 'A notice is posted on the Notice Board (sent to its audience)', channels: ['sms', 'whatsapp', 'email', 'push'], tokens: ['name', 'title', 'notice', 'priority', 'link', 'hospital'] },
]

/** Events that only make sense on some channels (others are greyed out in the matrix). */
export const eventChannels = (id: NotifyEvent): Channel[] => EVENTS.find((e) => e.id === id)?.channels ?? []

const T = (text: string, subject: string, waTemplate = '', waParams = '', waText = ''): EventTemplate => ({ text, subject, waTemplate, waParams, smsTemplateId: '', waText })
export const DEFAULT_TEMPLATES: Record<NotifyEvent, EventTemplate> = {
  otp: T('{code} is your {hospital} booking code. It is valid for 10 minutes. Do not share it with anyone.', 'Your booking code', '', 'code',
    '🔐 *{code}* is your {hospital} verification code.\n\nIt is valid for 10 minutes. Do not share it with anyone — our staff will never ask for it.'),
  password_otp: T('{code} is your {hospital} password reset code. It is valid for 10 minutes. If you did not ask for it, ignore this message.', 'Your password reset code', '', 'code',
    '🔑 *{code}* is your {hospital} password reset code.\n\nIt is valid for 10 minutes. Didn\'t ask for it? Ignore this message — your password stays the same.'),
  appointment_booked: T('Hi {name}, your appointment with {doctor} is confirmed for {date} at {time}. Ref {ref}. Please arrive 15 min early. {hospital} {hospital_phone}', 'Appointment confirmed — {date} at {time}', '', 'name,doctor,date,time,ref',
    '✅ *Appointment confirmed*\n\nHi {name},\n🩺 {doctor}\n🗓 {date} at {time}\n🔖 Ref: *{ref}*\n\nPlease arrive 15 minutes early with a photo ID. Pay at the reception.\n📍 {address}\n📞 {hospital_phone}\n\n— {hospital}'),
  appointment_reminder: T('Reminder: {name}, you have an appointment with {doctor} tomorrow, {date} at {time}. Ref {ref}. {hospital} {hospital_phone}', 'Reminder: your appointment tomorrow at {time}', '', 'name,doctor,date,time',
    '⏰ *Reminder*\n\nHi {name}, you have an appointment *tomorrow*.\n🩺 {doctor}\n🗓 {date} at {time}\n🔖 Ref: {ref}\n\nNeed to change it? Call {hospital_phone}.\n— {hospital}'),
  appointment_rescheduled: T('Hi {name}, your appointment with {doctor} has been moved to {date} at {time}. Ref {ref}. Call {hospital_phone} if this does not suit you. {hospital}', 'Your appointment has been rescheduled', '', 'name,doctor,date,time',
    '🔁 *Appointment rescheduled*\n\nHi {name}, your visit with {doctor} is now on\n🗓 *{date} at {time}*\n🔖 Ref: {ref}\n\nCall {hospital_phone} if this does not suit you.\n— {hospital}'),
  appointment_cancelled: T('Hi {name}, your appointment with {doctor} on {date} at {time} has been cancelled. Call {hospital_phone} to rebook. {hospital}', 'Your appointment was cancelled', '', 'name,doctor,date,time',
    '❌ *Appointment cancelled*\n\nHi {name}, your visit with {doctor} on {date} at {time} has been cancelled.\n\nTo book again, call {hospital_phone} or reply *1* here.\n— {hospital}'),
  invoice_created: T('Hi {name}, invoice {invoice} for {amount} has been generated at {hospital}. Due {due_date}.', 'Invoice {invoice} from {hospital}', '', 'name,invoice,amount'),
  payment_received: T('Thank you {name}. We received {amount} by {method} against invoice {invoice}. {hospital}', 'Payment received — {amount}', '', 'name,amount,invoice'),
  lab_report_ready: T('Hi {name}, your {test} report is ready. View it in the patient portal or collect it from the lab. {hospital} {hospital_phone}', 'Your {test} report is ready', '', 'name,test'),
  feedback_request: T('Hi {name}, thank you for visiting {doctor} at {hospital}. How was your experience? Rate us in 10 seconds: {link}', 'How was your visit to {hospital}?', '', 'name,doctor,link'),
  staff_invite: T('Hi {name}, you are invited to join {hospital} as {role}. Create your account here: {link} (valid 14 days)', 'You are invited to join {hospital}', '', 'name,role,link'),
  account_created: { ...T('Welcome to {hospital}, {name}! Your {role} account is ready. Sign in at {link} with {email}.', 'Welcome to {hospital}', '', 'name,role,link',
    '👋 *Welcome to {hospital}*\n\nHi {name}, your *{role}* account is ready.\nSign in: {link}\nE-mail: {email}'), pushText: 'Your {role} account is ready. Welcome aboard!' },
  account_updated: { ...T('Hi {name}, your {hospital} account was updated ({changes}). If this was not you, call {hospital_phone}.', 'Your {hospital} account was updated', '', 'name,changes'),
    pushText: 'Your account was updated: {changes}' },
  account_deleted: T('Hi {name}, your {hospital} sign-in ({email}) has been removed. Your medical records are kept safely. Questions? Call {hospital_phone}.', 'Your {hospital} account was removed', '', 'name,email'),
  password_changed: { ...T('Hi {name}, your {hospital} password was changed on {time}. Not you? Reset it now: {link} or call {hospital_phone}.', 'Your password was changed', '', 'name,time,link'),
    pushText: 'Your password was changed on {time}. Not you? Reset it right away.' },
  notice_published: { ...T('{hospital} notice: {title}. {notice} — {link}', '📌 {title}', '', 'title,notice', '📌 *{title}*\n\n{notice}\n\nRead on the notice board: {link}\n— {hospital}'),
    pushText: '{notice}' },
}

export type EmailProvider = 'resend' | 'sendgrid' | 'smtp'
export type SmsProvider = 'msg91' | 'twilio' | 'fast2sms' | 'webhook'
/** openwa = self-hosted OpenWA / WA CRM gateway (WhatsApp Web session, free text, no templates) */
export type WhatsappProvider = 'openwa' | 'meta' | 'twilio' | 'interakt' | 'webhook'

export interface NotificationSettings {
  email: { enabled: boolean; provider: EmailProvider; fromName: string; fromEmail: string; replyTo: string; smtpHost: string; smtpPort: number; smtpSecure: boolean; smtpUser: string }
  sms: { enabled: boolean; provider: SmsProvider; senderId: string; dltEntityId: string; twilioAccountSid: string; twilioFrom: string; webhookUrl: string }
  whatsapp: { enabled: boolean; provider: WhatsappProvider; phoneNumberId: string; businessAccountId: string; language: string; twilioAccountSid: string; twilioFrom: string; webhookUrl: string
    /** OpenWA / WA CRM: gateway origin (e.g. https://wacrm.example.in) and the WhatsApp session ID */
    openwaUrl: string; openwaSession: string
    /** How a mobile number becomes a chat ID. {phone} = 10-digit number. Default 91{phone}@c.us */
    chatIdFormat: string
    /** answer incoming chats with the booking bot (supabase/functions/whatsapp-bot) */
    botEnabled: boolean }
  /** Firebase Cloud Messaging: the web-app config (public) — the service-account JSON is a write-only secret */
  push: { enabled: boolean; apiKey: string; authDomain: string; projectId: string; messagingSenderId: string; appId: string; vapidKey: string }
  /** ₹ per message, only used to estimate the messaging bill in the usage report */
  rates: Record<Channel, number>
  events: Record<NotifyEvent, Partial<Record<Channel, boolean>>>
  templates: Record<NotifyEvent, EventTemplate>
}

/** Secret keys stored write-only (app_secrets). Never readable from the browser in Supabase mode. */
export const SECRET_FIELDS: Record<string, { label: string; placeholder: string }> = {
  resend_api_key: { label: 'Resend API key', placeholder: 're_…' },
  sendgrid_api_key: { label: 'SendGrid API key', placeholder: 'SG.…' },
  smtp_password: { label: 'SMTP password / app password', placeholder: '••••••••' },
  msg91_auth_key: { label: 'MSG91 auth key', placeholder: '4xxxxxxxxxxxxxxxxxxxxxx' },
  twilio_auth_token: { label: 'Twilio auth token', placeholder: '32-character token' },
  fast2sms_api_key: { label: 'Fast2SMS API key', placeholder: 'API authorization key' },
  sms_webhook_secret: { label: 'Webhook bearer token (optional)', placeholder: 'Sent as Authorization: Bearer …' },
  meta_access_token: { label: 'Meta permanent access token', placeholder: 'EAAG…' },
  interakt_api_key: { label: 'Interakt API key', placeholder: 'Base64 key from Interakt → Settings → Developer' },
  whatsapp_webhook_secret: { label: 'Webhook bearer token (optional)', placeholder: 'Sent as Authorization: Bearer …' },
  whatsapp_verify_token: { label: 'Chatbot webhook verify token', placeholder: 'Any long random text — paste the same in Meta → Webhooks' },
  meta_app_secret: { label: 'Meta app secret (signs incoming webhooks)', placeholder: 'App settings → Basic → App secret' },
  openwa_api_key: { label: 'WA CRM / OpenWA API key', placeholder: 'owa_k1_…  (operator role is enough)' },
  openwa_webhook_secret: { label: 'OpenWA webhook secret (signs incoming messages)', placeholder: 'Same secret you set on the OpenWA webhook' },
  fcm_service_account: { label: 'Firebase service-account JSON', placeholder: 'Paste the whole JSON (Project settings → Service accounts → Generate new private key)' },
  service_role_key: { label: 'Supabase service-role key (for the scheduler)', placeholder: 'eyJhbGci…  (Project settings → API → service_role)' },
}

// ------------------------------------------------------------------ dashboard
export const DASHBOARD_WIDGETS: Partial<Record<Role, string[]>> = {
  owner: ['Revenue (this month)', 'Total patients', "Today's appointments", 'Bed occupancy', 'Revenue vs expenses', 'Appointments by department', "Today's appointments list", 'Patient flow', 'Low stock alerts', 'Current admissions', 'Outstanding invoices', 'Messaging usage'],
  doctor: ["Today's patients", 'In waiting room', 'Completed (7 days)', 'Pending lab results', "Today's queue", 'My in-patients', 'Upcoming appointments', 'Pending lab results list', 'Follow-ups due'],
  receptionist: ["Today's appointments", 'Checked in', 'New patients (7d)', 'Available beds', "Today's schedule", 'Bed availability'],
  accountant: ['Collected (month)', 'Outstanding', 'Expenses (month)', 'Net (month)', 'Cash flow', 'Collections by method', 'Overdue invoices', 'Recent payments', 'Messaging usage'],
  staff: ['Admitted patients', 'Pending lab tests', 'Low stock items', 'Beds available', 'Lab work queue', 'Low stock', 'Ward patients'],
  patient: ['Upcoming visits', 'Prescriptions', 'Lab reports', 'Amount due', 'Recent prescriptions', 'Lab reports list', 'Hospital notices'],
}

// ------------------------------------------------------------------ settings
export interface AppSettings {
  appearance: {
    theme: ThemeId
    customColor: string
    sidebar: 'dark' | 'light' | 'brand'
    size: 'compact' | 'default' | 'large'
    radius: 'sharp' | 'default' | 'round'
  }
  dashboard: {
    /** `${role}:${widget}` keys that are hidden */
    hidden: string[]
    showGreeting: boolean
  }
  /** nav paths hidden for everyone (owner can still open them) */
  modules: { hidden: string[] }
  announcement: { enabled: boolean; text: string; tone: 'info' | 'warning' | 'success' | 'danger'; audience: 'everyone' | 'staff' | 'patients'; link: string }
  locale: { dateFormat: 'dd MMM yyyy' | 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd' | 'd MMMM yyyy'; timeFormat: '12h' | '24h'; weekStartsOn: 0 | 1 }
  security: { idleTimeoutMinutes: number }
  notifications: NotificationSettings
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  appearance: { theme: 'periwinkle', customColor: '#5c5c99', sidebar: 'dark', size: 'default', radius: 'default' },
  dashboard: { hidden: [], showGreeting: true },
  modules: { hidden: [] },
  announcement: { enabled: false, text: '', tone: 'info', audience: 'staff', link: '' },
  locale: { dateFormat: 'dd MMM yyyy', timeFormat: '12h', weekStartsOn: 1 },
  security: { idleTimeoutMinutes: 0 },
  notifications: {
    email: { enabled: false, provider: 'resend', fromName: 'DC Hospital', fromEmail: '', replyTo: '', smtpHost: '', smtpPort: 465, smtpSecure: true, smtpUser: '' },
    sms: { enabled: false, provider: 'msg91', senderId: '', dltEntityId: '', twilioAccountSid: '', twilioFrom: '', webhookUrl: '' },
    whatsapp: { enabled: false, provider: 'openwa', phoneNumberId: '', businessAccountId: '', language: 'en', twilioAccountSid: '', twilioFrom: '', webhookUrl: '', openwaUrl: '', openwaSession: '', chatIdFormat: '91{phone}@c.us', botEnabled: false },
    push: { enabled: false, apiKey: '', authDomain: '', projectId: '', messagingSenderId: '', appId: '', vapidKey: '' },
    rates: { sms: 0.25, whatsapp: 0.8, email: 0.05, push: 0 },
    events: {
      otp: { sms: true, whatsapp: true },
      password_otp: { sms: true, whatsapp: true },
      appointment_booked: { sms: true, whatsapp: true, email: true },
      appointment_reminder: { sms: true, whatsapp: true, email: false },
      appointment_rescheduled: { sms: true, whatsapp: true, email: true },
      appointment_cancelled: { sms: true, whatsapp: false, email: true },
      invoice_created: { sms: false, whatsapp: false, email: true },
      payment_received: { sms: false, whatsapp: false, email: true },
      lab_report_ready: { sms: true, whatsapp: true, email: false },
      feedback_request: { sms: true, whatsapp: true, email: true },
      staff_invite: { sms: false, whatsapp: true, email: true },
      account_created: { sms: false, whatsapp: true, email: true, push: false },
      account_updated: { sms: false, whatsapp: false, email: true, push: true },
      account_deleted: { sms: false, whatsapp: false, email: true },
      password_changed: { sms: true, whatsapp: false, email: true, push: true },
      notice_published: { sms: false, whatsapp: false, email: false, push: true },
    },
    templates: DEFAULT_TEMPLATES,
  },
}

// ------------------------------------------------------------------ theme helpers
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
const toRgb = (hex: string) => { const h = hex.replace('#', '').padEnd(6, '0'); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0) }
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

/** Build an 11-shade palette where the picked colour becomes shade 600. */
export function paletteFromHex(hex: string): Record<string, string> {
  const base = toRgb(/^#?[0-9a-f]{6}$/i.test(hex) ? hex : '#5c5c99')
  const white = [255, 255, 255], black = [8, 8, 20]
  const t: Record<number, [number[], number]> = {
    50: [white, 0.95], 100: [white, 0.9], 200: [white, 0.78], 300: [white, 0.62], 400: [white, 0.4], 500: [white, 0.18],
    600: [base, 0], 700: [black, 0.15], 800: [black, 0.3], 900: [black, 0.45], 950: [black, 0.62],
  }
  return Object.fromEntries(SHADES.map((s) => [s, mix(base, t[s][0], t[s][1]).join(' ')]))
}
export function paletteFor(a: AppSettings['appearance']): Record<string, string> {
  return a.theme === 'custom' ? paletteFromHex(a.customColor) : (THEME_PALETTES[a.theme] ?? THEME_PALETTES.periwinkle) as unknown as Record<string, string>
}
export const rgbToHex = (triplet: string) => '#' + triplet.split(' ').map((n) => Number(n).toString(16).padStart(2, '0')).join('')
