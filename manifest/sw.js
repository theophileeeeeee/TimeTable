const CACHE_NAME = 'timetable-v2';
const ASSETS = [
  '/TimeTable/',
  '/TimeTable/index.html',
  '/TimeTable/manifest/site.webmanifest',
  '/TimeTable/android-chrome-192x192.png',
  '/TimeTable/android-chrome-512x512.png'
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

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clientsArr => {
      const hadWindow = clientsArr.find(c => c.url.includes('/TimeTable/'));
      if (hadWindow) return hadWindow.focus();
      return self.clients.openWindow('/TimeTable/');
    })
  );
});
