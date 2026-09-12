const CACHE_NAME = 'timetable-v3';

// Base déduite automatiquement de l'endroit où ce fichier est servi :
// racine en local ("http://127.0.0.1:5500/"), sous-dossier en prod
// ("https://xxx.github.io/TimeTable/"), etc. Fini le chemin codé en dur.
const BASE = self.registration.scope; // se termine toujours par "/"

const ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest/site.webmanifest',
  BASE + 'android-chrome-192x192.png',
  BASE + 'android-chrome-512x512.png'
];

const FIREBASE_PROJECT = 'timetableee';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // addAll échoue en bloc si UN SEUL asset 404 (ex: icônes absentes en dev) —
      // on ajoute donc individuellement pour ne jamais bloquer l'installation du SW.
      Promise.all(ASSETS.map(url => cache.add(url).catch(err => console.warn('[SW] Asset non mis en cache:', url, err))))
    )
  );
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
      const existing = list.find(c => c.url.startsWith(BASE));
      if (existing) return existing.focus();
      return self.clients.openWindow(BASE);
    })
  );
});

// Periodic sync — Chrome Android le déclenche en arrière-plan.
// ATTENTION (limitation du navigateur, pas un bug) : periodicSync ne se
// déclenche de façon fiable QUE si le site est installé en PWA (ajouté à
// l'écran d'accueil) ET que Chrome juge l'engagement suffisant. Dans un
// onglet classique, il peut ne jamais se déclencher — c'est normal.
self.addEventListener('periodicsync', e => {
  if (e.tag === 'timetable-daily-check') {
    e.waitUntil(checkAndNotify());
  }
});

// Message depuis l'appli (fallback fiable quand l'appli est ouverte)
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CHECK_EVENTS') {
    e.waitUntil ? e.waitUntil(checkAndNotify()) : checkAndNotify();
  }
});

async function checkAndNotify() {
  const now = new Date();
  const totalMin = now.getHours() * 60 + now.getMinutes();

  // Créneaux larges plutôt qu'une fenêtre de 20 min : sur mobile, un service
  // worker web ne peut pas se réveiller tout seul en arrière-plan de façon
  // fiable (limite du système, pas de ce code) — la vérif se fait donc
  // surtout à l'ouverture de l'app. Avec une fenêtre large (matinée entière /
  // soirée entière), la première ouverture de l'app dans la période suffit à
  // déclencher la notif, peu importe l'heure exacte.
  const isMorning = totalMin >= 360 && totalMin < 720;   // 6h00 → 12h00
  const isEvening = totalMin >= 1080 && totalMin < 1440;  // 18h00 → 23h59
  if (!isMorning && !isEvening) {
    console.log('[SW] Hors créneau (matin 6h-12h / soir 18h-minuit). Heure actuelle:', now.getHours()+'h'+now.getMinutes());
    return;
  }

  const dateStr = toDateKey(now);
  const slotKey = `${isMorning ? 'morning' : 'evening'}-${dateStr}`;

  // Anti-doublon via cache
  const stateCache = await caches.open('timetable-notif-state');
  if (await stateCache.match(slotKey)) {
    console.log('[SW] Créneau déjà vérifié aujourd\'hui:', slotKey);
    return;
  }

  // Cible : aujourd'hui (matin) ou demain (soir)
  const target = new Date(now);
  if (isEvening) target.setDate(target.getDate() + 1);
  const targetKey = toDateKey(target);

  const events = await fetchEventsForDate(targetKey, target.getMonth() + 1, target.getDate());

  // Marque toujours comme vérifié pour cette fenêtre
  await stateCache.put(slotKey, new Response('done'));

  if (events.length === 0) {
    console.log('[SW] Aucun événement trouvé pour', targetKey);
    return;
  }

  const when = isEvening ? 'Demain' : "Aujourd'hui";
  const title = events.length === 1
    ? `📅 ${when} — ${events[0]}`
    : `📅 ${when} — ${events.length} événements`;
  const body = events.length > 1 ? events.join(' · ') : '';

  await self.registration.showNotification(title, {
    body,
    icon: BASE + 'android-chrome-192x192.png',
    badge: BASE + 'android-chrome-192x192.png',
    vibrate: [200, 100, 200],
    tag: `timetable-${isMorning ? 'morning' : 'evening'}`,
    renotify: false
  });
}

async function fetchEventsForDate(dateKey, month, day) {
  try {
    const res = await fetch(`${FIRESTORE_BASE}/calendarEvents?pageSize=200`);
    if (!res.ok) {
      console.warn('[SW] Firestore a répondu', res.status, '— vérifie que les règles Firestore autorisent la lecture publique de "calendarEvents".');
      return [];
    }
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