// Einmaliger Import aus der Dropbox: Liegt /lego-import.json in der Dropbox, werden die Sets
// übernommen (fehlende Daten aus dem Set-Katalog ergänzt) und die Datei danach gelöscht.
// Jeder Import hat eine importId und wird nur einmal angewendet, auch wenn das Löschen scheitert.
import * as data from './data.js';
import * as dbx from './dropbox.js';
import * as research from './research.js';
import { newSet, newCopy, normalizeSetNumber, now } from './store.js';

const PATH = '/lego-import.json';
const FILL = ['name', 'theme', 'subtheme', 'year', 'uvp', 'pieces', 'minifigs', 'imageUrl', 'retiredDate', 'availability'];
let running = false;

export async function run() {
  if (running || !(await dbx.isConnected())) return;
  running = true;
  try {
    const file = await dbx.download(PATH);
    if (!file) return;
    const imp = JSON.parse(await file.blob.text());
    const done = data.getSettings().imports || [];
    if (imp.importId && !done.includes(imp.importId)) {
      const byNumber = new Map(data.all().map((s) => [normalizeSetNumber(s.number).toLowerCase(), s]));
      const changed = [];
      for (const e of imp.sets || []) {
        const key = normalizeSetNumber(e.n).toLowerCase();
        let s = byNumber.get(key);
        if (!s) { s = newSet({ number: normalizeSetNumber(e.n) }); byNumber.set(key, s); }
        if (e.name) s.name = e.name;
        if (e.theme) s.theme = e.theme;
        if (e.uvp !== null && e.uvp !== undefined) s.uvp = e.uvp;
        if (e.notes && !s.notes.includes(e.notes)) s.notes = s.notes ? s.notes + '\n' + e.notes : e.notes;
        for (const [price, count, note] of e.copies || []) {
          for (let i = 0; i < count; i++) s.copies.push(newCopy({ price, notes: note || '' }));
        }
        s.wishlist = !s.copies.length;
        const cat = await research.lookupCatalog(s.number);
        if (cat) {
          for (const k of FILL) {
            const empty = s[k] === null || s[k] === '' || s[k] === undefined;
            if (empty && cat[k] !== null && cat[k] !== undefined && cat[k] !== '') s[k] = cat[k];
          }
        }
        s.research = {
          status: s.uvp && s.year ? 'ok' : 'partial', source: 'Excel-Import + Set-Katalog', at: now(),
          message: s.uvp ? '' : 'keine deutsche UVP',
        };
        changed.push(s);
      }
      await data.saveMany(changed);
      await data.saveSettings({ imports: [...done, imp.importId] });
      window.dispatchEvent(new CustomEvent('lego-import', { detail: { count: changed.length } }));
    }
    await dbx.remove(PATH);
  } catch (e) {
    console.error('Import aus Dropbox fehlgeschlagen', e);
  } finally {
    running = false;
  }
}
