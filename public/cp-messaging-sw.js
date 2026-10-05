/* Hospital Comrade control panel — Firebase Cloud Messaging service worker (team alerts in the background).
 * Registered by control-panel/src/push.ts with its own scope (/control-panel/push/), separate from the hospital
 * app's workers (/sw.js, /firebase-messaging-sw.js). The public Firebase web config arrives in the query string. */
/* global firebase, importScripts */
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js')

const params = new URL(self.location.href).searchParams
let config = null
try { config = JSON.parse(params.get('config') || 'null') } catch (e) { config = null }

if (config && config.projectId) {
  firebase.initializeApp(config)
  const messaging = firebase.messaging()
  messaging.onBackgroundMessage((payload) => {
    if (payload.notification) return
    const d = payload.data || {}
    self.registration.showNotification(d.title || 'Control panel', { body: d.body || '', icon: '/favicon.svg', tag: d.tag || d.event, data: { link: d.link || '/control-panel/' } })
  })
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const fcm = event.notification.data && event.notification.data.FCM_MSG
  let link = (fcm && fcm.data && fcm.data.link) || (event.notification.data && event.notification.data.link) || '/control-panel/'
  try { if (new URL(link, self.location.origin).origin !== self.location.origin) link = '/control-panel/' } catch (e) { link = '/control-panel/' }
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const panel = all.find((c) => new URL(c.url).pathname.startsWith('/control-panel'))
    if (panel) { await panel.focus(); if ('navigate' in panel) return panel.navigate(link).catch(() => {}) }
    return self.clients.openWindow(link)
  })())
})
