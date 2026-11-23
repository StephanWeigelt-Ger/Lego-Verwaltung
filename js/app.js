import { newSet, newCopy, uid, now, kv, normalizeSetNumber } from './store.js';
import * as data from './data.js';
import * as dbx from './dropbox.js';
import * as photo from './photo.js';
import * as research from './research.js';
import * as importer from './importer.js';
import { DROPBOX_APP_KEY } from './config.js';
import * as dropimport from './dropimport.js';

const app = document.getElementById('app');
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- Hilfsfunktionen ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (v) => (v === null || v === undefined || v === '' ? '–' : Number(v).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));
const dateDe = (v) => (v ? new Date(v + (v.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('de-DE') : '');
const numOrNull = (v) => { if (v === '' || v === null) return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
const COND_TEXT = { 1: 'sehr schlecht', 2: 'stark beschädigt', 3: 'deutlich beschädigt', 4: 'beschädigt', 5: 'mittelmäßig', 6: 'akzeptabel', 7: 'gut mit Gebrauchsspuren', 8: 'gut', 9: 'sehr gut', 10: 'neuwertig / perfekt' };
const STATES = ['versiegelt', 'geöffnet', 'aufgebaut', 'zerlegt'];

function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), ms);
}

function activeCopies(s) { return s.copies.filter((c) => !c.soldDate && c.soldPrice === null); }

function setImage(s) {
  if (s.photos.length) return s.photos[0].thumb;
  return s.imageUrl || '';
}

function sortSets(list, by) {
  const cmp = {
    number: (a, b) => a.number.localeCompare(b.number, 'de', { numeric: true }),
    name: (a, b) => a.name.localeCompare(b.name, 'de'),
    year: (a, b) => (b.year || 0) - (a.year || 0),
    theme: (a, b) => a.theme.localeCompare(b.theme, 'de') || a.number.localeCompare(b.number, 'de', { numeric: true }),
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  }[by] || (() => 0);
  return list.sort(cmp);
}

// ---------- Ansichten ----------
const ui = { search: '', sort: 'number', theme: '', show: 'all' };

