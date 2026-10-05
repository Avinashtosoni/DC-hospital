/**
 * Browser push for the control-panel team (Phase 3 alerts). Firebase loads only when someone turns it on. The web
 * config comes from cp_push_config() (Platform settings → Integrations → Browser push); tokens are saved with
 * cp_register_push() and used by the ops Edge Function.
 */
import { cp } from './api'
import type { PushConfig } from './types'

const TOKEN_KEY = 'hc-cp:push-token:v1'
const SW_SCOPE = '/control-panel/push/'

export const pushSupported = () => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
export const pushPermission = (): NotificationPermission | 'unsupported' => (pushSupported() ? Notification.permission : 'unsupported')
export const savedPushToken = () => localStorage.getItem(TOKEN_KEY)

const webConfig = (c: PushConfig) => ({ apiKey: c.apiKey, authDomain: `${c.projectId}.firebaseapp.com`, projectId: c.projectId, messagingSenderId: c.messagingSenderId, appId: c.appId })

async function messaging(c: PushConfig) {
  const [{ initializeApp, getApps }, m] = await Promise.all([import('@firebase/app'), import('@firebase/messaging')])
  if (!(await m.isSupported())) throw new Error('This browser does not support push notifications')
  const app = getApps().find((a) => a.name === 'hc-cp-push') ?? initializeApp(webConfig(c), 'hc-cp-push')
  return { m, messaging: m.getMessaging(app) }
}

/** ask permission, get this browser's token and save it for the signed-in team member */
export async function enablePush(c: PushConfig | null): Promise<number> {
  if (!pushSupported()) throw new Error('This browser does not support push notifications')
  if (!c?.projectId || !c.apiKey || !c.appId || !c.messagingSenderId || !c.vapidKey) throw new Error('Browser push is not set up — an admin adds the Firebase web config in Platform settings → Integrations and turns on Push in Alerts → Settings')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this site — allow them in the browser’s site settings' : 'Permission was not given')
  const reg = await navigator.serviceWorker.register(`/cp-messaging-sw.js?config=${encodeURIComponent(JSON.stringify(webConfig(c)))}`, { scope: SW_SCOPE })
  const { m, messaging: msg } = await messaging(c)
  const token = await m.getToken(msg, { vapidKey: c.vapidKey, serviceWorkerRegistration: reg })
  if (!token) throw new Error('Could not get a device token from Firebase')
  const n = await cp.registerPush(token)
  localStorage.setItem(TOKEN_KEY, token)
  return n
}

export async function disablePush(c: PushConfig | null): Promise<number> {
  const token = savedPushToken()
  localStorage.removeItem(TOKEN_KEY)
  const n = token ? await cp.unregisterPush(token) : 0
  try { if (c?.projectId) { const { m, messaging: msg } = await messaging(c); await m.deleteToken(msg) } } catch { /* already gone */ }
  return n
}

/** alerts that arrive while the panel is open (the service worker only shows background ones) */
export async function onForegroundPush(c: PushConfig, cb: (p: { title: string; body: string; link?: string }) => void): Promise<() => void> {
  const { m, messaging: msg } = await messaging(c)
  return m.onMessage(msg, (p) => cb({ title: p.notification?.title ?? 'Alert', body: p.notification?.body ?? '', link: p.data?.link }))
}
