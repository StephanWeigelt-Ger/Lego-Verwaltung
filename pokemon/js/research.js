// Online-Recherche über TCGdex (https://tcgdex.dev): freie Pokémon-TCG-Datenbank, ohne Schlüssel,
// mit deutschen Namen, Erscheinungsdaten, Seltenheit und Cardmarket-Preisen (Euro, täglich aktualisiert).
// 1) Katalog (data/katalog.json, wöchentlich per GitHub Action erzeugt): alle Sets und Karten auf Deutsch
//    und Englisch für die schnelle Suche, auch offline und beim Excel-Import.
// 2) TCGdex direkt aus der App: Details einer Karte inkl. aktuellem Marktwert.
import { normalizeCardNumber } from './store.js';

const API = 'https://api.tcgdex.net/v2';
export const LANGS = { Deutsch: 'de', Englisch: 'en', Japanisch: 'ja', Französisch: 'fr', Italienisch: 'it', Spanisch: 'es', Portugiesisch: 'pt', Koreanisch: 'ko', 'Chinesisch (trad.)': 'zh-tw' };
export const langCode = (language) => LANGS[language] || 'de';

// ---------- Katalog ----------
// Format: { sets: { id: [name_de, name_en, serie_de, serieId, releaseDate, official, total] },
//           cards: { de: [[id, localId, name, hatBild], ...], en: [...] } }
let catalogPromise = null;
export function catalog() {
  if (!catalogPromise) {
    catalogPromise = fetch('data/katalog.json')
      .then((r) => (r.ok ? r.json() : { sets: {}, cards: {} }))
      .catch(() => ({ sets: {}, cards: {} }));
    catalogPromise.then((c) => { if (!Object.keys(c.sets || {}).length) catalogPromise = null; });
  }
  return catalogPromise;
}

function setInfo(c, setId) {
  const s = c.sets?.[setId];
  if (!s) return null;
  const [nameDe, nameEn, serie, serieId, releaseDate, official, total] = s;
  return { id: setId, nameDe, nameEn, serie, serieId, releaseDate, official, total };
}

function imageUrl(lang, serieId, setId, localId) {
  return serieId ? `https://assets.tcgdex.net/${lang}/${serieId}/${setId}/${encodeURIComponent(localId)}` : '';
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Alle Sets für Auswahllisten (neueste zuerst)
export async function allSets() {
  const c = await catalog();
  return Object.keys(c.sets || {}).map((id) => setInfo(c, id))
    .sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));
}

// Set anhand eines Namens oder Kürzels finden (für Excel-Import), z. B. "151", "Karmesin & Purpur – 151", "sv03.5"
export async function findSet(text) {
  const c = await catalog();
  const t = norm(text);
  if (!t) return null;
  if (c.sets?.[String(text).trim()]) return setInfo(c, String(text).trim());
  let best = null, bestScore = 0;
  for (const id of Object.keys(c.sets || {})) {
    const s = setInfo(c, id);
    for (const n of [s.nameDe, s.nameEn, id]) {
      const nn = norm(n);
      if (!nn) continue;
      let score = 0;
      if (nn === t) score = 100;
      else if (t.endsWith(' ' + nn) || t.startsWith(nn + ' ')) score = 60 + nn.length; // "Karmesin & Purpur 151"
      else if (nn.includes(t) && t.length >= 4) score = 40 + t.length;
      if (score > bestScore) { bestScore = score; best = s; }
    }
  }
  return best;
}

// Karten nach Name suchen (Katalog), optional auf ein Set beschränkt
export async function searchCards(query, { language = 'Deutsch', setId = '', limit = 60 } = {}) {
  const c = await catalog();
  const lang = c.cards?.[langCode(language)] ? langCode(language) : 'de';
  const list = c.cards?.[lang] || [];
  const q = norm(query);
  const num = normalizeCardNumber(query);
  const out = [];
  for (const [id, localId, name, hasImg] of list) {
    const sid = id.slice(0, id.length - String(localId).length - 1);
    if (setId && sid !== setId) continue;
    if (q && !norm(name).includes(q) && !(setId && normalizeCardNumber(localId) === num)) continue;
    const s = setInfo(c, sid) || { id: sid };
    out.push({ id, localId, name, setId: sid, setName: (lang === 'de' ? s.nameDe : s.nameEn) || s.nameDe || s.nameEn || sid,
      releaseDate: s.releaseDate || '', official: s.official, image: hasImg ? imageUrl(lang, s.serieId, sid, localId) : '', lang });
    if (out.length >= limit * 4) break;
  }
  out.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || '') || String(a.localId).localeCompare(String(b.localId), 'de', { numeric: true }));
  return out.slice(0, limit);
}

