// Lokale Datenhaltung (IndexedDB) und Datenmodell.
// Die gesamte Sammlung ist ein JSON-Objekt; Fotos liegen separat als Blobs.

const DB_NAME = 'lego-verwaltung';
const DB_VERSION = 1;
let idbPromise;

function idb() {
  if (!idbPromise) {
    idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return idbPromise;
}

async function tx(store, mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const res = fn(s);
    t.oncomplete = () => resolve(res && 'result' in res ? res.result : res);
    t.onerror = () => reject(t.error);
  });
}

export const kv = {
  get: (k) => tx('kv', 'readonly', (s) => s.get(k)),
  set: (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k)),
  del: (k) => tx('kv', 'readwrite', (s) => s.delete(k)),
};
export const photoStore = {
  get: (k) => tx('photos', 'readonly', (s) => s.get(k)),
  set: (k, v) => tx('photos', 'readwrite', (s) => s.put(v, k)),
  del: (k) => tx('photos', 'readwrite', (s) => s.delete(k)),
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
export const now = () => new Date().toISOString();

export function emptyCollection() {
  return { schema: 1, sets: {}, deleted: {}, updatedAt: now() };
}

export function newSet(fields = {}) {
  return {
    id: uid(),
    number: '',        // Setnummer, z. B. "10294"
    name: '',
    theme: '',
    subtheme: '',
    year: null,        // Erscheinungsjahr
    uvp: null,         // UVP Deutschland in Euro
    pieces: null,
    minifigs: null,
    availability: '',  // '', 'erhältlich', 'retired'
    retiredDate: '',   // letzter Verkaufstag bei LEGO
    marketValue: null, // geschätzter aktueller Marktwert in Euro
    imageUrl: '',      // offizielles Setbild (Recherche)
    wishlist: false,   // nur Wunschliste, noch nicht gekauft
    notes: '',
    research: null,    // { status, source, at, message }
    copies: [],
    photos: [],        // { id, copyId, thumb, enhanced, createdAt, uploaded }
    createdAt: now(),
    updatedAt: now(),
    ...fields,
  };
}

export function newCopy(fields = {}) {
  return {
    id: uid(),
    purchaseDate: '',  // JJJJ-MM-TT
    price: null,       // Einkaufspreis in Euro
    shop: '',          // Händler / Quelle
    condition: null,   // Zustand der Packung 1–10
    damage: '',        // Beschädigungen (Freitext)
    state: 'versiegelt', // versiegelt | geöffnet | aufgebaut | zerlegt
    complete: true,
    instructions: true,
    location: '',      // Lagerort
    soldDate: '',
    soldPrice: null,
    notes: '',
    ...fields,
  };
}

// Zwei Stände der Sammlung zusammenführen: pro Set gewinnt der neuere Stand,
// Löschungen (Tombstones) gewinnen, wenn sie neuer sind als die letzte Änderung.
export function merge(a, b) {
  if (!a) return b;
  if (!b) return a;
  const out = emptyCollection();
  out.deleted = { ...a.deleted };
  for (const [id, ts] of Object.entries(b.deleted || {})) {
    if (!out.deleted[id] || out.deleted[id] < ts) out.deleted[id] = ts;
  }
  const ids = new Set([...Object.keys(a.sets || {}), ...Object.keys(b.sets || {})]);
  for (const id of ids) {
    const x = a.sets[id], y = b.sets[id];
    let pick = !x ? y : !y ? x : (x.updatedAt >= y.updatedAt ? x : y);
    if (out.deleted[id] && out.deleted[id] >= pick.updatedAt) continue;
    out.sets[id] = pick;
  }
  const sa = a.settings, sb = b.settings;
  if (sa || sb) out.settings = !sa ? sb : !sb ? sa : (sa.updatedAt >= sb.updatedAt ? sa : sb);
  out.updatedAt = a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt;
  return out;
}

function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v ?? null);
}
export function sameContent(a, b) {
  return stable(a) === stable(b);
}

export function normalizeSetNumber(n) {
  return String(n ?? '').trim().replace(/\s+/g, '').replace(/\.0$/, '');
}
