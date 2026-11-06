/* Keepers service worker. Generated at build time from src/sw/sw.template.js.
 *
 * After the first visit to the app, Keepers works offline:
 *  - the app shell is precached (this build's hashed files),
 *  - the face and image models and the MediaPipe runtime are cached the first
 *    time they load (their URLs carry a version, so they never go stale),
 *  - pages are network first, so a new deploy shows up on the next visit.
 */
const BUILD = '__BUILD_ID__'
const PRECACHE = __PRECACHE__
/** Versioned model and runtime files; shared across builds. */
const MODELS = __MODELS__
const APP_CACHE = `keeper-app-${BUILD}`
const RUNTIME_CACHE = 'keeper-runtime-v1'
const PRECACHED = new Set(PRECACHE)

async function cacheModels() {
  // The analysis workers may fetch these before this worker takes control, so
  // fetch them here too. Usually served from the HTTP cache, not the network.
  const cache = await caches.open(RUNTIME_CACHE)
  for (const path of MODELS) {
    if (await cache.match(path)) continue
    try {
      const response = await fetch(path)
      if (response.ok) await cache.put(path, response)
    } catch {
      // Offline or out of space: the app still works online; try next time.
    }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('keeper-app-') && name !== APP_CACHE) await caches.delete(name)
      }
      // Forget model and runtime files this build no longer uses.
      const runtime = await caches.open(RUNTIME_CACHE)
      for (const request of await runtime.keys()) {
        const path = new URL(request.url).pathname
        if (/^\/(models|mediapipe)\//.test(path) && !MODELS.includes(path)) await runtime.delete(request)
      }
      await self.clients.claim()
      await cacheModels()
    })(),
  )
})

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok && response.type === 'basic') await cache.put(request, response.clone())
  return response
}

async function networkFirst(request, fallbackKey) {
  const cache = await caches.open(APP_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok && response.type === 'basic') await cache.put(fallbackKey ?? request, response.clone())
    return response
  } catch (err) {
    const hit = await cache.match(fallbackKey ?? request)
    if (hit) return hit
    throw err
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Every page is the same single-page app shell.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/'))
    return
  }
  if (PRECACHED.has(url.pathname)) {
    event.respondWith(cacheFirst(request, APP_CACHE))
    return
  }
  if (url.pathname === '/samples/manifest.json') {
    event.respondWith(networkFirst(request))
    return
  }
  if (/^\/(assets|models|mediapipe|samples)\//.test(url.pathname)) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE))
  }
})
