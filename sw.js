// Raghuvamsha Reader — Service Worker
// Strategy: stale-while-revalidate for everything in scope, plus the
// cross-origin raghu.json data file. This means: serve instantly from
// cache when offline / for speed, while always fetching a fresh copy
// in the background to keep the next visit up to date.
//
// Bump CACHE_VERSION whenever app.js/index.html/CSS changes, so old
// clients pick up the new files promptly instead of waiting on the
// background revalidation alone.
var CACHE_VERSION = 'raghu-v7'; // bumped: footer safe-area fill added

var APP_SHELL = [
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

// The hosted data file lives on a different origin; cache it by exact
// URL so it's available offline after the first successful load.
var DATA_URL = 'https://gvssmark.github.io/raghu/raghu.json';

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(APP_SHELL).catch(function () {
        // Even if a couple of shell files fail (e.g. first deploy before
        // icons exist), don't block install entirely.
      });
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_VERSION; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  // updated.js is the version beacon — it must always be a real network hit
  // (with cache-busting handled by the page itself), never served from cache.
  if (req.url.indexOf('updated.js') !== -1) return;

  var isDataFile = req.url.indexOf(DATA_URL) === 0;
  var isSameOrigin = req.url.indexOf(self.location.origin) === 0;

  if (!isDataFile && !isSameOrigin) return; // let unrelated cross-origin requests pass through untouched

  event.respondWith(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.match(req).then(function (cached) {
        var networkFetch = fetch(req).then(function (fresh) {
          if (fresh && fresh.status === 200) cache.put(req, fresh.clone());
          return fresh;
        }).catch(function () {
          return cached; // offline and nothing fresh — fall back to cache (may be undefined)
        });
        // Stale-while-revalidate: return cache immediately if we have it,
        // otherwise wait on the network.
        return cached || networkFetch;
      });
    })
  );
});
