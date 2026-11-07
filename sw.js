// Caches the app shell and every picture so One Split opens and looks the same offline. API calls (the Worker) are
// never cached here: the app keeps its own copy of the account's data on the device (src/data/repo.ts).
const CACHE = 'one-split-shell-v2' // v1 could hold a page whose scripts a later deploy deleted (blank app); activate drops it
const PICS = 'one-split-pictures-v1' // people / group pictures and receipts, from any site
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== PICS).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.protocol.startsWith('chrome')) return
  if (req.destination === 'image' && url.origin !== location.origin) {
    // Saved copy at once, refreshed in the background (a changed picture shows next time). Opaque answers are fine for <img>.
    const fresh = fetch(req).then((r) => { if (r.ok || r.type === 'opaque') { const copy = r.clone(); e.waitUntil(caches.open(PICS).then((c) => c.put(req, copy))) } return r })
    e.respondWith(caches.open(PICS).then((c) => c.match(req)).then((hit) => hit || fresh))
    e.waitUntil(fresh.then(() => {}, () => {}))
    return
  }
  if (url.origin !== location.origin && !/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return // Worker/API: network only
  if (url.pathname.endsWith('/version.json')) return // update check: always the network
  if (req.mode === 'navigate') {
    // Saved page first, so the app opens at once without waiting for the network; a fresh copy is fetched alongside and
    // saved for next time. A new deploy still arrives on this launch: update.ts sees the new version and reloads.
    // The saved page is used only when every script/style it names is saved too: a deploy deletes the old files, and a
    // page whose script 404s is a blank screen that can't even run its own update check.
    const fresh = fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })).then((r) => { if (r.ok) e.waitUntil(saveShell(r.clone())); return r })
    e.respondWith(complete().then((hit) => hit || fresh).catch(() => fresh))
    e.waitUntil(fresh.catch(() => {}))
    return
  }
  // Hashed build assets and fonts: cache first, fill on miss.
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) } return r })))
})

const assetsOf = (html) => [...html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+)"/g)].map((m) => new URL(m[1], self.registration.scope).href)

/** The saved page, only if all of its build files are saved too. */
async function complete() {
  const c = await caches.open(CACHE)
  const hit = await c.match('./index.html')
  if (!hit) return undefined
  const files = assetsOf(await hit.clone().text())
  const have = await Promise.all(files.map((u) => c.match(u)))
  return have.every(Boolean) ? hit : undefined
}

/** Save a fresh page: its build files first, the page last, so a saved page never points at files that aren't there. */
async function saveShell(r) {
  const html = await r.clone().text()
  const c = await caches.open(CACHE)
  await c.addAll(assetsOf(html))
  await c.put('./index.html', r)
}

// "Split from bank SMS" (iPhone): the Worker pushes { title, body, path } when a bank SMS arrives through the Shortcut.
self.addEventListener('push', (e) => {
  let m = {}
  try { m = e.data ? e.data.json() : {} } catch { /* not ours */ }
  if (!m.title) return
  e.waitUntil(self.registration.showNotification(m.title, { body: m.body || '', icon: './icons/icon-192.png', badge: './icons/icon-192.png', tag: m.path, data: { path: m.path || '/home' } }))
})
// Tap: bring the app forward on that screen (an open window is told to go there; otherwise one opens at it).
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const path = (e.notification.data && e.notification.data.path) || '/home'
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const w = list[0]
    if (w) { w.postMessage({ type: 'one-split:open', path }); return w.focus() }
    return self.clients.openWindow(`${self.registration.scope}#${path}`)
  }))
})
