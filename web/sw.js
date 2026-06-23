/* A.C.T.I.G. service worker — offline shell + runtime caching.
 *
 * Strategy:
 *  - App shell (same-origin HTML/CSS/JS/icons): cache-first, so the UI loads
 *    instantly and works fully offline.
 *  - CDN ES modules (esm.run): stale-while-revalidate, cached after first online
 *    load so the libraries are available offline.
 *  - Model weights (WebLLM / transformers.js): handled by those libraries via
 *    the Cache API / IndexedDB; we deliberately do NOT intercept large range
 *    requests here.
 */
const SHELL = 'actig-shell-v12';
const RUNTIME = 'actig-runtime-v12';

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/holo.css',
  './js/app.js',
  './js/llm.js',
  './js/voice.js',
  './js/scene.js',
  './js/hands.js',
  './js/vision.js',
  './js/intent.js',
  './js/i18n.js',
  './js/modeler.js',
  './vendor/three.module.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![SHELL, RUNTIME].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never intercept large model/range requests — let the ML libs manage them.
  if (req.headers.has('range')) return;

  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    // App shell: cache-first.
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(req, copy)).catch(()=>{});
        return res;
      }).catch(() => caches.match('./index.html')))
    );
    return;
  }

  // CDN libraries: stale-while-revalidate.
  if (url.hostname.endsWith('esm.run') || url.hostname.endsWith('jsdelivr.net')) {
    e.respondWith(
      caches.open(RUNTIME).then(async (cache) => {
        const hit = await cache.match(req);
        const fetching = fetch(req).then((res) => { cache.put(req, res.clone()).catch(()=>{}); return res; }).catch(() => hit);
        return hit || fetching;
      })
    );
  }
});
