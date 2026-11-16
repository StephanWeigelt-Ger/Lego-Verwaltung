// Import und Export von Excel-Listen (über SheetJS).
import { newSet, newCopy, normalizeSetNumber } from './store.js';

export const FIELDS = [
  ['number', 'Setnummer', /^(set)?[\s-]*(nr|nummer|number|no\.?|#)|^set$|artikel/i],
  ['name', 'Name', /^(name|bezeichnung|titel|set[\s-]*name|beschreibung)/i],
  ['theme', 'Thema / Serie', /^(thema|serie|theme|reihe|kategorie)/i],
  ['year', 'Erscheinungsjahr', /(jahr|year|erschein)/i],
  ['uvp', 'UVP', /(uvp|rrp|listenpreis|neupreis|empf)/i],
  ['pieces', 'Teile', /^(teile|anzahl teile|pieces|steine)/i],
  ['minifigs', 'Minifiguren', /(minifig|figur)/i],
  ['purchaseDate', 'Kaufdatum', /(kaufdatum|gekauft am|datum|date)/i],
  ['price', 'Einkaufspreis', /(einkauf|kaufpreis|ek|bezahlt|preis)/i],
  ['shop', 'Händler', /(händler|haendler|shop|gekauft bei|quelle|laden)/i],
  ['condition', 'Zustand (1–10)', /(zustand|condition)/i],
  ['damage', 'Beschädigungen', /(schad|schäd|beschäd|mängel|defekt)/i],
  ['quantity', 'Anzahl Exemplare', /^(anzahl|menge|stück|stk|qty|exemplare)$/i],
  ['location', 'Lagerort', /(lager|ort|standort)/i],
  ['notes', 'Bemerkung', /(bemerk|notiz|kommentar|hinweis|info)/i],
];

export async function readWorkbook(file) {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: 'array', cellDates: true });
}

export function sheetRows(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  // Kopfzeile = erste Zeile mit mindestens 2 Textzellen
  let hi = rows.findIndex((r) => r.filter((c) => typeof c === 'string' && c.trim()).length >= 2);
  if (hi < 0) hi = 0;
  return { headers: rows[hi].map((h) => String(h).trim()), rows: rows.slice(hi + 1).filter((r) => r.some((c) => c !== '')) };
}

export function guessMapping(headers) {
  const map = {};
  const used = new Set();
  for (const [key, , re] of FIELDS) {
    const idx = headers.findIndex((h, i) => !used.has(i) && h && re.test(h));
    if (idx >= 0) { map[key] = idx; used.add(idx); }
  }
  return map;
}

function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[€\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
function date(v) {
  if (!v) return '';
  if (v instanceof Date) {
    const d = new Date(v.getTime() - v.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  return s;
}

// Zeilen in Sets umwandeln. Gleiche Setnummer in mehreren Zeilen = mehrere Exemplare.
export function buildSets(rows, map, existing = []) {
  const byNumber = new Map(existing.map((s) => [normalizeSetNumber(s.number).toLowerCase(), s]));
  const touched = new Map();
  const cell = (r, k) => (map[k] === undefined || map[k] === '' ? '' : r[map[k]]);
  for (const r of rows) {
    const number = normalizeSetNumber(cell(r, 'number'));
    const name = String(cell(r, 'name') || '').trim();
    if (!number && !name) continue;
    const key = (number || name).toLowerCase();
    let set = touched.get(key) || byNumber.get(key);
    if (!set) set = newSet({ number, name });
    const pick = (k, v) => { if ((set[k] === null || set[k] === '') && v !== null && v !== '') set[k] = v; };
    pick('name', name);
    pick('theme', String(cell(r, 'theme') || '').trim());
    pick('year', num(cell(r, 'year')));
    pick('uvp', num(cell(r, 'uvp')));
    pick('pieces', num(cell(r, 'pieces')));
    pick('minifigs', num(cell(r, 'minifigs')));
    const note = String(cell(r, 'notes') || '').trim();
    if (note && !set.notes.includes(note)) set.notes = set.notes ? set.notes + '\n' + note : note;
    const qtyRaw = num(cell(r, 'quantity'));
    const qty = qtyRaw === null ? 1 : Math.max(0, Math.round(qtyRaw));
    for (let i = 0; i < qty; i++) {
      const cond = num(cell(r, 'condition'));
      set.copies.push(newCopy({
        purchaseDate: date(cell(r, 'purchaseDate')),
        price: num(cell(r, 'price')),
        shop: String(cell(r, 'shop') || '').trim(),
        condition: cond !== null && cond >= 1 && cond <= 10 ? Math.round(cond) : null,
        damage: String(cell(r, 'damage') || '').trim(),
        location: String(cell(r, 'location') || '').trim(),
      }));
    }
    if (qty === 0) set.wishlist = true;
    touched.set(key, set);
  }
  return [...touched.values()];
}

export function exportExcel(sets) {
  const rows = [];
  for (const s of sets) {
    const base = {
      Setnummer: s.number, Name: s.name, Thema: s.theme, Erscheinungsjahr: s.year, 'UVP (€)': s.uvp,
      Teile: s.pieces, Minifiguren: s.minifigs, Status: s.availability, 'Marktwert (€)': s.marketValue, Bemerkung: s.notes,
    };
    if (!s.copies.length) rows.push({ ...base, Exemplar: '' });
    s.copies.forEach((c, i) => rows.push({
      ...base, Exemplar: i + 1, Kaufdatum: c.purchaseDate, 'Einkaufspreis (€)': c.price, Händler: c.shop,
      'Zustand (1-10)': c.condition, Beschädigungen: c.damage, Verpackung: c.state, Lagerort: c.location,
      'Verkauft am': c.soldDate, 'Verkaufspreis (€)': c.soldPrice,
    }));
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sammlung');
  XLSX.writeFile(wb, `Lego-Sammlung-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
