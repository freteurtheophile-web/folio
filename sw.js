// Service worker : met l'application en cache pour fonctionner hors ligne.
const CACHE = 'folio-v4';
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
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== SHARE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Réseau d'abord pour les fichiers de l'app (mises à jour immédiates), cache en secours.
// Ressources externes (polices, cmaps, OCR) : cache d'abord.
// « Partager → Folio » (Android) : le fichier arrive en POST. On le garde dans un cache
// temporaire, puis on ouvre l'application qui le récupère (voir app.js, checkShared).
const SHARE = 'folio-share';
async function receiveShare(req) {
  const data = await req.formData();
  const files = data.getAll('file').filter(f => f && typeof f !== 'string' && f.size);
  const cache = await caches.open(SHARE);
  const stamp = Date.now();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    await cache.put(`./__shared/${stamp}-${i}`, new Response(f, {
      headers: { 'Content-Type': f.type || 'application/pdf', 'X-Name': encodeURIComponent(f.name || 'document.pdf') },
    }));
  }
  if (!files.length) {
    const link = data.get('url') || data.get('text') || '';
    await cache.put(`./__shared/${stamp}-link`, new Response(String(link), { headers: { 'X-Link': '1' } }));
  }
  // Si Folio est déjà ouvert et simplement remis au premier plan, app.js le récupère via launchQueue.
  return Response.redirect(new URL('./?shared=' + stamp, self.registration.scope).href, 303);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) { e.respondWith(receiveShare(req)); return; }
  if (req.method !== 'GET') return;
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
