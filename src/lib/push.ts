/**
 * Browser push notifications through Firebase Cloud Messaging.
 * The Firebase SDK is loaded only when someone turns notifications on (keeps it off the first paint).
 * Tokens are stored with register_push_token() so the notify Edge Function can reach this device.
 */
import { isSupabaseConfigured, supabase } from './supabase'
import type { AppSettings } from '../settings/types'

type PushCfg = AppSettings['notifications']['push']
const TOKEN_KEY = 'dch:push-token:v1'
const SW_SCOPE = '/firebase-cloud-messaging-push-scope'

export const pushSupported = () => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
export const pushConfigured = (c?: PushCfg) => !!(c?.enabled && c.apiKey && c.projectId && c.messagingSenderId && c.appId && c.vapidKey)
export const pushPermission = (): NotificationPermission | 'unsupported' => (pushSupported() ? Notification.permission : 'unsupported')
export const savedPushToken = () => localStorage.getItem(TOKEN_KEY)

const webConfig = (c: PushCfg) => ({ apiKey: c.apiKey, authDomain: c.authDomain || `${c.projectId}.firebaseapp.com`, projectId: c.projectId, messagingSenderId: c.messagingSenderId, appId: c.appId })

async function messaging(c: PushCfg) {
  const [{ initializeApp, getApps }, m] = await Promise.all([import('@firebase/app'), import('@firebase/messaging')])
  if (!(await m.isSupported())) throw new Error('This browser does not support push notifications')
  const app = getApps().find((a) => a.name === 'dch-push') ?? initializeApp(webConfig(c), 'dch-push')
  return { m, messaging: m.getMessaging(app) }
}

/** ask permission, get this device's FCM token and save it for the signed-in user */
export async function enablePush(c: PushCfg): Promise<string> {
  if (!pushSupported()) throw new Error('This browser does not support push notifications (on iPhone, add the app to the Home Screen first)')
  if (!pushConfigured(c)) throw new Error('Push notifications are not set up yet — ask the hospital owner (Settings → Notifications → Push)')
  if (!isSupabaseConfigured || !supabase) throw new Error('Demo mode — push notifications need the live database')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this site — allow them in the browser’s site settings' : 'Permission was not given')
  const reg = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?config=${encodeURIComponent(JSON.stringify(webConfig(c)))}`, { scope: SW_SCOPE })
  const { m, messaging: msg } = await messaging(c)
  const token = await m.getToken(msg, { vapidKey: c.vapidKey, serviceWorkerRegistration: reg })
  if (!token) throw new Error('Could not get a device token from Firebase')
  const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: 'web', p_user_agent: navigator.userAgent.slice(0, 300) })
  if (error) throw new Error(error.message)
  localStorage.setItem(TOKEN_KEY, token)
  return token
}

export async function disablePush(c?: PushCfg) {
  const token = savedPushToken()
  localStorage.removeItem(TOKEN_KEY)
  if (token && supabase) await supabase.from('push_tokens').delete().eq('token', token)
  try {
    if (c && pushConfigured(c)) { const { m, messaging: msg } = await messaging(c); await m.deleteToken(msg) }
  } catch { /* already gone */ }
}

/** messages that arrive while the app is open (the service worker only handles background ones) */
export async function onForegroundPush(c: PushCfg, cb: (p: { title: string; body: string; link?: string }) => void): Promise<() => void> {
  const { m, messaging: msg } = await messaging(c)
  return m.onMessage(msg, (p) => cb({ title: p.notification?.title ?? 'Notification', body: p.notification?.body ?? '', link: p.data?.link }))
}
