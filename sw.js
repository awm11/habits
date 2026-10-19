// Offline support for Daily Awesomeness.
// The app page is fetched fresh when online (so updates arrive) and served from cache when offline.
const APP_CACHE = 'awesomeness-app-v16';
const FONT_CACHE = 'awesomeness-fonts-v1';
const LIB_CACHE = 'awesomeness-libs-v1';
const NET_TIMEOUT = 3000;   // how long to wait for the network before using the saved copy
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== APP_CACHE && k !== FONT_CACHE && k !== LIB_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: use the cached copy, refresh it in the background.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(caches.open(FONT_CACHE).then(async cache => {
      const hit = await cache.match(req);
      const fresh = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
      event.waitUntil(fresh.catch(() => {}));
      return hit || withTimeout(fresh, NET_TIMEOUT).catch(() => new Response('', { status:504 }));
    }));
    return;
  }
  // Sign-in library: versioned files that never change, so keep them for offline starts.
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(caches.open(LIB_CACHE).then(async cache => {
      const hit = await cache.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // The page itself: try the network for up to 3 seconds, then use the saved copy.
  // The download carries on in the background, so a slow update still arrives for next time.
  if (req.mode === 'navigate') {
    // 'no-cache' asks GitHub whether the page has changed instead of reusing the browser's 10-minute copy
    const net = fetch(req.url, { cache:'no-cache', credentials:'same-origin' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(APP_CACHE).then(c => c.put('./index.html', copy)); }
      return res;
    });
    event.waitUntil(net.catch(() => {}));
    event.respondWith(
      withTimeout(net, NET_TIMEOUT).catch(async () => (await caches.match('./index.html')) || net)
    );
    return;
  }

  // Icons and manifest: cache first.
  event.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
