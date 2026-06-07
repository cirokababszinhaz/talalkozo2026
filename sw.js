// FIGYELEM: Átírtuk v21-re az új funkciók és elrendezés miatt!
const CACHE_NAME = 'talalkozo-cache-v38';

// Ide be kell írni minden fájlt, amit offline is látni akarunk
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './levesm.png',
  './dixie.png',
  './spaletta.png',
  './babszinhaz.png',
  './max.png',
  './tamogato1.png',
  './tamogato2.png',
  './tamogato3.png',
  './tamogato4.png',
  './tamogato5.png',
  './tamogato6.png',
  './kacsinto-szem.gif',
  './szem-hatter.png',
  './szem-nincs.png',
  './szem-nincs2.png',
  './szem-alap.png',
  './pupilla.png',
  './kurzor.png'
'./fb-megosztas.jpg'
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

  if (
    event.request.method !== 'GET' ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firebasedatabase.app') ||
    url.hostname.includes('firebasestorage.app') ||
    url.hostname.includes('google-analytics.com') ||
    url.hostname.includes('googletagmanager.com')
  ) {
    return;
  }

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
        // Offline fallback
      });
    })
  );
});