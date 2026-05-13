const CACHE_NAME = 'timetable-v2';
const ASSETS = [
  '/Timetable/',
  '/Timetable/index.html',
  '/Timetable/manifest/site.webmanifest',
  '/Timetable/android-chrome-192x192.png',
  '/Timetable/android-chrome-512x512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});