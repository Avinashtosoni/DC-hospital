import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlarmClock, BellRing, CheckCircle2, CircleAlert, ExternalLink, FileText, History, Mail, MessageCircle, MessageSquareText,
  PlugZap, RefreshCw, RotateCcw, Send, ServerCog, Smartphone, Bot, Copy,
} from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Badge, Button, Drawer, EmptyState, Field, Input, Skeleton, Textarea, type Tone } from '../../components/ui'
import { cn, fmtDate, fmtTime } from '../../lib/utils'
import { channelIssues, recipientProblem, settingsStore, type OutboxRow, type SecretStatus, type SendResult } from '../../settings/store'
import { DEFAULT_TEMPLATES, EVENTS, type AppSettings, type Channel, type NotifyEvent } from '../../settings/types'
import { useAuth } from '../../auth/AuthProvider'
import { Issues, SECRETS_QK, SecretInput, Section, Segmented, type TabCtx } from './shared'
import { BotSimulator } from './BotSimulator'
import { supabaseUrl } from '../../lib/supabase'

const LOG_QK = ['notify-log'] as const
const CH: Record<Channel, { label: string; icon: ReactNode; to: string; toLabel: string }> = {
  sms: { label: 'SMS', icon: <Smartphone className="h-4 w-4" />, to: 'phone', toLabel: 'Mobile number' },
  whatsapp: { label: 'WhatsApp', icon: <MessageCircle className="h-4 w-4" />, to: 'phone', toLabel: 'WhatsApp number' },
  email: { label: 'Email', icon: <Mail className="h-4 w-4" />, to: 'email', toLabel: 'Email address' },
}
const STATUS_TONE: Record<OutboxRow['status'], Tone> = { pending: 'amber', sending: 'blue', sent: 'green', simulated: 'violet', failed: 'red', skipped: 'slate' }

// sample values used by template previews
const SAMPLE: Record<string, string> = {
  code: '482915', name: 'Rohan Das', doctor: 'Dr. Arjun Mehta', date: '12 Oct 2026', time: '10:30 AM', ref: 'DCB-7K2Q9M',
  invoice: 'INV-2026-0142', amount: '₹1,100.00', due_date: '19 Oct 2026', method: 'UPI', test: 'Lipid Profile', address: 'Sector 12, New Delhi',
}
const fill = (t: string, vars: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m)
/** GSM-7 vs Unicode segment count, roughly how operators bill SMS. */
function smsSegments(text: string) {
  const unicode = /[^\n\r\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€]/.test(text)
  const single = unicode ? 70 : 160, multi = unicode ? 67 : 153
  return { unicode, chars: text.length, parts: text.length <= single ? 1 : Math.ceil(text.length / multi) }
}

// ------------------------------------------------------------------ provider forms
type P<C extends Channel> = { ctx: TabCtx; secrets: SecretStatus[] | undefined; cfg: AppSettings['notifications'][C] }
const edit = (ctx: TabCtx, fn: (n: AppSettings['notifications']) => void) => ctx.editApp((d) => fn(d.notifications))

