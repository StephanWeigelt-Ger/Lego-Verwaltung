// Online-Recherche der Setdaten.
// 1) Set-Katalog (data/katalog.json, wöchentlich aus der freien Rebrickable-Datenbank erzeugt):
//    Name, Erscheinungsjahr, Thema, Unterthema, Teileanzahl und Bild – ohne Schlüssel, sofort.
//    Ist das GitHub-Secret BRICKSET_KEY gesetzt, enthält der Katalog auch UVP Deutschland, Minifiguren
//    und Verkaufsende (von Brickset, ohne dass die App selbst einen Schlüssel braucht).
// 2) Optional: Brickset-API direkt aus der App, falls in den Einstellungen ein Schlüssel hinterlegt ist.
import { kv } from './store.js';
import * as data from './data.js';

export async function getKeys() {
  const synced = data.getSettings().brickset;
  if (synced) return { brickset: synced };
  const local = (await kv.get('apiKeys')) || { brickset: '' };
  return local;
}
export async function setKeys(keys) {
  await kv.set('apiKeys', keys);
  await data.saveSettings({ brickset: keys.brickset || '' });
}

export function bricksetNumber(n) {
  const s = String(n || '').trim();
  if (!s) return '';
  return s.includes('-') ? s : s + '-1';
}

export function bricksetUrl(n) {
  return 'https://brickset.com/sets/' + encodeURIComponent(bricksetNumber(n));
}

// ---------- Set-Katalog ----------
let catalogPromise = null;
function catalog() {
  if (!catalogPromise) {
    catalogPromise = fetch('data/katalog.json')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
    catalogPromise.then((c) => { if (!Object.keys(c).length) catalogPromise = null; });
  }
  return catalogPromise;
}

export async function lookupCatalog(number) {
  const c = await catalog();
  const n = bricksetNumber(number);
  const e = c[n] || c[String(number).trim()];
  if (!e) return null;
  const [name, year, theme, subtheme, pieces, uvp, minifigs, lastAvailable] = e;
  const r = {
    name, year: year || null, theme, subtheme, pieces: pieces || null,
    imageUrl: `https://cdn.rebrickable.com/media/sets/${encodeURIComponent(n)}.jpg`,
    uvp: uvp || null, minifigs: minifigs || null,
  };
  if (lastAvailable) {
    r.retiredDate = lastAvailable;
    r.availability = new Date(lastAvailable) < new Date() ? 'retired' : 'erhältlich';
  }
  return r;
}

// ---------- Brickset ----------
export async function lookupBrickset(number) {
  const { brickset } = await getKeys();
  if (!brickset) return null;
  const params = JSON.stringify({ setNumber: bricksetNumber(number), extendedData: 0 });
  const url = `https://brickset.com/api/v3.asmx/getSets?apiKey=${encodeURIComponent(brickset)}&userHash=&params=${encodeURIComponent(params)}`;
  let res;
  try { res = await fetch(url); } catch { throw new Error('Brickset nicht erreichbar'); }
  if (!res.ok) throw new Error('Brickset nicht erreichbar (' + res.status + ')');
  const json = await res.json();
  if (json.status !== 'success') throw new Error('Brickset: ' + (json.message || 'Fehler'));
  const s = json.sets && json.sets[0];
  if (!s) return null;
  const de = s.LEGOCom?.DE || {};
  const last = de.dateLastAvailable || s.exitDate || '';
  return {
    name: s.name,
    theme: s.theme || '',
    subtheme: s.subtheme || '',
    year: s.year || null,
    uvp: de.retailPrice || null,
    pieces: s.pieces || null,
    minifigs: s.minifigs || null,
    imageUrl: s.image?.imageURL || '',
    retiredDate: last ? last.slice(0, 10) : '',
    availability: last && new Date(last) < new Date() ? 'retired' : (s.availability ? 'erhältlich' : ''),
  };
}

const FIELDS = ['name', 'theme', 'subtheme', 'year', 'uvp', 'pieces', 'minifigs', 'imageUrl', 'retiredDate', 'availability'];

// Ergänzt fehlende Felder (eigene Eingaben bleiben erhalten, außer overwrite = true).
export async function enrich(set, { overwrite = false } = {}) {
  const sources = [];
  const notes = [];
  const apply = (r) => {
    for (const k of FIELDS) {
      if (r[k] === null || r[k] === undefined || r[k] === '') continue;
      const empty = set[k] === null || set[k] === '' || set[k] === undefined;
      if (empty || overwrite) set[k] = r[k];
    }
  };
  const cat = await lookupCatalog(set.number);
  if (cat) { apply(cat); sources.push('Set-Katalog'); }
  let bsError = '';
  try {
    const bs = await lookupBrickset(set.number);
    if (bs) { apply(bs); sources.push('Brickset'); }
  } catch (e) { bsError = e.message; }
  if (!set.uvp) notes.push(bsError || 'keine deutsche UVP gefunden');
  if (!set.year) notes.push('Erscheinungsjahr nicht gefunden');
  set.research = {
    status: !sources.length ? 'notfound' : set.uvp && set.year ? 'ok' : 'partial',
    source: sources.join(' + ') || '–',
    at: new Date().toISOString(),
    message: !sources.length ? 'Set nicht gefunden' + (notes.length ? ' (' + notes.join(', ') + ')' : '') : notes.join(', '),
  };
  return set;
}
