const CACHE_NAME = 'babtalalkozo-cache-v1';
const urlsToCache =[
  './index.html',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Ha megvan a cache-ben, azt adja vissza (offline mód), egyébként lekéri a netről
        return response || fetch(event.request);
      })
  );
});