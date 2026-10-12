import { format } from 'date-fns'
import { Building2, Globe2, HeartPulse, Languages, Phone } from 'lucide-react'
import { Button, Field, Input, Select, Textarea } from '../../components/ui'
import { cn } from '../../lib/utils'
import type { AppSettings } from '../../settings/types'
import { ImagePicker, Section, Segmented, Toggle, type TabCtx } from './shared'

const DATE_FORMATS: AppSettings['locale']['dateFormat'][] = ['dd MMM yyyy', 'd MMMM yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd']

/** Small live preview of how the brand appears in the sidebar, browser tab and documents. */
function BrandPreview({ ctx }: { ctx: TabCtx }) {
  const b = ctx.site.brand
  const name = ctx.site.name || 'Hospital name'
  const Logo = ({ className }: { className?: string }) => (b.logoUrl
    ? <img src={b.logoUrl} alt="" className={cn('object-contain', className)} />
    : <HeartPulse className={cn('text-brand-700', className)} />)
  return (
    <div className="space-y-3">
      <p className="label">Live preview</p>
      {/* sidebar */}
      <div className="flex items-center gap-3 rounded-xl bg-gradient-to-br from-brand-900 to-brand-950 p-4 text-white">
        <span className={cn('grid h-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-white p-1', b.showName ? 'w-9' : 'max-w-[190px] px-2')}><Logo className="h-7 max-w-full" /></span>
        {b.showName && <span className="min-w-0"><span className="block truncate font-semibold">{name}</span><span className="block truncate text-xs text-white/60">{b.appSubtitle || 'Management System'}</span></span>}
      </div>
      {/* browser tab */}
      <div className="rounded-xl border border-slate-200 bg-slate-100 p-2">
        <div className="flex w-60 max-w-full items-center gap-2 rounded-t-lg bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm">
          {b.faviconUrl || b.logoUrl ? <img src={b.faviconUrl || b.logoUrl} alt="" className="h-4 w-4 object-contain" /> : <HeartPulse className="h-4 w-4 text-brand-700" />}
          <span className="truncate">Dashboard · {b.shortName || name}</span>
        </div>
      </div>
      {/* invoice letterhead */}
      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-brand-50"><Logo className="h-8 w-8" /></span>
        <div className="min-w-0 text-xs text-slate-500">
          <p className="truncate text-sm font-bold text-brand-950">{ctx.site.billing.legalName || name}</p>
          <p className="line-clamp-2">{ctx.site.address || 'Address'}</p>
          <p>{[ctx.site.phone, ctx.site.email].filter(Boolean).join(' · ')}</p>
        </div>
        <span className="ml-auto rounded bg-brand-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Invoice</span>
      </div>
    </div>
  )
}

