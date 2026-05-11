const CACHE_NAME = 'babtalalkozo-v4'; // Kicsit megemeltem a verziószámot a frissítés kikényszerítéséhez
const ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // KIVÉTELEK: Firebase adatbázis, Storage, külső API-k, és nem-GET kérések kihagyása
  if (
    e.request.method !== 'GET' || 
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firebasedatabase.app') ||
    url.hostname.includes('firebasestorage.app') ||
    url.hostname.includes('google-analytics.com') ||
    url.protocol === 'chrome-extension:'
  ) {
    // Ezeket a kéréseket simán átengedjük a hálózaton, nincs cachelés!
    return;
  }

  // A többi fájlra alkalmazzuk a "Hálózat először, majd Cache" stratégiát
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Csak érvényes, sikeres válaszokat cachelünk dinamikusan
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            // Biztonsági okokból érdemes lenne a cache méretét is limitálni később, de alapnak ez már jó
            cache.put(e.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        // Ha nincs net, visszadjuk a cache-ből, amit találunk
        return caches.match(e.request);
      })
  );
});