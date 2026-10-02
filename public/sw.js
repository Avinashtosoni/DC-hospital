/* DC Hospital service worker — makes the patient app installable and usable on flaky mobile networks.
 * - build assets (/assets/*, hashed): cache-first
 * - page navigations: network-first, fall back to the cached app shell when offline
 * - icons / landing images: stale-while-revalidate
 * - never cached: /env.js (runtime config), Supabase / API calls, anything cross-origin except Google Fonts
 * BUILD_ID is stamped at build time (vite.config.ts) so every deploy installs a fresh worker. */
const BUILD_ID = '__BUILD_ID__'
const SHELL = `dch-shell-${BUILD_ID}`
const ASSETS = 'dch-assets'
const MEDIA = 'dch-media'
// hashed assets of old deploys pile up in these caches — keep only the newest entries (oldest are dropped first)
const LIMITS = { [ASSETS]: 120, [MEDIA]: 80 }
async function trim(name) {
  const cache = await caches.open(name)
  const keys = await cache.keys()   // insertion order: oldest first
  const extra = keys.length - LIMITS[name]
  if (extra > 0) await Promise.all(keys.slice(0, extra).map((k) => cache.delete(k)))
}
let trimTimer = 0
const trimSoon = () => { clearTimeout(trimTimer); trimTimer = setTimeout(() => { trim(ASSETS).catch(() => {}); trim(MEDIA).catch(() => {}) }, 5000) }

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png', '/favicon.svg'])).catch(() => {}))
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k.startsWith('dch-shell-') && k !== SHELL).map((k) => caches.delete(k)))
    await Promise.all([trim(ASSETS), trim(MEDIA)]).catch(() => {})
    await self.clients.claim()
  })())
})

// the page asks the waiting worker to take over after the user taps "Update"
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting() })

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'
  if (url.origin !== self.location.origin && !fonts) return
  if (url.pathname === '/env.js' || url.pathname === '/sw.js' || url.pathname === '/healthz' || url.pathname.startsWith('/rest/') || url.pathname.startsWith('/functions/')) return
  // the control panel is a separate app — never cache it as the hospital app's page
  if (url.pathname === '/control-panel' || url.pathname.startsWith('/control-panel/')) return

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req)
        if (res.ok) (await caches.open(SHELL)).put('/', res.clone())
        return res
      } catch {
        return (await caches.match('/', { cacheName: SHELL })) || Response.error()
      }
    })())
    return
  }

  if (url.pathname.startsWith('/assets/') || fonts) {
    e.respondWith((async () => {
      const hit = await caches.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok || res.type === 'opaque') { (await caches.open(ASSETS)).put(req, res.clone()); trimSoon() }
      return res
    })())
    return
  }

  if (/\.(png|jpe?g|webp|svg|ico|webmanifest)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(MEDIA)
      const hit = await cache.match(req)
      const fresh = fetch(req).then((res) => { if (res.ok) { cache.put(req, res.clone()); trimSoon() } return res }).catch(() => hit)
      return hit || fresh
    })())
  }
})
