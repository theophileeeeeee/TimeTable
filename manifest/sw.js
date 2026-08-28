const CACHE_NAME = 'timetable-v2';
const ASSETS = [
  '/TimeTable/',
  '/TimeTable/index.html',
  '/TimeTable/manifest/site.webmanifest',
  '/TimeTable/android-chrome-192x192.png',
  '/TimeTable/android-chrome-512x512.png'
];

const FIREBASE_PROJECT = 'timetableee';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== 'timetable-notif-state').map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes('/TimeTable/'));
      if (existing) return existing.focus();
      return self.clients.openWindow('/TimeTable/');
    })
  );
});

// Periodic sync — Chrome Android le déclenche en arrière-plan
self.addEventListener('periodicsync', e => {
  if (e.tag === 'timetable-daily-check') {
    e.waitUntil(checkAndNotify());
  }
});

// Message depuis l'appli (fallback quand l'appli est ouverte)
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CHECK_EVENTS') {
    checkAndNotify();
  }
});

async function checkAndNotify() {
  const now = new Date();
  const totalMin = now.getHours() * 60 + now.getMinutes();

  // Fenêtres : 7h50-8h10 (matin) et 20h50-21h10 (soir)
  const isMorning = totalMin >= 470 && totalMin <= 490;
  const isEvening = totalMin >= 1250 && totalMin <= 1270;
  if (!isMorning && !isEvening) return;

  const dateStr = toDateKey(now);
  const slotKey = `${isMorning ? 'morning' : 'evening'}-${dateStr}`;

  // Anti-doublon via cache
  const stateCache = await caches.open('timetable-notif-state');
  if (await stateCache.match(slotKey)) return;

  // Cible : aujourd'hui (matin) ou demain (soir)
  const target = new Date(now);
  if (isEvening) target.setDate(target.getDate() + 1);
  const targetKey = toDateKey(target);

  const events = await fetchEventsForDate(targetKey, target.getMonth() + 1, target.getDate());

  // Marque toujours comme vérifié pour cette fenêtre
  await stateCache.put(slotKey, new Response('done'));

  if (events.length === 0) return;

  const when = isEvening ? 'Demain' : "Aujourd'hui";
  const title = events.length === 1
    ? `📅 ${when} — ${events[0]}`
    : `📅 ${when} — ${events.length} événements`;
  const body = events.length > 1 ? events.join(' · ') : '';

  await self.registration.showNotification(title, {
    body,
    icon: '/TimeTable/android-chrome-192x192.png',
    badge: '/TimeTable/android-chrome-192x192.png',
    vibrate: [200, 100, 200],
    tag: `timetable-${isMorning ? 'morning' : 'evening'}`,
    renotify: false
  });
}

async function fetchEventsForDate(dateKey, month, day) {
  try {
    const res = await fetch(`${FIRESTORE_BASE}/calendarEvents?pageSize=200`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.documents) return [];

    return data.documents.reduce((acc, doc) => {
      const f = doc.fields || {};
      const text = f.text?.stringValue || '';
      const recurring = f.recurring?.booleanValue || false;
      const dates = f.dates?.arrayValue?.values?.map(v => v.stringValue).filter(Boolean)
        || (f.date?.stringValue ? [f.date.stringValue] : []);

      const hit = dates.some(dk => {
        const [, em, ed] = dk.split('-').map(Number);
        return recurring ? em === month && ed === day : dk === dateKey;
      });

      if (hit && text) acc.push(text);
      return acc;
    }, []);
  } catch (e) {
    console.warn('[SW] Firestore fetch failed:', e);
    return [];
  }
}

function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}