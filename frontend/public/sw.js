// CleanLoop service worker: installable PWA with an offline app shell.
// API calls, photos and map tiles always go to the network.
const SHELL = 'cleanloop-shell-v2';
const ASSETS = 'cleanloop-assets-v1';
const FONTS = 'cleanloop-fonts-v1';
const PRECACHE = [
  '/',
  '/index.html',
  '/landing.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL, ASSETS, FONTS]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Pages: network first so a new deploy shows up, cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // The landing page is its own document; every other route is the app shell.
          const key = url.pathname === '/landing.html' ? '/landing.html' : '/index.html';
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(key, copy));
          return res;
        })
        .catch(() =>
          caches.match(url.pathname === '/landing.html' ? '/landing.html' : '/index.html'),
        ),
    );
    return;
  }

  // Hashed build assets never change: cache first.
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(ASSETS).then((c) => c.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Google Fonts: serve cached, refresh in the background.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONTS).then((cache) =>
        cache.match(request).then((hit) => {
          const network = fetch(request)
            .then((res) => {
              cache.put(request, res.clone());
              return res;
            })
            .catch(() => hit);
          return hit || network;
        }),
      ),
    );
  }
});
