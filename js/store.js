// Stockage local (IndexedDB) : réglages, annotations, documents récents, signatures.
// Tout reste sur l'appareil.

const DB_NAME = 'folio';
const STORES = ['kv', 'annots', 'recents', 'signatures'];
let dbp;

function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  } catch (e) { console.warn('IndexedDB indisponible', e); return undefined; }
}

export const idb = {
  get: (store, key) => tx(store, 'readonly', s => s.get(key)),
  set: (store, key, val) => tx(store, 'readwrite', s => s.put(val, key)),
  del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
  all: async (store) => {
    const keys = await tx(store, 'readonly', s => s.getAllKeys()) || [];
    const vals = await tx(store, 'readonly', s => s.getAll()) || [];
    return keys.map((k, i) => ({ key: k, value: vals[i] }));
  },
};

// --- Réglages -------------------------------------------------------------
export const DEFAULTS = {
  theme: 'dark',              // dark | light | system
  pageMode: 'normal',         // normal | sepia | night | gray | contrast
  pageDim: 0,                 // 0..0.6 assombrissement des pages
  blueFilter: 0,              // 0..0.8 filtre lumière bleue
  blueAuto: false,            // activer automatiquement le soir
  blueFrom: '20:00', blueTo: '07:00', blueAutoLevel: 0.35,
  fingerDraw: false,          // dessiner au doigt (sinon le doigt fait défiler)
  pressureCurve: 1.0,         // gamma de la courbe de pression
  pressureMin: 0.0,           // pression minimale prise en compte
  smoothing: 0.5,             // lissage des traits
  straighten: true,           // maintenir en fin de trait pour tracer droit
  translateEngine: 'google',  // google | mymemory | claude
  translateTo: 'fr',
  dictLang: 'fr',
  claudeKey: '',
  claudeModel: 'claude-opus-5-5',
  eyeReminder: false,         // rappel 20-20-20
  pomodoroWork: 25, pomodoroBreak: 5,
  spread: false,
  sidebar: true,
  penPresets: null,           // stylos favoris personnalisés
};

let settings = { ...DEFAULTS };
const listeners = new Set();

export async function loadSettings() {
  const s = await idb.get('kv', 'settings');
  settings = { ...DEFAULTS, ...(s || {}) };
  return settings;
}
export function getSettings() { return settings; }
export function setSetting(k, v) {
  settings[k] = v;
  idb.set('kv', 'settings', settings);
  for (const l of listeners) l(k, v);
}
export function onSetting(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// --- Documents récents ----------------------------------------------------
const MAX_RECENTS = 16;
const MAX_STORED_BYTES = 60 * 1024 * 1024;

export async function addRecent({ key, name, size, bytes, handle, pages }) {
  const all = await idb.all('recents');
  const entry = { name, size, pages, at: Date.now(), handle: handle || null,
    bytes: !handle && bytes && bytes.byteLength < MAX_STORED_BYTES ? bytes : null };
  const prev = all.find(r => r.key === key)?.value;
  if (prev?.lastPage) entry.lastPage = prev.lastPage;
  if (prev?.bookmarks) entry.bookmarks = prev.bookmarks;
  if (prev?.readMs) entry.readMs = prev.readMs;
  await idb.set('recents', key, entry);
  const sorted = all.filter(r => r.key !== key).sort((a, b) => b.value.at - a.value.at);
  for (const r of sorted.slice(MAX_RECENTS - 1)) await idb.del('recents', r.key);
}

export async function patchRecent(key, patch) {
  const r = await idb.get('recents', key);
  if (r) await idb.set('recents', key, { ...r, ...patch });
}

export async function listRecents() {
  const all = await idb.all('recents');
  // Nettoie les entrées incomplètes (anciennes versions).
  for (const r of all) if (!r.value?.name) await idb.del('recents', r.key);
  return all.filter(r => r.value?.name).sort((a, b) => b.value.at - a.value.at);
}
