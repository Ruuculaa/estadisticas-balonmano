// Service worker minimo: cachea los archivos de la app (HTML/CSS/JS/iconos) para que cargue
// mas rapido y de forma mas fiable. Nunca cachea Firestore ni ninguna llamada a una API:
// solo se activa para peticiones al propio dominio de la app.
const CACHE_NAME = 'balonmano-stats-multiclub-v2';
const APP_SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app-core.js',
  '/js/app-stats.js',
  '/js/app-clock.js',
  '/js/app-views.js',
  '/js/app-auth.js',
  '/assets/favicon.png',
  '/assets/apple-touch-icon.png',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});