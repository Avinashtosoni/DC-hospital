/* DC Hospital — Firebase Cloud Messaging service worker (background push notifications).
 * Registered by src/lib/push.ts with its own scope, so it never clashes with the app worker (/sw.js).
 * The public Firebase web config arrives in the query string (it is not secret). */
/* global firebase, importScripts */
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js')

const params = new URL(self.location.href).searchParams
let config = null
try { config = JSON.parse(params.get('config') || 'null') } catch (e) { config = null }

if (config && config.projectId) {
  firebase.initializeApp(config)
  const messaging = firebase.messaging()
  // notification messages are shown by Firebase automatically; data-only messages get a notification here
  messaging.onBackgroundMessage((payload) => {
    if (payload.notification) return
    const d = payload.data || {}
    self.registration.showNotification(d.title || 'DC Hospital', { body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: d.event, data: { link: d.link || '/' } })
  })
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const fcm = event.notification.data && event.notification.data.FCM_MSG
  const link = (fcm && fcm.data && fcm.data.link) || (event.notification.data && event.notification.data.link) || '/'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const same = all.find((c) => new URL(c.url).origin === self.location.origin)
    if (same) { await same.focus(); if ('navigate' in same) return same.navigate(link).catch(() => {}) }
    return self.clients.openWindow(link)
  })())
})
