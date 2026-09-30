/**
 * Installable app: registers the service worker, offers "Install the app" to patients / website visitors,
 * shows an iPhone "Add to Home Screen" hint, and prompts to reload when a new deploy is available.
 */
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Download, Share, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthProvider'
import { useT } from '../i18n'

interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const DISMISS_KEY = 'dch:pwa-dismissed'
const SNOOZE_MS = 14 * 24 * 3600_000
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
const snoozed = () => { try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < SNOOZE_MS } catch { return false } }
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)

let registered = false
function registerSW(onUpdate: (w: ServiceWorker) => void) {
  if (registered || !import.meta.env.PROD || !('serviceWorker' in navigator) || window.self !== window.top) return
  registered = true
  const run = async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      const watch = (w: ServiceWorker | null) => w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) onUpdate(w) })
      if (reg.waiting && navigator.serviceWorker.controller) onUpdate(reg.waiting)
      reg.addEventListener('updatefound', () => watch(reg.installing))
      // long-lived tabs (reception PCs, installed app) pick up new deploys hourly
      setInterval(() => reg.update().catch(() => {}), 3600_000)
      let reloaded = false
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; window.location.reload() } })
    } catch { /* unsupported / blocked — the site works without it */ }
  }
  if (document.readyState === 'complete') run()
  else window.addEventListener('load', run, { once: true })
}

export function PwaPrompt() {
  const { user } = useAuth()
  const { t } = useT()
  const { pathname } = useLocation()
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null)
  const [iosHint, setIosHint] = useState(false)
  const [hidden, setHidden] = useState(snoozed)

  useEffect(() => {
    registerSW((w) => toast(t('A new version is available'), { duration: Infinity, action: { label: t('Update'), onClick: () => w.postMessage('SKIP_WAITING') } }))
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BeforeInstallPromptEvent) }
    const onInstalled = () => { setEvt(null); setHidden(true) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    if (isIos() && !standalone()) setIosHint(true)
    const offline = () => toast.warning(t('You are offline — showing saved pages.'))
    window.addEventListener('offline', offline)
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); window.removeEventListener('offline', offline) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // patients and website visitors only — not staff, and not over the booking / feedback forms
  const audience = !user || user.role === 'patient'
  const busyPage = /^\/(book|feedback|login|register|preview)/.test(pathname)
  if (hidden || standalone() || !audience || busyPage || (!evt && !iosHint)) return null

  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* ignore */ } setHidden(true) }
  const install = async () => {
    if (!evt) return
    await evt.prompt()
    const { outcome } = await evt.userChoice
    setEvt(null)
    if (outcome === 'dismissed') dismiss()
  }

  return (
    <div role="dialog" aria-label={t('Install the app')} className="fixed inset-x-3 bottom-20 z-[60] mx-auto max-w-md animate-pop-in sm:bottom-5 sm:left-auto sm:right-5 sm:mx-0">
      <div className="flex items-start gap-3 rounded-2xl border border-brand-200 bg-white/95 p-4 shadow-2xl backdrop-blur">
        <img src="/icons/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-brand-950">{t('Install the app')}</p>
          <p className="mt-0.5 text-xs text-slate-600">{evt ? t('Book visits, see reports and bills — right from your home screen.') : t('On iPhone: tap Share, then “Add to Home Screen”.')}</p>
          <div className="mt-3 flex gap-2">
            {evt
              ? <button type="button" onClick={install} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-950"><Download className="h-3.5 w-3.5" />{t('Install')}</button>
              : <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-800"><Share className="h-3.5 w-3.5" />Share → Add to Home Screen</span>}
            <button type="button" onClick={dismiss} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">{t('Not now')}</button>
          </div>
        </div>
        <button type="button" onClick={dismiss} aria-label={t('Close')} className="rounded p-1 text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
      </div>
    </div>
  )
}
