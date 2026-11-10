/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> }

// App shell: precached so delivery executives can open the app with no signal.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/admin\//] }))

// Map tiles for routes — public data, safe to cache on shared devices.
registerRoute(
  ({ url }) => url.hostname.endsWith('tile.openstreetmap.org'),
  new CacheFirst({ cacheName: 'osm-tiles', plugins: [new ExpirationPlugin({ maxEntries: 600, maxAgeSeconds: 14 * 24 * 3600 })] }),
)

// API responses are intentionally NOT cached: they carry personal and payment data.

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})
clientsClaim()

// ---------- Push notification architecture ----------
// Backend sends Web Push (VAPID) payloads: { title, body, link, tag }.
self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; link?: string; tag?: string }
  try {
    data = event.data?.json() ?? {}
  } catch {
    data = { body: event.data?.text() }
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'NewsRound', {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag,
      data: { link: data.link ?? '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data as { link?: string } | undefined)?.link ?? '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => 'focus' in w) as WindowClient | undefined
      if (win) {
        void win.navigate(link)
        return win.focus()
      }
      return self.clients.openWindow(link)
    }),
  )
})
