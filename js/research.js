// Online-Recherche von UVP (Deutschland) und Erscheinungsjahr über die Brickset-Datenbank.
// Brickset stellt einen kostenlosen API-Schlüssel bereit (brickset.com/tools/webservices/requestkey).
import { kv } from './store.js';

export async function getKeys() {
  return (await kv.get('apiKeys')) || { brickset: '' };
}
export async function setKeys(keys) { await kv.set('apiKeys', keys); }

export function bricksetNumber(n) {
  const s = String(n || '').trim();
  if (!s) return '';
  return s.includes('-') ? s : s + '-1';
}

export function bricksetUrl(n) {
  return 'https://brickset.com/sets/' + encodeURIComponent(bricksetNumber(n));
}

// Liefert ein Objekt mit gefundenen Werten oder wirft einen Fehler.
export async function lookup(number) {
  const { brickset } = await getKeys();
  if (!brickset) throw new Error('Kein Brickset-API-Schlüssel hinterlegt (Einstellungen).');
  const params = JSON.stringify({ setNumber: bricksetNumber(number), extendedData: 0 });
  const url = `https://brickset.com/api/v3.asmx/getSets?apiKey=${encodeURIComponent(brickset)}&userHash=&params=${encodeURIComponent(params)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Brickset nicht erreichbar (' + res.status + ')');
  const data = await res.json();
  if (data.status !== 'success') throw new Error('Brickset: ' + (data.message || 'Fehler'));
  const s = data.sets && data.sets[0];
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

// Ergänzt nur fehlende Felder, überschreibt keine eigenen Eingaben.
export async function enrich(set, { overwrite = false } = {}) {
  try {
    const r = await lookup(set.number);
    if (!r) {
      set.research = { status: 'notfound', source: 'Brickset', at: new Date().toISOString(), message: 'Set nicht gefunden' };
      return set;
    }
    for (const k of ['name', 'theme', 'subtheme', 'year', 'uvp', 'pieces', 'minifigs', 'imageUrl', 'retiredDate', 'availability']) {
      const empty = set[k] === null || set[k] === '' || set[k] === undefined;
      if ((empty || overwrite) && r[k] !== null && r[k] !== '') set[k] = r[k];
    }
    set.research = {
      status: r.uvp ? 'ok' : 'partial', source: 'Brickset', at: new Date().toISOString(),
      message: r.uvp ? '' : 'Keine deutsche UVP gefunden',
    };
  } catch (e) {
    set.research = { status: 'error', source: 'Brickset', at: new Date().toISOString(), message: e.message };
  }
  return set;
}
