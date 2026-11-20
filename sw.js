// Service worker : met l'application en cache pour fonctionner hors ligne.
const CACHE = 'folio-v3';
const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/ui.js', 'js/store.js', 'js/pdf.js', 'js/viewer.js', 'js/annot.js', 'js/ink.js',
  'js/save.js', 'js/pages.js', 'js/tools.js', 'js/zip.js', 'js/sign.js', 'js/lookup.js', 'js/study.js',
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'vendor/pdf-lib.min.js',
  'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Réseau d'abord pour les fichiers de l'app (mises à jour immédiates), cache en secours.
// Ressources externes (polices, cmaps, OCR) : cache d'abord.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cacheable = sameOrigin || /cdn\.jsdelivr\.net\/npm\/(pdfjs-dist|tesseract|@anthropic-ai)|fonts\.(googleapis|gstatic)\.com/.test(req.url);
  if (!cacheable) return;
  if (sameOrigin) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
  } else {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