// Karte über Set + Nummer finden
export async function findCard(setId, number, language = 'Deutsch') {
  const c = await catalog();
  const want = normalizeCardNumber(number);
  for (const lang of [langCode(language), 'de', 'en']) {
    for (const [id, localId] of c.cards?.[lang] || []) {
      if (id.startsWith(setId + '-') && id.length === setId.length + 1 + String(localId).length && normalizeCardNumber(localId) === want) return id;
    }
  }
  return setId && want ? `${setId}-${number}` : '';
}

// Pokémon aus dem Kartennamen ableiten: "Glurak-ex" -> "Glurak", "Erikas Myrapla" -> "Myrapla",
// "Alola-Vulpix" -> "Vulpix", "Pikachu VMAX" -> "Pikachu". Bei Trainer- und Energiekarten leer.
export function pokemonFromName(name, category = '') {
  if (/trainer|energ/i.test(category)) return '';
  let n = String(name || '').trim();
  n = n.replace(/^(Team (Rockets?|Aquas?|Magmas?)'?s?|Rocket's)\s+/i, '');
  for (let i = 0; i < 3; i++) {
    n = n.replace(/^(Mega-|M\s|Alola-|Galar-|Hisui-|Paldea-|Dunkle[sr]?\s|Leuchtende[sr]?\s|Strahlende[sr]?\s|Glänzende[sr]?\s|Schillernde[sr]?\s|Licht-?\s?|Dark\s|Light\s|Shining\s|Radiant\s|Alolan\s|Galarian\s|Hisuian\s|Paldean\s)/i, '');
  }
  n = n.replace(/[\s-]+(ex|EX|GX|V|VMAX|VSTAR|V-STAR|V-UNION|BREAK|LV\.?\s?X|Prime|LEGENDE|LEGEND|δ|☆|Star|TAG TEAM|Spezial)(\b.*)?$/, '');
  const words = n.split(/\s+/);
  if (words.length > 1 && /^[A-ZÄÖÜ][\wäöüß.]*('?s|s')$/.test(words[0]) && !/^(Mr|Mrs)\.?$/.test(words[0])) n = words.slice(1).join(' ');
  n = n.replace(/^Lt\.\s+Surges?\s+/i, '');
  return n.trim();
}

// ---------- TCGdex live ----------
async function api(lang, path) {
  let res;
  try { res = await fetch(`${API}/${lang}/${path}`); } catch { throw new Error('TCGdex nicht erreichbar'); }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('TCGdex nicht erreichbar (' + res.status + ')');
  return res.json();
}

const TYPES_DE = { Grass: 'Pflanze', Fire: 'Feuer', Water: 'Wasser', Lightning: 'Elektro', Psychic: 'Psycho', Fighting: 'Kampf', Darkness: 'Finsternis', Metal: 'Metall', Dragon: 'Drache', Fairy: 'Fee', Colorless: 'Farblos' };
const CAT_DE = { Pokemon: 'Pokémon', 'Pokémon': 'Pokémon', Trainer: 'Trainer', Energy: 'Energie' };

export async function lookupCard(tcgdexId, language = 'Deutsch') {
  const c = await catalog();
  const sid = tcgdexId.replace(/-[^-]+$/, '');
  const result = { tcgdexId };
  const s = setInfo(c, sid);
  if (s) Object.assign(result, { setId: sid, setName: (language === 'Englisch' ? s.nameEn : s.nameDe) || s.nameDe || s.nameEn, serie: s.serie, setTotal: s.official || null, releaseDate: s.releaseDate || '' });
  const sources = [];
  if (s) sources.push('Katalog');
  let card = null, error = '';
  for (const lang of [...new Set([langCode(language), 'de', 'en'])]) {
    try { card = await api(lang, 'cards/' + encodeURIComponent(tcgdexId)); } catch (e) { error = e.message; break; }
    if (card) { card.lang = lang; break; }
  }
  if (card) {
    sources.push('TCGdex');
    Object.assign(result, {
      name: card.name,
      number: card.localId,
      setId: card.set?.id || result.setId,
      setName: result.setName || card.set?.name,
      setTotal: card.set?.cardCount?.official || result.setTotal || null,
      rarity: card.rarity || '',
      category: CAT_DE[card.category] || card.category || '',
      types: (card.types || []).map((t) => TYPES_DE[t] || t).join(', '),
      hp: card.hp || null,
      illustrator: card.illustrator || '',
      imageUrl: card.image ? card.image + '/high.webp' : '',
    });
    const cm = card.pricing?.cardmarket;
    if (cm) {
      result.marketValue = cm.trend ?? cm.avg30 ?? cm.avg ?? null;
      result.marketValueHolo = cm['trend-holo'] ?? cm['avg30-holo'] ?? null;
      result.marketUpdated = (cm.updated || '').slice(0, 10);
    }
    if (!result.releaseDate && result.setId) {
      try {
        const set = await api(card.lang, 'sets/' + encodeURIComponent(result.setId));
        if (set) { result.releaseDate = set.releaseDate || ''; result.serie = result.serie || set.serie?.name || ''; }
      } catch { /* egal */ }
    }
  } else if (s) {
    const lid = tcgdexId.slice(sid.length + 1);
    const lang = langCode(language) === 'en' ? 'en' : 'de';
    const hit = (c.cards?.[lang] || []).find((x) => x[0] === tcgdexId);
    if (hit) Object.assign(result, { name: hit[2], number: lid, imageUrl: hit[3] ? imageUrl(lang, s.serieId, sid, lid) + '/high.webp' : '' });
  }
  if (result.releaseDate) result.year = Number(result.releaseDate.slice(0, 4)) || null;
  return { result, sources, error };
}

