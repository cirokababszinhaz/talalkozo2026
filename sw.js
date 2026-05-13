const CACHE_NAME = 'talalkozo-cache-v1';

// Ide be kell írni minden fájlt, amit offline is látni akarunk
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './levesm.png',
  './dixie.png',
  './spaletta.png',
  './tamogato1.png',
  './tamogato2.png',
  './tamogato3.png',
  './tamogato4.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // A Firebase adatbázist és a GA4-et SOHA ne cacheljük, mert hibát okoz!
  if (
    event.request.method !== 'GET' ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firebasedatabase.app') ||
    url.hostname.includes('firebasestorage.app') ||
    url.hostname.includes('google-analytics.com')
  ) {
    return; // Átengedjük a neten
  }

  // Minden mást (HTML, képek) először a Cache-ből próbálunk betölteni (Offline elsőbbség)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      }).catch(() => {
        // Ha nincs net és nincs cache-ben, nem csinálunk semmit
      });
    })
  );
});