export function GeneralTab({ ctx }: { ctx: TabCtx }) {
  const { site, app, editSite, editApp } = ctx
  const now = new Date()
  return (
    <div className="space-y-6">
      <Section title="Logo & brand name" description="Used on the website, dashboard sidebar, sign-in page, invoices, prescriptions and the browser tab." icon={<Building2 className="h-4 w-4" />}>
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hospital name" required className="sm:col-span-2"><Input value={site.name} onChange={(e) => editSite((d) => { d.name = e.target.value })} placeholder="DC Hospital" maxLength={80} /></Field>
            <Field label="Short name" hint="Mobile header, SMS signature, browser tab"><Input value={site.brand.shortName} onChange={(e) => editSite((d) => { d.brand.shortName = e.target.value })} placeholder="DC Hospital" maxLength={30} /></Field>
            <Field label="Sidebar subtitle" hint="Line under the name in the dashboard"><Input value={site.brand.appSubtitle} onChange={(e) => editSite((d) => { d.brand.appSubtitle = e.target.value })} placeholder="Management System" maxLength={40} /></Field>
            <Field label="Tagline" className="sm:col-span-2"><Input value={site.tagline} onChange={(e) => editSite((d) => { d.tagline = e.target.value })} /></Field>
            <div className="sm:col-span-2"><ImagePicker label="Logo" value={site.brand.logoUrl} onChange={(v) => editSite((d) => { d.brand.logoUrl = v })} hint="Square PNG, SVG or WebP with a transparent background works best (at least 256 × 256)." /></div>
            <div className="sm:col-span-2"><ImagePicker label="Favicon (browser tab icon)" value={site.brand.faviconUrl} onChange={(v) => editSite((d) => { d.brand.faviconUrl = v })} hint="Optional — the logo is used when empty." /></div>
            <div className="sm:col-span-2"><Toggle label="Show the name next to the logo" hint="Turn off if your logo image already contains the hospital name" checked={site.brand.showName} onChange={(v) => editSite((d) => { d.brand.showName = v })} /></div>
          </div>
          <BrandPreview ctx={ctx} />
        </div>
      </Section>

      <Section title="Contact details" description="Shown on the website and documents, and available in message templates as {hospital_phone} and {address}." icon={<Phone className="h-4 w-4" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Main phone"><Input value={site.phone} onChange={(e) => editSite((d) => { d.phone = e.target.value })} inputMode="tel" /></Field>
          <Field label="Appointments phone" hint="Used in patient messages; falls back to the main phone"><Input value={site.appointmentsPhone} onChange={(e) => editSite((d) => { d.appointmentsPhone = e.target.value })} inputMode="tel" /></Field>
          <Field label="WhatsApp number" hint="Click-to-chat button on the website"><Input value={site.whatsapp} onChange={(e) => editSite((d) => { d.whatsapp = e.target.value })} inputMode="tel" /></Field>
          <Field label="Email"><Input type="email" value={site.email} onChange={(e) => editSite((d) => { d.email = e.target.value })} /></Field>
          <Field label="Website address" hint="Used for links in messages (feedback, staff invites). Leave empty to use this site’s address." className="sm:col-span-2">
            <div className="flex gap-2">
              <Input type="url" value={site.siteUrl} onChange={(e) => editSite((d) => { d.siteUrl = e.target.value.trim() })} placeholder={window.location.origin} />
              {site.siteUrl !== window.location.origin && <Button type="button" variant="outline" size="sm" onClick={() => editSite((d) => { d.siteUrl = window.location.origin })}>Use this site</Button>}
            </div>
          </Field>
          <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={site.address} onChange={(e) => editSite((d) => { d.address = e.target.value })} /></Field>
        </div>
      </Section>

      <Section title="Regional format" description="How dates and times appear across the dashboard, invoices and prescriptions." icon={<Languages className="h-4 w-4" />}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Date format">
            <Select value={app.locale.dateFormat} onChange={(e) => editApp((d) => { d.locale.dateFormat = e.target.value as AppSettings['locale']['dateFormat'] })}>
              {DATE_FORMATS.map((f) => <option key={f} value={f}>{format(now, f)}  ({f})</option>)}
            </Select>
          </Field>
          <div>
            <span className="label">Time format</span>
            <Segmented value={app.locale.timeFormat} onChange={(v) => editApp((d) => { d.locale.timeFormat = v })}
              options={[{ value: '12h', label: '2:30 PM' }, { value: '24h', label: '14:30' }]} />
          </div>
          <div>
            <span className="label">Week starts on</span>
            <Segmented value={app.locale.weekStartsOn} onChange={(v) => editApp((d) => { d.locale.weekStartsOn = v })} options={[{ value: 1, label: 'Monday' }, { value: 0, label: 'Sunday' }]} />
            <p className="mt-1.5 text-xs text-slate-400">Appointment calendar month view</p>
          </div>
          <div className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span>Currency <b>₹ INR</b> · Time zone <b>{Intl.DateTimeFormat().resolvedOptions().timeZone}</b><span className="block text-xs text-slate-400">Taken from each user's device.</span></span>
          </div>
        </div>
      </Section>
    </div>
  )
}