function renderList() {
  const sets = data.all();
  const owned = sets.filter((s) => !s.wishlist);
  let copies = 0, invested = 0, uvpSum = 0, market = 0;
  for (const s of owned) {
    const act = activeCopies(s);
    copies += act.length;
    for (const c of act) invested += c.price || 0;
    uvpSum += (s.uvp || 0) * act.length;
    market += (s.marketValue || 0) * act.length;
  }
  const themes = [...new Set(sets.map((s) => s.theme).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  const q = ui.search.toLowerCase();
  let list = sets.filter((s) => {
    if (ui.theme && s.theme !== ui.theme) return false;
    if (ui.show === 'wish' && !s.wishlist) return false;
    if (ui.show === 'owned' && s.wishlist) return false;
    if (ui.show === 'missing' && s.uvp && s.year) return false;
    if (ui.show === 'multi' && activeCopies(s).length < 2) return false;
    if (!q) return true;
    return [s.number, s.name, s.theme, s.subtheme, s.notes, ...s.copies.map((c) => c.damage + ' ' + c.location + ' ' + c.shop)].join(' ').toLowerCase().includes(q);
  });
  list = sortSets(list, ui.sort);

  app.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${owned.length}</b><span>Sets</span></div>
      <div class="stat"><b>${copies}</b><span>Exemplare</span></div>
      <div class="stat"><b>${eur(uvpSum)}</b><span>Summe UVP</span></div>
      <div class="stat"><b>${eur(invested)}</b><span>Summe Einkaufspreise</span></div>
      ${uvpSum && invested ? `<div class="stat"><b>${eur(Math.abs(uvpSum - invested))}</b><span>${uvpSum >= invested ? 'unter UVP gekauft' : 'über UVP gekauft'}${uvpSum ? ' (' + Math.round(Math.abs(1 - invested / uvpSum) * 100) + ' %)' : ''}</span></div>` : ''}
      ${market ? `<div class="stat"><b>${eur(market)}</b><span>Marktwert (geschätzt)</span></div>` : ''}
    </div>
    <div class="toolbar">
      <input class="search" type="search" placeholder="Suchen: Nummer, Name, Thema, Schaden …" value="${esc(ui.search)}" id="q">
      <select id="sort" aria-label="Sortierung">
        ${[['number', 'Setnummer'], ['name', 'Name'], ['year', 'Jahr (neueste)'], ['theme', 'Thema'], ['updated', 'Zuletzt geändert']]
          .map(([v, l]) => `<option value="${v}" ${ui.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <a class="btn primary" href="#/neu">＋ Set</a>
    </div>
    <div class="row" style="margin-bottom:14px">
      <select id="theme" style="max-width:240px" aria-label="Thema">
        <option value="">Alle Themen</option>
        ${themes.map((t) => `<option ${ui.theme === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
      </select>
      <select id="show" style="max-width:240px" aria-label="Filter">
        ${[['all', 'Alle'], ['owned', 'Nur Sammlung'], ['wish', 'Wunschliste'], ['multi', 'Mehrfach vorhanden'], ['missing', 'UVP/Jahr fehlt']]
          .map(([v, l]) => `<option value="${v}" ${ui.show === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <span class="muted small">${list.length} von ${sets.length}</span>
    </div>
    ${list.length ? `<div class="set-list">${list.map(setItem).join('')}</div>` : `
      <div class="empty">${sets.length ? 'Keine Treffer.' : 'Noch keine Sets erfasst.<br><br><a class="btn primary" href="#/neu">Erstes Set anlegen</a> <a class="btn" href="#/einstellungen">Excel-Liste importieren</a>'}</div>`}
  `;
  const qi = $('#q');
  qi.addEventListener('input', () => { ui.search = qi.value; renderListKeepFocus(); });
  $('#sort').onchange = (e) => { ui.sort = e.target.value; renderList(); };
  $('#theme').onchange = (e) => { ui.theme = e.target.value; renderList(); };
  $('#show').onchange = (e) => { ui.show = e.target.value; renderList(); };
}

function renderListKeepFocus() {
  const pos = $('#q').selectionStart;
  renderList();
  const qi = $('#q');
  qi.focus();
  qi.setSelectionRange(pos, pos);
}

function setItem(s) {
  const act = activeCopies(s);
  const conds = act.map((c) => c.condition).filter(Boolean);
  const img = setImage(s);
  return `<a class="set-item" href="#/set/${s.id}">
    ${img ? `<img class="thumb" src="${esc(img)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<div class="thumb">🧱</div>'}
    <div>
      <div class="title">${esc(s.number)} ${esc(s.name)}</div>
      <div class="meta">${[s.theme, s.year].filter(Boolean).map(esc).join(' · ')}${s.uvp ? ' · UVP ' + eur(s.uvp) : ''}</div>
      <div class="badges">
        ${s.wishlist ? '<span class="badge warn">Wunschliste</span>' : `<span class="badge">${act.length}× vorhanden</span>`}
        ${conds.length ? `<span class="badge">Zustand ${conds.join(' / ')}</span>` : ''}
        ${s.availability === 'retired' ? '<span class="badge red">Retired</span>' : ''}
        ${!s.uvp || !s.year ? '<span class="badge warn">Daten fehlen</span>' : ''}
      </div>
    </div>
  </a>`;
}

// ---------- Neues Set ----------
function renderNew() {
  app.innerHTML = `
    <h1>Neues Set</h1>
    <div class="card">
      <div class="grid two">
        <label class="field"><span>Setnummer</span><input id="nNumber" inputmode="text" placeholder="z. B. 10294" autofocus></label>
        <label class="field"><span>Name (optional, wird recherchiert)</span><input id="nName"></label>
      </div>
      <p id="nPreview" class="small" style="min-height:1.4em"></p>
      <label class="check"><input type="checkbox" id="nWish"> Nur auf die Wunschliste (noch nicht gekauft)</label>
      <div class="row" style="margin-top:10px">
        <button class="btn primary" id="nCreate">Anlegen</button>
        <a class="btn" href="#/">Abbrechen</a>
      </div>
      <p class="muted small">Nach dem Anlegen ergänzt die App automatisch Name, Thema, Erscheinungsjahr, Teileanzahl und Bild. Die UVP (Deutschland) kommt aus der Brickset-Datenbank.</p>
    </div>`;
  let previewTimer;
  $('#nNumber').addEventListener('input', () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const n = normalizeSetNumber($('#nNumber').value);
      const hit = n ? await research.lookupCatalog(n) : null;
      $('#nPreview').innerHTML = hit
        ? `<b>${esc(hit.name)}</b> · ${esc([hit.theme, hit.year, hit.pieces ? hit.pieces + ' Teile' : ''].filter(Boolean).join(' · '))}`
        : n.length >= 3 ? '<span class="muted">Noch kein Treffer im Set-Katalog</span>' : '';
      if (hit && !$('#nName').value) $('#nName').placeholder = hit.name;
    }, 250);
  });
  $('#nNumber').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#nCreate').click(); });
  $('#nCreate').onclick = async () => {
    const number = normalizeSetNumber($('#nNumber').value);
    const name = $('#nName').value.trim();
    if (!number && !name) return toast('Bitte Setnummer oder Name eingeben.');
    const existing = data.all().find((s) => number && normalizeSetNumber(s.number).toLowerCase() === number.toLowerCase());
    if (existing && !confirm(`Set ${number} ist schon vorhanden. Stattdessen ein weiteres Exemplar hinzufügen?`)) return;
    let set = existing;
    if (!set) {
      set = newSet({ number, name, wishlist: $('#nWish').checked });
      if (!set.wishlist) set.copies.push(newCopy({ purchaseDate: new Date().toISOString().slice(0, 10) }));
    } else {
      set.copies.push(newCopy({ purchaseDate: new Date().toISOString().slice(0, 10) }));
    }
    await data.save(set);
    location.hash = '#/set/' + set.id;
    if (!existing && number) autoResearch(set.id);
  };
}

async function autoResearch(id, overwrite = false) {
  const set = data.get(id);
  if (!set) return;
  toast('Recherche läuft …');
  await research.enrich(set, { overwrite });
  await data.save(set);
  const r = set.research;
  toast(r.status === 'ok' ? 'Daten gefunden und ergänzt.' : r.status === 'partial' ? 'Teilweise gefunden: ' + r.message : 'Recherche: ' + r.message, 4000);
  if (location.hash === '#/set/' + id) renderSet(id);
}

// ---------- Set-Detail ----------
function field(label, name, value, type = 'text', extra = '') {
  return `<label class="field"><span>${label}</span><input data-f="${name}" type="${type}" value="${esc(value ?? '')}" ${extra}></label>`;
}

function renderSet(id) {
  const s = data.get(id);
  if (!s) { app.innerHTML = '<div class="empty">Set nicht gefunden. <a href="#/">Zur Übersicht</a></div>'; return; }
  const img = setImage(s);
  const r = s.research;
  app.innerHTML = `
    <div class="row" style="margin-bottom:8px"><a href="#/" class="btn small">← Übersicht</a><span class="spacer"></span>
      <button class="btn small danger" id="delSet">Set löschen</button></div>
    <div class="detail-head">
      ${img ? `<img class="hero" src="${esc(img)}" alt="" onerror="this.style.visibility='hidden'">` : '<div class="hero thumb" style="font-size:48px">🧱</div>'}
      <div>
        <h1>${esc(s.number)} ${esc(s.name) || '<span class="muted">Ohne Namen</span>'}</h1>
        <div class="muted">${[s.theme, s.subtheme, s.year].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="badges" style="margin-top:8px">
          ${s.uvp ? `<span class="badge">UVP ${eur(s.uvp)}</span>` : '<span class="badge warn">UVP fehlt</span>'}
          ${s.availability === 'retired' ? `<span class="badge red">Retired${s.retiredDate ? ' seit ' + dateDe(s.retiredDate) : ''}</span>` : s.availability ? `<span class="badge ok">${esc(s.availability)}</span>` : ''}
          ${s.wishlist ? '<span class="badge warn">Wunschliste</span>' : ''}
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn small" id="doResearch">🔎 Daten recherchieren</button>
          ${s.number ? `<a class="btn small" href="${research.bricksetUrl(s.number)}" target="_blank" rel="noopener">Brickset ↗</a>
          <a class="btn small" href="https://www.bricklink.com/v2/catalog/catalogitem.page?S=${encodeURIComponent(research.bricksetNumber(s.number))}#T=P" target="_blank" rel="noopener">Marktpreis (BrickLink) ↗</a>` : ''}
        </div>
        ${r ? `<p class="muted small">Letzte Recherche: ${new Date(r.at).toLocaleString('de-DE')} (${esc(r.source)})${r.message ? ' – ' + esc(r.message) : ''}</p>` : ''}
      </div>
    </div>

    <h2>Setdaten</h2>
    <div class="card"><div class="grid">
      ${field('Setnummer', 'number', s.number)}
      ${field('Name', 'name', s.name)}
      ${field('Thema', 'theme', s.theme, 'text', 'list="themes"')}
      ${field('Unterthema', 'subtheme', s.subtheme)}
      ${field('Erscheinungsjahr', 'year', s.year, 'number', 'inputmode="numeric"')}
      ${field('UVP Deutschland (€)', 'uvp', s.uvp, 'number', 'step="0.01" inputmode="decimal"')}
      ${field('Teile', 'pieces', s.pieces, 'number', 'inputmode="numeric"')}
      ${field('Minifiguren', 'minifigs', s.minifigs, 'number', 'inputmode="numeric"')}
      <label class="field"><span>Status bei LEGO</span><select data-f="availability">
        ${[['', 'unbekannt'], ['erhältlich', 'erhältlich'], ['retired', 'retired (nicht mehr erhältlich)']].map(([v, l]) => `<option value="${v}" ${s.availability === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>
      ${field('Retired seit', 'retiredDate', s.retiredDate, 'date')}
      ${field('Marktwert aktuell (€)', 'marketValue', s.marketValue, 'number', 'step="0.01" inputmode="decimal"')}
      <label class="check"><input type="checkbox" data-f="wishlist" ${s.wishlist ? 'checked' : ''}> Wunschliste</label>
    </div>
    <label class="field" style="margin-top:12px"><span>Notizen</span><textarea data-f="notes">${esc(s.notes)}</textarea></label>
    <datalist id="themes">${[...new Set(data.all().map((x) => x.theme).filter(Boolean))].map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
    </div>

    <h2>Exemplare & Käufe (${s.copies.length})</h2>
    ${s.copies.map((c, i) => copyCard(s, c, i)).join('') || '<p class="muted">Noch kein Exemplar erfasst.</p>'}
    <div class="row" style="margin-top:12px"><button class="btn" id="addCopy">＋ Exemplar / Kauf hinzufügen</button></div>
    ${s.copies.length ? `<p class="muted small">Summe Einkauf: ${eur(s.copies.reduce((a, c) => a + (c.price || 0), 0))}
      · Durchschnitt: ${eur(s.copies.filter((c) => c.price).reduce((a, c, _, arr) => a + c.price / arr.length, 0) || null)}</p>` : ''}

    <h2>Fotos (${s.photos.length})</h2>
    <div class="row" style="margin-bottom:10px">
      <label class="btn">📷 Foto aufnehmen<input type="file" accept="image/*" capture="environment" id="camInput" hidden></label>
      <label class="btn">🖼️ Aus Mediathek<input type="file" accept="image/*" multiple id="libInput" hidden></label>
    </div>
    <div class="photos">${s.photos.map((p) => {
      const ci = s.copies.findIndex((c) => c.id === p.copyId);
      return `<div class="photo" data-photo="${p.id}"><img src="${p.thumb}" alt="">${ci >= 0 ? `<span class="tag">Exemplar ${ci + 1}</span>` : ''}</div>`;
    }).join('')}</div>
  `;

  // Setfelder speichern
  $$('[data-f]').forEach((el) => {
    el.addEventListener('change', async () => {
      const f = el.dataset.f;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (['year', 'uvp', 'pieces', 'minifigs', 'marketValue'].includes(f)) v = numOrNull(v);
      if (typeof v === 'string') v = v.trim();
      const numberChanged = f === 'number' && normalizeSetNumber(v) !== normalizeSetNumber(s.number);
      s[f] = f === 'number' ? normalizeSetNumber(v) : v;
      await data.save(s);
      if (numberChanged && s.number) { autoResearch(id, true); return; }
      if (['number', 'name', 'availability', 'wishlist', 'uvp', 'year', 'theme'].includes(f)) renderSet(id);
    });
  });
  // Exemplarfelder speichern
  $$('[data-c]').forEach((el) => {
    el.addEventListener('change', async () => {
      const c = s.copies.find((x) => x.id === el.dataset.c);
      const f = el.dataset.cf;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (['price', 'soldPrice'].includes(f)) v = numOrNull(v);
      c[f] = v;
      await data.save(s);
    });
  });
  $$('.cond button').forEach((b) => {
    b.onclick = async () => {
      const c = s.copies.find((x) => x.id === b.dataset.copy);
      const v = Number(b.dataset.v);
      c.condition = c.condition === v ? null : v;
      await data.save(s);
      renderSet(id);
    };
  });
  $$('[data-delcopy]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Dieses Exemplar wirklich löschen?')) return;
      s.copies = s.copies.filter((c) => c.id !== b.dataset.delcopy);
      s.photos.forEach((p) => { if (p.copyId === b.dataset.delcopy) p.copyId = null; });
      await data.save(s);
      renderSet(id);
    };
  });
  $('#addCopy').onclick = async () => {
    s.copies.push(newCopy({ purchaseDate: new Date().toISOString().slice(0, 10) }));
    s.wishlist = false;
    await data.save(s);
    renderSet(id);
  };
  $('#delSet').onclick = async () => {
    if (!confirm(`Set ${s.number} ${s.name} mit allen Exemplaren und Fotos löschen?`)) return;
    await data.remove(s.id);
    location.hash = '#/';
  };
  $('#doResearch').onclick = () => autoResearch(id, s.research?.status === 'ok' ? confirm('Vorhandene Werte mit den recherchierten Werten überschreiben?') : false);
  $('#camInput').onchange = (e) => handlePhotos(s, e.target.files);
  $('#libInput').onchange = (e) => handlePhotos(s, e.target.files);
  $$('[data-photo]').forEach((el) => (el.onclick = () => showPhoto(s, el.dataset.photo)));
}

function copyCard(s, c, i) {
  return `<div class="card copy">
    <div class="copy-head"><h3>Exemplar ${i + 1}</h3>
      ${c.soldDate || c.soldPrice !== null ? '<span class="badge">verkauft</span>' : ''}
      <span class="spacer"></span><button class="btn small danger" data-delcopy="${c.id}">Löschen</button></div>
    <div class="grid">
      <label class="field"><span>Kaufdatum</span><input type="date" data-c="${c.id}" data-cf="purchaseDate" value="${esc(c.purchaseDate)}"></label>
      <label class="field"><span>Einkaufspreis (€)</span><input type="number" step="0.01" inputmode="decimal" data-c="${c.id}" data-cf="price" value="${esc(c.price ?? '')}"></label>
      <label class="field"><span>Händler / Quelle</span><input data-c="${c.id}" data-cf="shop" value="${esc(c.shop)}" placeholder="z. B. LEGO Store, eBay"></label>
      <label class="field"><span>Verpackung</span><select data-c="${c.id}" data-cf="state">
        ${STATES.map((st) => `<option ${c.state === st ? 'selected' : ''}>${st}</option>`).join('')}</select></label>
      <label class="field"><span>Lagerort</span><input data-c="${c.id}" data-cf="location" value="${esc(c.location)}" placeholder="z. B. Keller, Regal 2"></label>
    </div>
    <div style="margin-top:12px">
      <span class="muted small">Zustand der Packung (10 = sehr gut)</span>
      <div class="cond">${Array.from({ length: 10 }, (_, k) => k + 1).map((v) => `<button data-copy="${c.id}" data-v="${v}" class="${c.condition === v ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div class="cond-label">${c.condition ? c.condition + ' – ' + COND_TEXT[c.condition] : 'nicht bewertet'}</div>
    </div>
    <label class="field" style="margin-top:12px"><span>Beschädigungen</span>
      <textarea data-c="${c.id}" data-cf="damage" placeholder="z. B. Ecke vorne rechts oben gestaucht; Knick auf der Rückseite">${esc(c.damage)}</textarea></label>
    <div class="row">
      <label class="check"><input type="checkbox" data-c="${c.id}" data-cf="complete" ${c.complete ? 'checked' : ''}> vollständig</label>
      <label class="check"><input type="checkbox" data-c="${c.id}" data-cf="instructions" ${c.instructions ? 'checked' : ''}> Anleitung vorhanden</label>
    </div>
    <details style="margin-top:8px"><summary>Verkauf & Notizen</summary>
      <div class="grid" style="margin-top:10px">
        <label class="field"><span>Verkauft am</span><input type="date" data-c="${c.id}" data-cf="soldDate" value="${esc(c.soldDate)}"></label>
        <label class="field"><span>Verkaufspreis (€)</span><input type="number" step="0.01" inputmode="decimal" data-c="${c.id}" data-cf="soldPrice" value="${esc(c.soldPrice ?? '')}"></label>
      </div>
      <label class="field" style="margin-top:10px"><span>Notizen zum Exemplar</span><textarea data-c="${c.id}" data-cf="notes">${esc(c.notes)}</textarea></label>
    </details>
  </div>`;
}

// ---------- Fotos ----------
function modal(html) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="modal-box">${html}</div>`;
  document.body.appendChild(m);
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  return m;
}

async function handlePhotos(set, files) {
  for (const file of [...files]) await processPhoto(set, file);
}

function processPhoto(set, file) {
  return new Promise(async (resolve) => {
    const m = modal('<p>Foto wird verbessert …</p>');
    let orig, enhanced;
    try {
      const img = await photo.loadImage(file);
      orig = photo.toCanvas(img);
      await new Promise((r) => setTimeout(r, 30));
      enhanced = photo.enhance(orig, { glare: 0.8 });
    } catch (e) {
      m.remove();
      toast('Foto konnte nicht verarbeitet werden: ' + e.message, 5000);
      return resolve();
    }
    let useEnhanced = true;
    const origUrl = orig.toDataURL('image/jpeg', 0.85);
    let enhUrl = enhanced.toDataURL('image/jpeg', 0.85);
    const levels = { 0: null, 0.8: enhanced, 1: null };
    const box = m.querySelector('.modal-box');
    box.innerHTML = `
      <h3>Foto hinzufügen</h3>
      <div class="row" style="margin-bottom:10px">
        <div class="seg"><button data-v="1" class="on">Verbessert</button><button data-v="0">Original</button></div>
        <span class="muted small">Helligkeit, Kontrast und Spiegelungen angepasst; Knicke und Schäden bleiben sichtbar.</span>
      </div>
      <img class="preview" src="${enhUrl}" alt="Vorschau">
      <div class="row" style="margin-top:8px" id="glareRow"><span class="small muted">Spiegelungen reduzieren:</span>
        <div class="seg" id="glareSeg"><button data-g="0">aus</button><button data-g="0.8" class="on">normal</button><button data-g="1">stark</button></div></div>
      <label class="field" style="margin-top:12px"><span>Gehört zu</span><select id="pCopy">
        <option value="">Set allgemein</option>
        ${set.copies.map((c, i) => `<option value="${c.id}" ${set.copies.length === 1 ? 'selected' : ''}>Exemplar ${i + 1}${c.purchaseDate ? ' (gekauft ' + dateDe(c.purchaseDate) + ')' : ''}</option>`).join('')}
      </select></label>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="pSave">Speichern</button><button class="btn" id="pCancel">Verwerfen</button></div>`;
    const prev = box.querySelector('.preview');
    box.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => {
      useEnhanced = b.dataset.v === '1';
      box.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
      prev.src = useEnhanced ? enhUrl : origUrl;
    }));
    box.querySelectorAll('#glareSeg button').forEach((b) => (b.onclick = async () => {
      const g = Number(b.dataset.g);
      box.querySelectorAll('#glareSeg button').forEach((x) => x.classList.toggle('on', x === b));
      if (!levels[g]) { await new Promise((r) => setTimeout(r, 20)); levels[g] = photo.enhance(orig, { glare: g }); }
      enhanced = levels[g];
      enhUrl = enhanced.toDataURL('image/jpeg', 0.85);
      if (useEnhanced) prev.src = enhUrl;
    }));
    box.querySelector('#pCancel').onclick = () => { m.remove(); resolve(); };
    box.querySelector('#pSave').onclick = async () => {
      const cv = useEnhanced ? enhanced : orig;
      const id = uid();
      const blob = await photo.canvasToBlob(cv);
      await data.addPhotoBlob(id, blob);
      const fresh = data.get(set.id);
      fresh.photos.push({ id, copyId: box.querySelector('#pCopy').value || null, thumb: photo.thumbnail(cv), enhanced: useEnhanced, createdAt: now() });
      await data.save(fresh);
      m.remove();
      renderSet(set.id);
      resolve();
    };
  });
}

async function showPhoto(set, photoId) {
  const p = set.photos.find((x) => x.id === photoId);
  const m = modal(`<img class="preview" src="${p.thumb}" alt="">
    <p class="muted small" id="pInfo">Lade Foto in voller Größe …</p>
    <label class="field"><span>Gehört zu</span><select id="pCopy"><option value="">Set allgemein</option>
      ${set.copies.map((c, i) => `<option value="${c.id}" ${p.copyId === c.id ? 'selected' : ''}>Exemplar ${i + 1}</option>`).join('')}</select></label>
    <div class="row" style="margin-top:12px"><button class="btn" id="pFirst">Als Titelbild</button><a class="btn" id="pDl" download="lego-${esc(set.number)}.jpg">Herunterladen</a>
      <span class="spacer"></span><button class="btn danger" id="pDel">Löschen</button><button class="btn" id="pClose">Schließen</button></div>`);
  try {
    const blob = await data.getPhotoBlob(photoId);
    if (blob) {
      const url = URL.createObjectURL(blob);
      m.querySelector('.preview').src = url;
      m.querySelector('#pDl').href = url;
      m.querySelector('#pInfo').textContent = p.enhanced ? 'Verbesserte Version' : 'Originalfoto';
    } else m.querySelector('#pInfo').textContent = 'Foto in voller Größe noch nicht verfügbar (Dropbox nicht verbunden?).';
  } catch (e) { m.querySelector('#pInfo').textContent = 'Fehler: ' + e.message; }
  m.querySelector('#pClose').onclick = () => m.remove();
  m.querySelector('#pCopy').onchange = async (e) => { p.copyId = e.target.value || null; await data.save(set); renderSet(set.id); };
  m.querySelector('#pFirst').onclick = async () => { set.photos = [p, ...set.photos.filter((x) => x !== p)]; await data.save(set); m.remove(); renderSet(set.id); };
  m.querySelector('#pDel').onclick = async () => {
    if (!confirm('Foto löschen?')) return;
    set.photos = set.photos.filter((x) => x.id !== photoId);
    await data.save(set);
    data.deletePhotoFile(photoId);
    m.remove();
    renderSet(set.id);
  };
}

// ---------- Einstellungen ----------
async function renderSettings() {
  const connected = await dbx.isConnected();
  const appKey = (await kv.get('dropboxAppKey')) || DROPBOX_APP_KEY;
  const keys = await research.getKeys();
  const missing = data.all().filter((s) => s.number && (!s.uvp || !s.year)).length;
  app.innerHTML = `
    <div class="row" style="margin-bottom:8px"><a href="#/" class="btn small">← Übersicht</a></div>
    <h1>Einstellungen</h1>

    <h2>Dropbox (Speicher & Abgleich zwischen Geräten)</h2>
    <div class="card">
      ${connected ? `<p>✅ Mit Dropbox verbunden. Daten liegen in deiner Dropbox im Ordner <b>Apps</b> › (Name deiner Dropbox-App).</p>
        <p class="muted small">Letzter Abgleich: ${data.state.lastSync ? new Date(data.state.lastSync).toLocaleString('de-DE') : '–'}</p>
        <div class="row"><button class="btn" id="syncNow">Jetzt abgleichen</button><button class="btn danger" id="dbxOff">Trennen</button></div>`
      : `<p>Ohne Dropbox werden die Daten nur auf diesem Gerät gespeichert.</p>
        <label class="field"><span>Dropbox App-Key</span><input id="appKey" value="${esc(appKey)}" placeholder="z. B. abc123xyz"></label>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="dbxOn">Mit Dropbox verbinden</button></div>
        <div id="dbxCodeBox" hidden style="margin-top:12px">
          <p class="small"><b>So geht's:</b> Im neuen Fenster bei Dropbox auf „Zulassen“ tippen. Dropbox zeigt dann einen Code an. Diesen Code kopieren, hierher zurückkehren und unten einfügen.</p>
          <label class="field"><span>Code von Dropbox</span><input id="dbxCode" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
          <div class="row" style="margin-top:10px"><button class="btn primary" id="dbxCodeOk">Verbindung abschließen</button></div>
        </div>`}
    </div>

    <h2>Online-Recherche</h2>
    <p class="muted small">Name, Thema, Erscheinungsjahr, Teile und Bild werden automatisch aus dem Set-Katalog ergänzt. Die deutsche UVP stammt von Brickset und ist im Katalog enthalten; ein eigener Schlüssel hier ist nur optional.</p>
    <div class="card">
      <label class="field"><span>Brickset API-Schlüssel (kostenlos)</span><input id="bsKey" value="${esc(keys.brickset)}" placeholder="z. B. 3-ABCD-EFGH-IJKL"></label>
      <p class="muted small">Schlüssel beantragen: <a href="https://brickset.com/tools/webservices/requestkey" target="_blank" rel="noopener">brickset.com › API-Schlüssel</a>. Brickset erlaubt etwa 100 Set-Abfragen pro Tag.</p>
      <div class="row"><button class="btn" id="bsSave">Speichern</button>
        <button class="btn" id="bsAll" ${missing ? '' : 'disabled'}>Fehlende Daten recherchieren (${missing} Sets)</button></div>
      <p class="small" id="bsProgress"></p>
    </div>

    <h2>Excel-Import</h2>
    <div class="card">
      <p>Excel-Liste (.xlsx, .xls oder .csv) auswählen. Gleiche Setnummern in mehreren Zeilen werden als mehrere Exemplare übernommen.</p>
      <label class="btn">📄 Datei wählen<input type="file" id="xlsIn" accept=".xlsx,.xls,.xlsm,.csv" hidden></label>
      <div id="importArea"></div>
    </div>

    <h2>Export & Sicherung</h2>
    <div class="card row">
      <button class="btn" id="expXlsx">Als Excel exportieren</button>
      <button class="btn" id="expJson">Sicherung (JSON) herunterladen</button>
      <label class="btn">Sicherung einspielen<input type="file" id="impJson" accept=".json" hidden></label>
    </div>

    <h2>App installieren</h2>
    <div class="card small">
      <p><b>iPhone / iPad:</b> In Safari auf „Teilen“ tippen, dann „Zum Home-Bildschirm“.</p>
      <p><b>Computer:</b> In Chrome oder Edge auf das Installations-Symbol in der Adressleiste klicken, oder die Seite als Lesezeichen speichern.</p>
    </div>`;

  if (connected) {
    $('#syncNow').onclick = () => data.sync();
    $('#dbxOff').onclick = async () => { if (confirm('Verbindung zu Dropbox auf diesem Gerät trennen? Die Daten in der Dropbox bleiben erhalten.')) { await dbx.disconnect(); renderSettings(); updateSyncUi(); } };
  } else {
    if (await kv.get('dbx_code_pkce')) $('#dbxCodeBox').hidden = false;
    $('#dbxOn').onclick = async () => {
      const k = $('#appKey').value.trim();
      if (!k) return toast('Bitte zuerst den Dropbox App-Key eintragen.');
      await kv.set('dropboxAppKey', k);
      const win = window.open('about:blank', '_blank');
      const url = await dbx.startCodeLogin(k);
      if (win) win.location.href = url; else location.href = url;
      $('#dbxCodeBox').hidden = false;
      $('#dbxCode').focus();
    };
    $('#dbxCodeOk').onclick = async () => {
      const code = $('#dbxCode').value.trim();
      if (!code) return toast('Bitte den Code von Dropbox einfügen.');
      try {
        await dbx.finishCodeLogin(code);
        toast('Mit Dropbox verbunden.');
        await renderSettings();
        updateSyncUi();
        data.sync();
      } catch (e) { toast(e.message, 5000); }
    };
  }
  $('#bsSave').onclick = async () => { await research.setKeys({ ...keys, brickset: $('#bsKey').value.trim() }); toast('Gespeichert.'); };
  $('#bsAll').onclick = async () => {
    await research.setKeys({ ...keys, brickset: $('#bsKey').value.trim() });
    const todo = data.all().filter((s) => s.number && (!s.uvp || !s.year));
    const prog = $('#bsProgress');
    let ok = 0;
    for (let i = 0; i < todo.length; i++) {
      prog.textContent = `Recherche ${i + 1} von ${todo.length}: ${todo[i].number} …`;
      const s = data.get(todo[i].id);
      await research.enrich(s);
      await data.save(s);
      if (s.research.status === 'ok') ok++;
      if (s.research.status === 'error') { prog.textContent = `Abgebrochen bei ${s.number}: ${s.research.message}`; return; }
      await new Promise((r) => setTimeout(r, 600));
    }
    prog.textContent = `Fertig: ${ok} von ${todo.length} Sets vollständig ergänzt.`;
  };
  $('#xlsIn').onchange = (e) => startImport(e.target.files[0]);
  $('#expXlsx').onclick = () => importer.exportExcel(sortSets(data.all(), 'number'));
  $('#expJson').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data.exportJson()], { type: 'application/json' }));
    a.download = `lego-sammlung-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  $('#impJson').onchange = async (e) => {
    try {
      const obj = JSON.parse(await e.target.files[0].text());
      if (!obj.sets) throw new Error('Keine gültige Sicherung.');
      await data.replaceAll(obj);
      toast('Sicherung eingespielt.');
    } catch (err) { toast('Fehler: ' + err.message, 5000); }
  };
}

async function startImport(file) {
  if (!file) return;
  const area = $('#importArea');
  let wb;
  try { wb = await importer.readWorkbook(file); } catch (e) { area.innerHTML = `<p>Datei konnte nicht gelesen werden: ${esc(e.message)}</p>`; return; }
  const sheetSel = wb.SheetNames.length > 1;
  const draw = (sheet) => {
    const { headers, rows } = importer.sheetRows(wb, sheet);
    const map = importer.guessMapping(headers);
    area.innerHTML = `
      ${sheetSel ? `<label class="field" style="margin-top:12px"><span>Tabellenblatt</span><select id="sheet">${wb.SheetNames.map((n) => `<option ${n === sheet ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : ''}
      <p><b>${rows.length} Zeilen</b> gefunden. Bitte prüfen, welche Spalte wohin gehört:</p>
      <table class="map">${importer.FIELDS.map(([k, label]) => `<tr><td>${label}</td><td><select data-map="${k}">
        <option value="">– nicht übernehmen –</option>${headers.map((h, i) => `<option value="${i}" ${map[k] === i ? 'selected' : ''}>${esc(h || 'Spalte ' + (i + 1))}</option>`).join('')}
      </select></td></tr>`).join('')}</table>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="doImport">Importieren</button></div>`;
    if (sheetSel) $('#sheet').onchange = (e) => draw(e.target.value);
    $('#doImport').onclick = async () => {
      const m = {};
      $$('[data-map]').forEach((s) => { if (s.value !== '') m[s.dataset.map] = Number(s.value); });
      if (m.number === undefined && m.name === undefined) return toast('Bitte mindestens Setnummer oder Name zuordnen.');
      const sets = importer.buildSets(rows, m, data.all());
      await data.saveMany(sets);
      area.innerHTML = `<p>✅ ${sets.length} Sets importiert bzw. ergänzt.</p>`;
      toast('Import abgeschlossen.');
    };
  };
  draw(wb.SheetNames[0]);
}

// ---------- Sync-Anzeige & Routing ----------
async function updateSyncUi() {
  const bar = $('#syncBar');
  const btn = $('#syncBtn');
  const connected = await dbx.isConnected();
  btn.classList.toggle('spin', data.state.status === 'syncing');
  if (!connected) {
    bar.hidden = false;
    bar.innerHTML = 'Daten werden nur auf diesem Gerät gespeichert. <a href="#/einstellungen">Dropbox verbinden</a>';
  } else if (data.state.status === 'error' || data.state.status === 'waiting') {
    bar.hidden = false;
    bar.textContent = data.state.message;
  } else bar.hidden = true;
}

function route() {
  const h = location.hash || '#/';
  window.scrollTo(0, 0);
  if (h.startsWith('#/set/')) renderSet(h.slice(6));
  else if (h === '#/neu') renderNew();
  else if (h === '#/einstellungen') renderSettings();
  else renderList();
}

let rerenderTimer;
data.onChange(() => {
  updateSyncUi();
  // Liste bei Änderungen von anderen Geräten aktualisieren (nicht während der Eingabe)
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => {
    const h = location.hash || '#/';
    if ((h === '#/' || h === '') && document.activeElement?.id !== 'q') renderList();
  }, 200);
});

async function init() {
  // Rückkehr von der Dropbox-Anmeldung des Pokémon-Collectors: dorthin weiterreichen
  if (/^pk\./.test(new URLSearchParams(location.search).get('state') || '')) {
    location.replace('pokemon/' + location.search);
    return;
  }
  await data.load();
  data.onAfterSync(() => dropimport.run());
  window.addEventListener('lego-import', (e) => { toast(`Import aus der Excel-Liste: ${e.detail.count} Sets übernommen.`, 5000); route(); });
  try {
    if (await dbx.finishLoginIfNeeded()) toast('Mit Dropbox verbunden.');
  } catch (e) { toast(e.message, 5000); }
  window.addEventListener('hashchange', route);
  $('#syncBtn').onclick = async () => {
    if (!(await dbx.isConnected())) { location.hash = '#/einstellungen'; return; }
    await data.sync();
    if (data.state.status === 'ok') toast('Abgeglichen.');
  };
  route();
  updateSyncUi();
  data.sync();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
