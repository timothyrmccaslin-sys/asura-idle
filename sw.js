// Asura service worker — precaches the app shell so the game runs fully offline.
// Bump VERSION on every release; the page shows "New version, tap to refresh".
// Saves live in localStorage, which this worker never touches.
const VERSION = 'asura-2.0.0';
const SHELL = [
  './', './index.html', './style.css', './main.js', './render.js', './figures.js',
  './pkg/asura_core.js', './pkg/asura_core_bg.wasm',
  './fonts/permanentmarker.woff2', './fonts/patrickhandsc.woff2', './fonts/yujisyuku-kanji.woff2',
  './assets/icon-192.png', './assets/icon-512.png', './assets/icon-maskable-192.png', './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png', './assets/character-sheet.jpg', './manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // only remove this game's old caches (the origin is shared with other apps)
    for (const k of await caches.keys()) if (k.startsWith('asura-') && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'VERSION' && e.ports[0]) e.ports[0].postMessage(VERSION);
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL('./', location).pathname)) return;
  if (req.mode === 'navigate') {
    // app shell first: always consistent with the cached version, works offline
    e.respondWith(caches.open(VERSION).then((c) => c.match('./index.html')).then((r) => r || fetch(req)));
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  })());
});
