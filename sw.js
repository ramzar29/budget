// Service worker : garde l'app disponible hors ligne.
// Change VERSION à chaque mise à jour publiée pour que les téléphones prennent la nouvelle version.
const VERSION = 'budget-v17';
const FICHIERS = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/db.js', 'js/calc.js', 'js/etat.js', 'js/sync.js', 'js/lock.js',
  'js/ui.js', 'js/saisie.js', 'js/reglages.js', 'js/ocr.js', 'js/defaults.js', 'js/analyse.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', e => {
  // cache: 'reload' : télécharge les vrais nouveaux fichiers (pas la copie gardée 10 min par GitHub).
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FICHIERS.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(cles => Promise.all(cles.filter(k => k.startsWith('budget-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;            // la synchro (POST) passe directement
  if (url.hostname.endsWith('google.com') || url.hostname.endsWith('googleusercontent.com')) return;

  // Bibliothèques externes (lecture photo) : mises en cache après le premier téléchargement.
  if (url.origin !== location.origin) {
    e.respondWith(caches.open('ext-v1').then(async c => {
      const enCache = await c.match(e.request);
      if (enCache) return enCache;
      const rep = await fetch(e.request);
      if (rep.ok) c.put(e.request, rep.clone());
      return rep;
    }));
    return;
  }

  // Fichiers de l'app : réseau d'abord en revalidant toujours auprès de GitHub (no-cache), sinon cache (hors ligne).
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(rep => {
    if (rep.ok) { const copie = rep.clone(); caches.open(VERSION).then(c => c.put(e.request, copie)); }
    return rep;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