function Help({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">{children}<ExternalLink className="h-3 w-3" /></a>
}

function SmsForm({ ctx, secrets, cfg }: P<'sms'>) {
  const set = (fn: (s: AppSettings['notifications']['sms']) => void) => edit(ctx, (n) => fn(n.sms))
  return (
    <div className="space-y-4">
      <Segmented size="sm" value={cfg.provider} onChange={(v) => set((s) => { s.provider = v })}
        options={[{ value: 'msg91', label: 'MSG91' }, { value: 'fast2sms', label: 'Fast2SMS' }, { value: 'twilio', label: 'Twilio' }, { value: 'webhook', label: 'Custom webhook' }]} />
      {cfg.provider === 'msg91' && <>
        <SecretInput name="msg91_auth_key" secrets={secrets} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sender ID" hint="6 letters, approved on DLT"><Input value={cfg.senderId} maxLength={6} onChange={(e) => set((s) => { s.senderId = e.target.value.toUpperCase() })} placeholder="DCHOSP" /></Field>
          <Field label="DLT entity (PE) ID"><Input value={cfg.dltEntityId} onChange={(e) => set((s) => { s.dltEntityId = e.target.value })} placeholder="1201…" /></Field>
        </div>
        <p className="text-xs text-slate-500">India requires DLT-registered templates. Create one <b>Flow</b> per message in MSG91 and paste its template ID in <b>Message templates</b> below. Variables are sent with the same names as the tokens (name, date, time…).</p>
        <Help href="https://control.msg91.com/app/">Open MSG91 dashboard</Help>
      </>}
      {cfg.provider === 'fast2sms' && <>
        <SecretInput name="fast2sms_api_key" secrets={secrets} />
        <Field label="Sender ID (DLT route)" hint="Leave empty to use the Quick SMS route (no DLT, higher cost)"><Input value={cfg.senderId} maxLength={6} onChange={(e) => set((s) => { s.senderId = e.target.value.toUpperCase() })} placeholder="DCHOSP" /></Field>
        <p className="text-xs text-slate-500">For the DLT route, put the Fast2SMS <b>message ID</b> in each template's DLT field and list the variables in order.</p>
        <Help href="https://www.fast2sms.com/dashboard/dev-api">Fast2SMS → Dev API</Help>
      </>}
      {cfg.provider === 'twilio' && <>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Account SID"><Input value={cfg.twilioAccountSid} onChange={(e) => set((s) => { s.twilioAccountSid = e.target.value.trim() })} placeholder="AC…" className="font-mono text-xs" /></Field>
          <Field label="From number / Messaging Service SID"><Input value={cfg.twilioFrom} onChange={(e) => set((s) => { s.twilioFrom = e.target.value.trim() })} placeholder="+1415… or MG…" /></Field>
        </div>
        <SecretInput name="twilio_auth_token" secrets={secrets} />
        <Help href="https://console.twilio.com/">Twilio console</Help>
      </>}
      {cfg.provider === 'webhook' && <>
        <Field label="Webhook URL" hint="We POST JSON: { channel, to, event, message, subject, vars }"><Input value={cfg.webhookUrl} onChange={(e) => set((s) => { s.webhookUrl = e.target.value.trim() })} placeholder="https://…" /></Field>
        <SecretInput name="sms_webhook_secret" secrets={secrets} />
      </>}
    </div>
  )
}

function WhatsappForm({ ctx, secrets, cfg }: P<'whatsapp'>) {
  const set = (fn: (s: AppSettings['notifications']['whatsapp']) => void) => edit(ctx, (n) => fn(n.whatsapp))
  return (
    <div className="space-y-4">
      <Segmented size="sm" value={cfg.provider} onChange={(v) => set((s) => { s.provider = v })}
        options={[{ value: 'openwa', label: 'WA CRM / OpenWA' }, { value: 'meta', label: 'Meta Cloud API' }, { value: 'interakt', label: 'Interakt' }, { value: 'twilio', label: 'Twilio' }, { value: 'webhook', label: 'Custom webhook' }]} />
      {cfg.provider === 'openwa' && <OpenwaFields cfg={cfg} set={set} secrets={secrets} />}
      {cfg.provider === 'meta' && <>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone number ID"><Input value={cfg.phoneNumberId} onChange={(e) => set((s) => { s.phoneNumberId = e.target.value.trim() })} placeholder="1234567890…" className="font-mono text-xs" /></Field>
          <Field label="WhatsApp Business Account ID" hint="Optional, for reference"><Input value={cfg.businessAccountId} onChange={(e) => set((s) => { s.businessAccountId = e.target.value.trim() })} className="font-mono text-xs" /></Field>
        </div>
        <SecretInput name="meta_access_token" secrets={secrets} />
      </>}
      {cfg.provider === 'interakt' && <SecretInput name="interakt_api_key" secrets={secrets} />}
      {cfg.provider === 'twilio' && <>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Account SID"><Input value={cfg.twilioAccountSid} onChange={(e) => set((s) => { s.twilioAccountSid = e.target.value.trim() })} placeholder="AC…" className="font-mono text-xs" /></Field>
          <Field label="WhatsApp sender"><Input value={cfg.twilioFrom} onChange={(e) => set((s) => { s.twilioFrom = e.target.value.trim() })} placeholder="+14155238886" /></Field>
        </div>
        <SecretInput name="twilio_auth_token" secrets={secrets} />
      </>}
      {cfg.provider === 'webhook' && <>
        <Field label="Webhook URL" hint="We POST JSON: { channel, to, event, message, subject, vars }"><Input value={cfg.webhookUrl} onChange={(e) => set((s) => { s.webhookUrl = e.target.value.trim() })} placeholder="https://…" /></Field>
        <SecretInput name="whatsapp_webhook_secret" secrets={secrets} />
      </>}
      {(cfg.provider === 'meta' || cfg.provider === 'interakt') && (
        <Field label="Template language code" hint="Must match the language your templates were approved in"><Input value={cfg.language} onChange={(e) => set((s) => { s.language = e.target.value.trim() })} placeholder="en" className="w-32" /></Field>
      )}
      {cfg.provider !== 'openwa' && <p className="text-xs text-slate-500">WhatsApp only allows free text inside a 24-hour chat window. For appointment and billing messages, get a <b>utility template</b> approved and enter its name in <b>Message templates</b>. The OTP uses an <b>authentication</b> template.</p>}
      {cfg.provider === 'meta' && <Help href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started">Meta Cloud API setup guide</Help>}
      {cfg.provider === 'interakt' && <Help href="https://app.interakt.ai/settings/developer-setting">Interakt → Developer settings</Help>}
    </div>
  )
}

/** Self-hosted OpenWA gateway (e.g. WA CRM): a linked WhatsApp number sends plain text — no Meta templates needed. */
function OpenwaFields({ cfg, set, secrets }: { cfg: AppSettings['notifications']['whatsapp']; set: (fn: (s: AppSettings['notifications']['whatsapp']) => void) => void; secrets: SecretStatus[] | undefined }) {
  // accept a pasted endpoint like https://host/api/sessions/<id>/messages/send-text and split it
  // keep what is typed; tidy it up when the field loses focus (or right away for a pasted full URL)
  const tidy = (v: string) => {
    const m = v.trim().match(/^(https?:\/\/[^/\s]+)(?:\/api)?(?:\/sessions\/([^/\s]+))?/)
    set((s) => { s.openwaUrl = m ? m[1] : v.trim(); if (m?.[2]) s.openwaSession = m[2] })
  }
  const onUrl = (v: string) => { if (/\/sessions\/[^/\s]+\/messages/.test(v)) tidy(v); else set((s) => { s.openwaUrl = v.trim() }) }
  const fmt = cfg.chatIdFormat || '91{phone}@c.us'
  let example = ''
  try { example = fmt.includes('{phone}') ? fmt.replace('{phone}', '9876543210') : '' } catch { /* */ }
  return <>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Gateway URL" hint="Paste the base URL or the full send-text URL — the session ID is filled in for you">
        <Input value={cfg.openwaUrl} onChange={(e) => onUrl(e.target.value)} onBlur={(e) => tidy(e.target.value)} placeholder="https://wacrm.digitalcomrade.in" className="font-mono text-xs" /></Field>
      <Field label="Session ID" hint="WA CRM → Sessions → the linked WhatsApp number">
        <Input value={cfg.openwaSession} onChange={(e) => set((s) => { s.openwaSession = e.target.value.trim() })} placeholder="9b11cfeb-b5a2-…" className="font-mono text-xs" /></Field>
    </div>
    <SecretInput name="openwa_api_key" secrets={secrets} />
    <Field label="Chat ID format" hint={<>How a patient's mobile becomes the <code>chatId</code>. <code>{'{phone}'}</code> = 10-digit number{example && <> · e.g. <code>{example}</code></>}</>}>
      <Input value={cfg.chatIdFormat} onChange={(e) => set((s) => { s.chatIdFormat = e.target.value.replace(/\s/g, '') })} placeholder="91{phone}@c.us" className="w-56 font-mono text-xs" /></Field>
    <div className="rounded-lg bg-brand-50/70 px-3 py-2.5 text-xs text-brand-900 ring-1 ring-brand-100">
      <p className="font-semibold">How it sends</p>
      <p className="mt-0.5 font-mono text-[11px] leading-relaxed text-brand-800">POST {(cfg.openwaUrl || 'https://…').replace(/\/$/, '')}/api/sessions/{cfg.openwaSession || '<session>'}/messages/send-text<br />X-API-Key: ••••  ·  {'{'} "chatId": "{example || '91…@c.us'}", "text": "…" {'}'}</p>
      <p className="mt-1.5">Messages go out from your linked WhatsApp number as normal chats — <b>no Meta template approval</b>, so the WhatsApp text in each template below is sent as-is. Keep the phone online and the session <b>ready</b>; <i>Send test</i> checks this first. Use an API key with the <b>operator</b> role scoped to this session.</p>
    </div>
    <Help href={`${(cfg.openwaUrl || 'https://github.com/rmyndharis/OpenWA').replace(/\/$/, '')}`}>Open WA CRM</Help>
  </>
}

function EmailForm({ ctx, secrets, cfg }: P<'email'>) {
  const set = (fn: (s: AppSettings['notifications']['email']) => void) => edit(ctx, (n) => fn(n.email))
  return (
    <div className="space-y-4">
      <Segmented size="sm" value={cfg.provider} onChange={(v) => set((s) => { s.provider = v })} options={[{ value: 'resend', label: 'Resend' }, { value: 'sendgrid', label: 'SendGrid' }, { value: 'smtp', label: 'SMTP' }]} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From name"><Input value={cfg.fromName} onChange={(e) => set((s) => { s.fromName = e.target.value })} placeholder="DC Hospital" /></Field>
        <Field label="From email" hint="Domain must be verified with the provider"><Input type="email" value={cfg.fromEmail} onChange={(e) => set((s) => { s.fromEmail = e.target.value.trim() })} placeholder="care@yourhospital.in" /></Field>
        <Field label="Reply-to (optional)" className="sm:col-span-2"><Input type="email" value={cfg.replyTo} onChange={(e) => set((s) => { s.replyTo = e.target.value.trim() })} placeholder="frontdesk@yourhospital.in" /></Field>
      </div>
      {cfg.provider === 'resend' && <><SecretInput name="resend_api_key" secrets={secrets} /><Help href="https://resend.com/api-keys">Create a Resend API key</Help></>}
      {cfg.provider === 'sendgrid' && <><SecretInput name="sendgrid_api_key" secrets={secrets} /><Help href="https://app.sendgrid.com/settings/api_keys">Create a SendGrid API key</Help></>}
      {cfg.provider === 'smtp' && <>
        <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
          <Field label="SMTP host"><Input value={cfg.smtpHost} onChange={(e) => set((s) => { s.smtpHost = e.target.value.trim() })} placeholder="smtp.gmail.com" /></Field>
          <Field label="Port"><Input type="number" value={cfg.smtpPort} onChange={(e) => set((s) => { s.smtpPort = Number(e.target.value) || 465 })} /></Field>
          <Field label="Username" className="sm:col-span-2"><Input value={cfg.smtpUser} onChange={(e) => set((s) => { s.smtpUser = e.target.value.trim() })} autoComplete="off" /></Field>
        </div>
        <SecretInput name="smtp_password" secrets={secrets} />
        <p className="text-xs text-slate-500">Use port <b>465</b> (implicit TLS). Supabase Edge Functions block outbound ports 25 and 587. For Gmail / Google Workspace, create an <b>App password</b>.</p>
      </>}
    </div>
  )
}

// ------------------------------------------------------------------ channel card
function ChannelCard({ channel, ctx, secrets }: { channel: Channel; ctx: TabCtx; secrets: SecretStatus[] | undefined }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const meta = CH[channel]
  const cfg = ctx.app.notifications[channel]
  const issues = secrets ? channelIssues(channel, ctx.app, secrets) : []
  const [to, setTo] = useState(channel === 'email' ? user?.email ?? '' : '')
  const [result, setResult] = useState<SendResult | null>(null)
  const test = useMutation({
    mutationFn: () => settingsStore.test(channel, to.trim(), ctx.app),
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: LOG_QK }); if (r.ok) toast.success(`Test ${meta.label} sent`) },
    onError: (e) => setResult({ ok: false, message: (e as Error).message }),
  })
  const toProblem = to.trim() ? recipientProblem(channel, to) : null
  const status = !cfg.enabled ? { tone: 'slate' as Tone, label: 'Off' } : issues.length ? { tone: 'amber' as Tone, label: 'Setup incomplete' } : { tone: 'green' as Tone, label: 'Ready' }
  const blockTest = ctx.dirty && settingsStore.mode === 'supabase'
  return (
    <Section title={<span className="flex items-center gap-2">{meta.label}<Badge tone={status.tone} dot>{status.label}</Badge></span>} icon={meta.icon}
      description={channel === 'sms' ? 'OTP, confirmations and reminders by text message.' : channel === 'whatsapp' ? 'Rich confirmations and reminders on WhatsApp.' : 'Confirmations, invoices and receipts by email.'}
      action={<label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600"><span className="hidden sm:inline">Enabled</span>
        <button type="button" role="switch" aria-checked={cfg.enabled} aria-label={`Enable ${meta.label}`} onClick={() => edit(ctx, (n) => { n[channel].enabled = !cfg.enabled })}
          className={cn('relative h-6 w-11 rounded-full transition', cfg.enabled ? 'bg-brand-600' : 'bg-slate-300')}>
          <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', cfg.enabled ? 'left-[22px]' : 'left-0.5')} />
        </button></label>}>
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          {channel === 'sms' && <SmsForm ctx={ctx} secrets={secrets} cfg={ctx.app.notifications.sms} />}
          {channel === 'whatsapp' && <WhatsappForm ctx={ctx} secrets={secrets} cfg={ctx.app.notifications.whatsapp} />}
          {channel === 'email' && <EmailForm ctx={ctx} secrets={secrets} cfg={ctx.app.notifications.email} />}
        </div>
        <div className="space-y-3 rounded-xl bg-slate-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Send className="h-4 w-4 text-brand-600" />Send a test</p>
          <Issues items={issues} />
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (!toProblem && to.trim()) test.mutate() }}>
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder={channel === 'email' ? 'you@example.com' : '98765 43210'} type={channel === 'email' ? 'email' : 'tel'} aria-label={meta.toLabel} />
            {toProblem && <p className="text-xs text-rose-600">{toProblem}</p>}
            <Button type="submit" size="sm" className="w-full" loading={test.isPending} disabled={!to.trim() || !!toProblem || blockTest} icon={<Send className="h-3.5 w-3.5" />}>Send test {meta.label}</Button>
            {blockTest && <p className="text-[11px] text-amber-700">Save your changes first — the test uses the saved settings.</p>}
          </form>
          {result && (
            <div role="status" className={cn('flex gap-2 rounded-lg border px-3 py-2 text-xs', result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700')}>
              {result.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <CircleAlert className="h-4 w-4 shrink-0" />}
              <span className="min-w-0 break-words">{result.message}{result.provider_ref && <span className="mt-0.5 block font-mono text-[10px] opacity-70">ref {result.provider_ref}</span>}</span>
            </div>
          )}
          <p className="text-[11px] text-slate-400">{channel === 'whatsapp' && cfg.provider === 'meta' ? 'Meta sends its approved “hello_world” template for tests.' : channel === 'whatsapp' && cfg.provider === 'openwa' ? 'Checks that the WhatsApp session is connected, then sends a test chat.' : 'Credentials are stored server-side and are never shown again after saving.'}</p>
        </div>
      </div>
    </Section>
  )
}

