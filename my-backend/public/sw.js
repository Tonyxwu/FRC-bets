const CACHE_NAME = 'frc-match-markets-v1';
const STATIC_URLS = [
  '/',
  '/index.html',
  '/frontend.html',
  '/auth.html',
  '/event.html',
  '/market.html',
  '/match.html',
  '/bets.html',
  '/topbar.js',
  '/auth.js',
  '/icon.webp'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(STATIC_URLS.map(function (u) {
        return new Request(u, { cache: 'reload' });
      })).catch(function () {
        // If any single add fails, still activate (e.g. dev server paths)
        return Promise.resolve();
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // API: network first, no cache
  if (url.pathname.indexOf('/api/') === 0) {
    event.respondWith(fetch(event.request).catch(function () {
      return new Response(JSON.stringify({ error: 'Offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }));
    return;
  }

  // Static assets: cache first, fallback to network
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (res) {
        var clone = res.clone();
        if (res.status === 200 && (event.request.destination === 'document' || event.request.destination === 'script' || event.request.destination === 'style' || event.request.destination === 'image')) {
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return res;
      }).catch(function () {
        if (event.request.mode === 'navigate') {
          return caches.match('/frontend.html').then(function (c) {
            return c || new Response('Offline', { status: 503, statusText: 'Offline' });
          });
        }
        return new Response('', { status: 503 });
      });
    })
  );
});
