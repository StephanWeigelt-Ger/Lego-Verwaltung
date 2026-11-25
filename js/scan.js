// Setnummer aus einem Foto erkennen (Texterkennung mit Tesseract.js, läuft komplett auf dem Gerät).
// Die Programmdateien liegen in vendor/tesseract/ und werden erst beim ersten Scan geladen.
import { lookupCatalog } from './research.js';

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;
let workerPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Texterkennung konnte nicht geladen werden'));
    document.head.appendChild(s);
  });
}

async function worker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(BASE + 'tesseract.min.js');
      const w = await window.Tesseract.createWorker('eng', 1, {
        workerPath: BASE + 'worker.min.js',
        corePath: BASE,
        langPath: BASE,
        gzip: true,
        cacheMethod: 'none',
      });
      await w.setParameters({ tessedit_pageseg_mode: '11' }); // verstreuter Text, wie auf einer Verpackung
      return w;
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

// Bild verkleinern und kontrastreich in Graustufen umwandeln
function prepare(img, maxSide = 1800, invert = false) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  const f = Math.min(1, maxSide / Math.max(w0, h0));
  const cv = document.createElement('canvas');
  cv.width = Math.round(w0 * f); cv.height = Math.round(h0 * f);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  const d = ctx.getImageData(0, 0, cv.width, cv.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    let g = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
    if (invert) g = 255 - g;
    p[i] = p[i + 1] = p[i + 2] = g;
  }
  ctx.putImageData(d, 0, 0);
  return cv;
}

// Zahlen aus dem Erkennungsergebnis mit Schrifthöhe
function numbersFrom(result) {
  const out = [];
  for (const w of result.data.words || []) {
    const text = w.text.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1');
    const h = w.bbox ? w.bbox.y1 - w.bbox.y0 : 0;
    for (const m of text.matchAll(/\d{3,7}(?:-\d)?/g)) out.push({ n: m[0], h, conf: w.confidence || 0 });
  }
  return out;
}

// Liefert die wahrscheinlichsten Setnummern, die es im Set-Katalog gibt (beste zuerst).
export async function findSetNumbers(img, onStatus = () => {}) {
  onStatus('Texterkennung wird geladen …');
  const w = await worker();
  onStatus('Setnummer wird gesucht …');
  let nums = numbersFrom(await w.recognize(prepare(img)));
  // helle Schrift auf dunklem Grund: zweiter Durchgang mit invertiertem Bild
  nums = nums.concat(numbersFrom(await w.recognize(prepare(img, 1800, true))));
  if (!nums.length) return [];
  const all = new Set(nums.map((x) => x.n.replace(/-\d$/, '')));
  const maxH = Math.max(...nums.map((x) => x.h), 1);
  const cands = new Map();
  for (const x of nums) {
    const base = x.n.replace(/-\d$/, '');
    if (base.length < 4 || base.length > 7) continue; // Altersangabe, Teile mit 3 Stellen usw.
    const c = cands.get(base) || { number: base, score: 0, count: 0 };
    c.score = Math.max(c.score, x.h / maxH + x.conf / 400);
    c.count++;
    cands.set(base, c);
  }
  const found = [];
  for (const c of cands.values()) {
    const hit = await lookupCatalog(c.number);
    if (!hit) continue;
    let score = c.score + Math.min(c.count - 1, 3) * 0.15;
    if (hit.pieces && all.has(String(hit.pieces))) score += 1; // Teileanzahl steht auch auf der Packung
    if (hit.year && hit.year >= 2000) score += 0.1;
    found.push({ number: c.number, score, hit });
  }
  found.sort((a, b) => b.score - a.score);
  // Teileanzahl des besten Treffers ist keine weitere Setnummer
  const pieces = new Set(found.slice(0, 1).map((f) => String(f.hit.pieces)));
  return found.filter((f, i) => i === 0 || !pieces.has(f.number)).slice(0, 4);
}
