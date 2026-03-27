// Build: 2026-03-27 00:00:00
const CACHE_NAME = 'back-of-flyer-memo-pwa-cache-20260327000000';
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './manifest.json',
  'https://fonts.googleapis.com/icon?family=Material+Icons'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting()) // Activate new SW immediately
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => self.clients.claim()) // Take control of all clients
  );
});

self.addEventListener('fetch', event => {
  // Cache First, falling back to Network
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request).then(
          networkResponse => {
            // Check if we received a valid response
            if(!networkResponse || networkResponse.status !== 200) {
              return networkResponse;
            }

            // IMPORTANT: Clone the response. A response is a stream
            // and because we want the browser to consume the response
            // as well as the cache consuming the response, we need
            // to clone it so we have two streams.
            const responseToCache = networkResponse.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          }
        ).catch(error => {
          // This catch() will handle network errors
          console.log('Fetch failed; returning offline page instead.', error);
        });
      })
    );
});