// ------------------------------------------------------------------ template editor
function TemplateDrawer({ ev, ctx, onClose }: { ev: NotifyEvent | null; ctx: TabCtx; onClose: () => void }) {
  const area = useRef<HTMLTextAreaElement>(null)
  const def = ev ? EVENTS.find((e) => e.id === ev)! : null
  if (!ev || !def) return <Drawer open={false} onClose={onClose} title="">{null}</Drawer>
  const t = ctx.app.notifications.templates[ev] ?? DEFAULT_TEMPLATES[ev]
  const set = (fn: (x: typeof t) => void) => edit(ctx, (n) => { n.templates[ev] = { ...DEFAULT_TEMPLATES[ev], ...n.templates[ev] }; fn(n.templates[ev]) })
  const vars: Record<string, string> = { ...SAMPLE, hospital: ctx.site.brand.shortName || ctx.site.name, hospital_phone: ctx.site.appointmentsPhone || ctx.site.phone }
  const seg = smsSegments(fill(t.text, vars))
  const insert = (tok: string) => {
    const el = area.current, s = `{${tok}}`
    const [a, b] = el ? [el.selectionStart, el.selectionEnd] : [t.text.length, t.text.length]
    set((x) => { x.text = x.text.slice(0, a) + s + x.text.slice(b) })
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + s.length, a + s.length) })
  }
  const unknown = Array.from(t.text.matchAll(/\{(\w+)\}/g)).map((m) => m[1]).filter((k) => !def.tokens.includes(k))
  return (
    <Drawer open onClose={onClose} title={def.label} subtitle={def.hint} width="max-w-2xl"
      footer={<div className="flex justify-between gap-2"><Button variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => set((x) => Object.assign(x, DEFAULT_TEMPLATES[ev]))}>Reset to default</Button><Button onClick={onClose}>Done</Button></div>}>
      <div className="space-y-5">
        <div>
          <span className="label">Message text</span>
          <Textarea ref={area} rows={5} value={t.text} onChange={(e) => set((x) => { x.text = e.target.value })} />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {def.tokens.map((k) => <button key={k} type="button" onClick={() => insert(k)} className="rounded-md bg-brand-50 px-1.5 py-0.5 font-mono text-[11px] text-brand-800 ring-1 ring-brand-100 hover:bg-brand-100">{`{${k}}`}</button>)}
            <span className="ml-auto text-[11px] text-slate-400">{seg.chars} chars · {seg.parts} SMS{seg.parts > 1 ? ' parts' : ''}{seg.unicode ? ' (Unicode)' : ''}</span>
          </div>
          {unknown.length > 0 && <p className="mt-1 text-xs text-amber-700">Unknown token{unknown.length > 1 ? 's' : ''}: {unknown.map((u) => `{${u}}`).join(', ')}. These stay as typed.</p>}
          <p className="mt-1 text-xs text-slate-400">Used as the SMS text (Twilio / Quick route / webhook) and the email body{def.channels.includes('whatsapp') ? ', and on WhatsApp when the WhatsApp text below is empty' : ''}.</p>
        </div>
        {def.channels.includes('whatsapp') && (
          <div>
            <span className="label flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5 text-emerald-600" />WhatsApp text <span className="font-normal normal-case text-slate-400">(optional)</span></span>
            <Textarea rows={6} value={t.waText ?? ''} onChange={(e) => set((x) => { x.waText = e.target.value })} placeholder={t.text} className="font-[inherit]" />
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {def.tokens.map((k) => <button key={k} type="button" onClick={() => set((x) => { x.waText = (x.waText ?? '') + `{${k}}` })} className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] text-emerald-800 ring-1 ring-emerald-100 hover:bg-emerald-100">{`{${k}}`}</button>)}
            </div>
            <p className="mt-1 text-xs text-slate-400">WhatsApp formatting works: <code>*bold*</code>, <code>_italic_</code>, emoji and line breaks. Sent as-is by WA CRM / OpenWA, Twilio and webhook; Meta / Interakt use it only when no approved template name is set.</p>
          </div>
        )}
        {def.channels.includes('email') && <Field label="Email subject"><Input value={t.subject} onChange={(e) => set((x) => { x.subject = e.target.value })} /></Field>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="DLT / MSG91 template ID" hint="Required for MSG91; Fast2SMS DLT message ID"><Input value={t.smsTemplateId} onChange={(e) => set((x) => { x.smsTemplateId = e.target.value.trim() })} className="font-mono text-xs" placeholder="e.g. 65f1c2…" /></Field>
          <Field label="WhatsApp template name" hint="Approved template (Meta / Interakt). Empty = free text"><Input value={t.waTemplate} onChange={(e) => set((x) => { x.waTemplate = e.target.value.trim() })} className="font-mono text-xs" placeholder="appointment_confirmed" /></Field>
          <Field label="Template variables, in order" className="sm:col-span-2" hint="Fills WhatsApp {{1}}, {{2}}… and Fast2SMS DLT variables. Comma-separated token names.">
            <Input value={t.waParams} onChange={(e) => set((x) => { x.waParams = e.target.value.replace(/\s/g, '') })} className="font-mono text-xs" placeholder="name,doctor,date,time" />
          </Field>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="label mb-2">Preview with sample data</p>
          <div className="space-y-3">
            <div className="max-w-sm rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm text-slate-700 shadow-sm ring-1 ring-slate-100"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">SMS / email</span>{fill(t.text, vars)}</div>
            {def.channels.includes('whatsapp') && (
              <div className="max-w-sm rounded-2xl rounded-tl-sm bg-[#dcf8c6] px-3.5 py-2.5 text-sm text-slate-800 shadow-sm"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-emerald-700">WhatsApp</span><WaText text={fill(t.waText || t.text, vars)} /></div>
            )}
            {def.channels.includes('email') && <p className="text-xs text-slate-500"><b>Subject:</b> {fill(t.subject, vars)}</p>}
            {t.waParams && <p className="text-xs text-slate-500"><b>Variables:</b> {t.waParams.split(',').filter(Boolean).map((k, i) => <span key={i} className="mr-2 font-mono">{`{{${i + 1}}}`}={vars[k] ?? k}</span>)}</p>}
          </div>
        </div>
      </div>
    </Drawer>
  )
}