// Produkt: Erscheinungsdatum über das zugehörige Set
export async function lookupProductSet(setName) {
  const s = await findSet(setName);
  if (!s) return null;
  return { setId: s.id, setName: s.nameDe || s.nameEn, serie: s.serie, releaseDate: s.releaseDate || '', year: s.releaseDate ? Number(s.releaseDate.slice(0, 4)) : null };
}

const CARD_FIELDS = ['name', 'pokemon', 'number', 'setId', 'setName', 'serie', 'setTotal', 'rarity', 'category', 'types', 'hp', 'illustrator', 'imageUrl', 'releaseDate', 'year', 'tcgdexId'];
const PRICE_FIELDS = ['marketValue', 'marketValueHolo', 'marketUpdated'];

// Ergänzt fehlende Felder (eigene Eingaben bleiben erhalten, außer overwrite = true).
// Der Marktwert wird immer aktualisiert, wenn TCGdex einen liefert.
export async function enrich(item, { overwrite = false } = {}) {
  const apply = (r, fields, force) => {
    for (const k of fields) {
      if (r[k] === null || r[k] === undefined || r[k] === '') continue;
      const empty = item[k] === null || item[k] === '' || item[k] === undefined;
      if (empty || force) item[k] = r[k];
    }
  };
  let sources = [], notes = [];
  if (item.kind === 'karte') {
    if (!item.tcgdexId && item.setId && item.number) item.tcgdexId = await findCard(item.setId, item.number, item.language);
    if (!item.tcgdexId && item.setName && item.number) {
      const s = await findSet(item.setName);
      if (s) item.tcgdexId = await findCard(s.id, item.number, item.language);
    }
    if (item.tcgdexId) {
      const { result, sources: src, error } = await lookupCard(item.tcgdexId, item.language);
      if (result.name) result.pokemon = pokemonFromName(result.name, result.category);
      apply(result, CARD_FIELDS, overwrite);
      apply(result, PRICE_FIELDS, true);
      sources = src;
      if (error) notes.push(error + ', Marktwert nicht aktualisiert');
      else if (src.includes('TCGdex') && result.marketValue == null) notes.push('kein Cardmarket-Preis');
    } else notes.push('Set und Kartennummer angeben, um die Karte zu finden');
    if (!item.pokemon && item.name) item.pokemon = pokemonFromName(item.name, item.category);
  } else {
    if (item.setName) {
      const r = await lookupProductSet(item.setName);
      if (r) { apply(r, ['setId', 'serie', 'releaseDate', 'year'], overwrite); sources.push('Katalog'); }
      else notes.push('Set nicht im Katalog gefunden');
    }
    if (!item.uvp) notes.push('UVP bitte von Hand eintragen');
  }
  if (!item.year) notes.push('Erscheinungsjahr nicht gefunden');
  const complete = item.kind === 'karte' ? !!(item.year && item.name && item.setName) : !!(item.year && item.uvp);
  item.research = {
    status: !sources.length ? 'notfound' : complete ? 'ok' : 'partial',
    source: sources.join(' + ') || '–',
    at: new Date().toISOString(),
    message: (!sources.length ? 'nicht gefunden' + (notes.length ? ' (' : '') : '') + notes.join(', ') + (!sources.length && notes.length ? ')' : ''),
  };
  return item;
}

export function cardmarketUrl(item) {
  const q = item.kind === 'karte' ? [item.name, item.setName, item.number].filter(Boolean).join(' ') : [item.name || item.productType, item.setName].filter(Boolean).join(' ');
  return 'https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=' + encodeURIComponent(q);
}