/** Render WhatsApp *bold* / _italic_ / ~strike~ and line breaks for the preview. */
function WaText({ text }: { text: string }) {
  return <span className="whitespace-pre-wrap break-words">{text.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g).map((part, i) =>
    /^\*.+\*$/.test(part) ? <b key={i}>{part.slice(1, -1)}</b> : /^_.+_$/.test(part) ? <i key={i}>{part.slice(1, -1)}</i> : /^~.+~$/.test(part) ? <s key={i}>{part.slice(1, -1)}</s> : part)}</span>
}

// ------------------------------------------------------------------ events matrix
function EventsMatrix({ ctx }: { ctx: TabCtx }) {
  const [open, setOpen] = useState<NotifyEvent | null>(null)
  const n = ctx.app.notifications
  const channels: Channel[] = ['sms', 'whatsapp', 'email']
  return (
    <Section title="Messages & templates" description="Choose which events send a message on which channel, and edit the wording." icon={<MessageSquareText className="h-4 w-4" />}>
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wider text-slate-400">
            <th className="px-5 pb-2 font-semibold">Event</th>
            {channels.map((c) => <th key={c} className={cn('px-3 pb-2 text-center font-semibold', !n[c].enabled && 'opacity-50')}>{CH[c].label}</th>)}
            <th className="px-5 pb-2" />
          </tr></thead>
          <tbody>
            {EVENTS.map((ev) => {
              const t = n.templates[ev.id] ?? DEFAULT_TEMPLATES[ev.id]
              const custom = JSON.stringify(t) !== JSON.stringify(DEFAULT_TEMPLATES[ev.id])
              return (
                <tr key={ev.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3"><p className="font-medium text-slate-800">{ev.label}</p><p className="text-xs text-slate-400">{ev.hint}</p></td>
                  {channels.map((c) => {
                    const supported = ev.channels.includes(c)
                    const on = !!n.events[ev.id]?.[c]
                    return (
                      <td key={c} className="px-3 py-3 text-center">
                        {supported ? (
                          <input type="checkbox" checked={on} aria-label={`${ev.label} by ${CH[c].label}`} onChange={() => edit(ctx, (x) => { x.events[ev.id] = { ...x.events[ev.id], [c]: !on } })}
                            className={cn('h-4 w-4 cursor-pointer rounded border-slate-300 text-brand-600 focus:ring-brand-500', !n[c].enabled && 'opacity-50')} />
                        ) : <span className="text-slate-300" title="Not available for this event">—</span>}
                      </td>
                    )
                  })}
                  <td className="px-5 py-3 text-right">
                    <Button size="sm" variant="outline" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => setOpen(ev.id)}>Template{custom && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-brand-600" aria-label="customised" />}</Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-400">A message is only sent when both the event checkbox and the channel itself are on. Patients without a phone number or email are skipped.</p>
      <TemplateDrawer ev={open} ctx={ctx} onClose={() => setOpen(null)} />
    </Section>
  )
}

// ------------------------------------------------------------------ delivery log
function DeliveryLog() {
  const qc = useQueryClient()
  const log = useQuery({ queryKey: LOG_QK, queryFn: settingsStore.log, refetchInterval: 20_000 })
  const [filter, setFilter] = useState<'all' | 'failed'>('all')
  const flush = useMutation({
    mutationFn: settingsStore.flush,
    onSuccess: (r) => { toast.success(`Processed ${r.processed} message${r.processed === 1 ? '' : 's'}`, { description: `${r.sent} sent · ${r.failed} failed` }); qc.invalidateQueries({ queryKey: LOG_QK }) },
    onError: (e) => toast.error((e as Error).message),
  })
  const remind = useMutation({
    mutationFn: settingsStore.queueReminders,
    onSuccess: (n) => { toast.success(n ? `Queued ${n} reminder${n === 1 ? '' : 's'} for tomorrow` : 'No new reminders to queue'); qc.invalidateQueries({ queryKey: LOG_QK }); if (n) flush.mutate() },
    onError: (e) => toast.error((e as Error).message),
  })
  const rows = useMemo(() => (log.data ?? []).filter((r) => filter === 'all' || r.status === 'failed'), [log.data, filter])
  const live = settingsStore.mode === 'supabase'
  return (
    <Section title="Delivery log" description="The last 100 messages. OTP message bodies are never stored." icon={<History className="h-4 w-4" />}
      action={<div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" icon={<AlarmClock className="h-3.5 w-3.5" />} loading={remind.isPending} disabled={!live} onClick={() => remind.mutate()} title="Queue reminders for tomorrow's appointments">Queue reminders</Button>
        <Button size="sm" variant="outline" icon={<Send className="h-3.5 w-3.5" />} loading={flush.isPending} disabled={!live} onClick={() => flush.mutate()}>Process queue</Button>
        <Button size="icon" variant="ghost" aria-label="Refresh log" onClick={() => log.refetch()}><RefreshCw className={cn('h-4 w-4', log.isFetching && 'animate-spin')} /></Button>
      </div>}>
      <Segmented size="sm" className="mb-3" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'failed', label: `Failed (${(log.data ?? []).filter((r) => r.status === 'failed').length})` }]} />
      {log.isPending ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        : log.isError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{(log.error as Error).message}</p>
          : !rows.length ? <EmptyState icon={<BellRing className="h-6 w-6" />} title={filter === 'failed' ? 'No failed messages' : 'No messages yet'} description={live ? 'Messages appear here as appointments, invoices and lab results trigger them.' : 'In demo mode only test sends are logged.'} />
            : (
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead><tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wider text-slate-400">
                    <th className="px-5 pb-2 font-semibold">When</th><th className="px-3 pb-2 font-semibold">Event</th><th className="px-3 pb-2 font-semibold">Channel</th><th className="px-3 pb-2 font-semibold">To</th><th className="px-5 pb-2 font-semibold">Status</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-slate-50 align-top last:border-0">
                        <td className="whitespace-nowrap px-5 py-2.5 text-xs text-slate-500">{fmtDate(r.created_at)}<br />{fmtTime(format(new Date(r.created_at), 'HH:mm'))}</td>
                        <td className="px-3 py-2.5 text-slate-700">{r.event === 'test' ? 'Test message' : EVENTS.find((e) => e.id === r.event)?.label ?? r.event}</td>
                        <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5 text-slate-600">{CH[r.channel]?.icon}{CH[r.channel]?.label ?? r.channel}</span></td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{r.recipient}</td>
                        <td className="px-5 py-2.5"><Badge tone={STATUS_TONE[r.status] ?? 'slate'}>{r.status}</Badge>{r.attempts > 1 && <span className="ml-1 text-[11px] text-slate-400">×{r.attempts}</span>}
                          {r.error && <p className="mt-1 max-w-xs break-words text-xs text-rose-600">{r.error}</p>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
    </Section>
  )
}

// ------------------------------------------------------------------ tab
export function NotificationsTab({ ctx }: { ctx: TabCtx }) {
  const secrets = useQuery({ queryKey: SECRETS_QK, queryFn: settingsStore.secrets })
  const ping = useMutation({ mutationFn: settingsStore.ping })
  const live = settingsStore.mode === 'supabase'
  return (
    <div className="space-y-6">
      <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm', live ? 'border-brand-200 bg-brand-50/60 text-brand-900' : 'border-amber-200 bg-amber-50 text-amber-900')}>
        {live ? <ServerCog className="h-5 w-5 shrink-0" /> : <PlugZap className="h-5 w-5 shrink-0" />}
        <p className="min-w-0 flex-1">
          {live ? <>Messages are queued in the database and delivered by the <b>notify</b> Edge Function. Deploy it once with <code className="rounded bg-white/70 px-1 text-xs">supabase functions deploy notify</code>.</>
            : <><b>Demo mode.</b> You can configure everything and test your setup, but nothing is really sent until Supabase is connected and the notify function is deployed. API keys you type here are <b>not stored</b> in this browser — only their last 4 characters, so you can see what was entered.</>}
        </p>
        {live && <Button size="sm" variant="outline" loading={ping.isPending} icon={<PlugZap className="h-3.5 w-3.5" />} onClick={() => ping.mutate()}>Check function</Button>}
        {ping.data && <span className={cn('basis-full text-xs', ping.data.ok ? 'text-emerald-700' : 'text-rose-700')}>{ping.data.ok ? '✓ ' : '✕ '}{ping.data.message}</span>}
      </div>
      {secrets.isError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Could not load saved credentials: {(secrets.error as Error).message}</p>}
      {(['sms', 'whatsapp', 'email'] as Channel[]).map((c) => <ChannelCard key={c} channel={c} ctx={ctx} secrets={secrets.data} />)}
      <ChatbotCard ctx={ctx} secrets={secrets.data} />
      <EventsMatrix ctx={ctx} />
      <DeliveryLog />
    </div>
  )
}


// ------------------------------------------------------------------ WhatsApp booking chatbot
function ChatbotCard({ ctx, secrets }: { ctx: TabCtx; secrets: SecretStatus[] | undefined }) {
  const w = ctx.app.notifications.whatsapp
  const on = w.botEnabled
  const hook = supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1/whatsapp-bot` : '(connect Supabase to get the webhook URL)'
  const copy = () => navigator.clipboard?.writeText(hook).then(() => toast.success('Webhook URL copied'))
  return (
    <Section title={<span className="flex items-center gap-2">WhatsApp booking chatbot<Badge tone={on ? (w.enabled ? 'green' : 'amber') : 'slate'} dot>{on ? (w.enabled ? 'On' : 'Needs WhatsApp') : 'Off'}</Badge></span>} icon={<Bot className="h-4 w-4" />}
      description="Patients message your WhatsApp number to book, see or cancel appointments and get timings — in English or Hindi, 24×7."
      action={<label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600"><span className="hidden sm:inline">Enabled</span>
        <button type="button" role="switch" aria-checked={on} aria-label="Enable WhatsApp chatbot" onClick={() => edit(ctx, (n) => { n.whatsapp.botEnabled = !on })}
          className={cn('relative h-6 w-11 rounded-full transition', on ? 'bg-brand-600' : 'bg-slate-300')}>
          <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
        </button></label>}>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4 text-sm text-slate-600">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Deploy once: <code className="rounded bg-slate-100 px-1 text-xs">supabase functions deploy whatsapp-bot --no-verify-jwt</code></li>
            <li>Set the provider in the <b>WhatsApp</b> card above (WA CRM / OpenWA, Meta Cloud API or Twilio) and turn it on.</li>
            <li>Point your provider’s incoming-message webhook to:
              <div className="mt-1.5 flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-2 py-1.5 text-xs">{hook}</code>
                {supabaseUrl && <Button size="sm" variant="outline" icon={<Copy className="h-3.5 w-3.5" />} onClick={copy}>Copy</Button>}</div>
            </li>
          </ol>
          {w.provider === 'meta' && <>
            <p>In Meta → WhatsApp → Configuration → Webhook, paste the URL, enter the verify token below and subscribe to <b>messages</b>.</p>
            <SecretInput name="whatsapp_verify_token" secrets={secrets} />
            <SecretInput name="meta_app_secret" secrets={secrets} />
          </>}
          {w.provider === 'openwa' && <>
            <p>In <b>WA CRM → Sessions → {w.openwaSession ? <code className="text-xs">{w.openwaSession.slice(0, 8)}…</code> : 'your session'} → Webhooks</b>, add the URL, subscribe to <b>message.received</b> and set a <b>secret</b>. Paste the same secret below — unsigned requests are rejected, because the sender’s number is the patient’s identity.</p>
            <SecretInput name="openwa_webhook_secret" secrets={secrets} />
          </>}
          {w.provider === 'twilio' && <p>In Twilio → Messaging → WhatsApp sender → “When a message comes in”, paste the URL (HTTP POST). Requests are checked with your Twilio auth token.</p>}
          {(w.provider === 'interakt' || w.provider === 'webhook') && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">The chatbot supports <b>WA CRM / OpenWA</b>, <b>Meta Cloud API</b> and <b>Twilio</b> for incoming messages. Switch the WhatsApp provider to use it.</p>}
          <p className="text-xs text-slate-500">Bookings from the bot use the same slot rules as the website (holidays, leave, notice period) and are marked <b>source: WhatsApp</b>. The patient’s WhatsApp number is their verification, so no OTP is needed. Chats reset after 30 minutes of silence.</p>
        </div>
        <BotSimulator />
      </div>
    </Section>
  )
}
