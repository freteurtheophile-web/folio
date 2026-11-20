// Opérations sur les pages du document ouvert : pivoter, supprimer, déplacer,
// insérer une page de notes (lignée, Seyès, quadrillée, pointillée), insérer un PDF,
// dupliquer, extraire.
import { PDFLib, loadLib } from './pdf.js';
import { el, modal, toast, pickFiles, downloadBlob, baseName, busy } from './ui.js';
import { newId } from './ink.js';
import { buildAnnotatedPdf } from './save.js';

const MM = 72 / 25.4;

export const PAPERS = [
  ['blank', 'Blanche'], ['lined', 'Lignée'], ['seyes', 'Seyès (grands carreaux)'],
  ['grid', 'Petits carreaux 5 mm'], ['dots', 'Pointillée'], ['cornell', 'Prise de notes Cornell'],
];

export function drawPaper(L, page, style) {
  const { width: W, height: H } = page.getSize();
  const blue = L.rgb(0.55, 0.7, 0.9), light = L.rgb(0.78, 0.85, 0.95), red = L.rgb(0.9, 0.45, 0.45), grey = L.rgb(0.75, 0.75, 0.78);
  const line = (x1, y1, x2, y2, c, t = 0.5) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t, color: c });
  if (style === 'lined') {
    for (let y = H - 30 * MM; y > 15 * MM; y -= 8 * MM) line(15 * MM, y, W - 15 * MM, y, blue);
    line(30 * MM, H - 15 * MM, 30 * MM, 15 * MM, red, 0.8);
  } else if (style === 'seyes') {
    for (let y = H - 25 * MM, k = 0; y > 12 * MM; y -= 2 * MM, k++) line(0, y, W, y, k % 4 === 0 ? blue : light, k % 4 === 0 ? 0.6 : 0.35);
    for (let x = 33 * MM; x < W; x += 8 * MM) line(x, H - 25 * MM, x, 12 * MM, light, 0.35);
    line(25 * MM, H, 25 * MM, 0, red, 0.8);
  } else if (style === 'grid') {
    for (let y = H - 10 * MM; y > 5 * MM; y -= 5 * MM) line(10 * MM, y, W - 10 * MM, y, grey, 0.3);
    for (let x = 10 * MM; x < W - 5 * MM; x += 5 * MM) line(x, H - 10 * MM, x, 10 * MM, grey, 0.3);
  } else if (style === 'dots') {
    for (let y = H - 10 * MM; y > 8 * MM; y -= 5 * MM)
      for (let x = 10 * MM; x < W - 8 * MM; x += 5 * MM) page.drawCircle({ x, y, size: 0.55, color: grey });
  } else if (style === 'cornell') {
    line(0, H - 25 * MM, W, H - 25 * MM, blue, 0.8);
    line(60 * MM, H - 25 * MM, 60 * MM, 50 * MM, blue, 0.8);
    line(0, 50 * MM, W, 50 * MM, blue, 0.8);
    for (let y = H - 33 * MM; y > 52 * MM; y -= 8 * MM) line(62 * MM, y, W - 10 * MM, y, light, 0.4);
  }
}

function cloneAnnList(list) {
  return structuredClone(list).map(a => ({ ...a, id: newId() }));
}

// Reconstruit le document selon une nouvelle liste de pages, puis le recharge.
async function rebuild(view, entries, message) {
  const b = busy('Mise à jour des pages…');
  try {
    const L = await PDFLib();
    const src = await loadLib(view.bytes);
    const out = await L.PDFDocument.create();
    const copied = new Map();
    for (const e of entries) {
      if (e.src === 'self') {
        const [p] = await out.copyPages(src, [e.i]);
        out.addPage(p);
      } else if (e.src === 'ext') {
        const [p] = await out.copyPages(e.doc, [e.i]);
        out.addPage(p);
      } else if (e.src === 'blank') {
        const p = out.addPage([e.w, e.h]);
        drawPaper(L, p, e.style);
      }
    }
    const bytes = await out.save();
    const ann = entries.map(e => {
      if (e.src !== 'self') return [];
      const first = !copied.has(e.i); copied.set(e.i, true);
      return first ? view.ann[e.i] : cloneAnnList(view.ann[e.i]);
    });
    const rot = entries.map(e => (e.src === 'self' ? view.pageRot[e.i] || 0 : 0));
    const prev = { bytes: view.bytes, ann: view.ann, pageRot: view.pageRot };
    await view.reload(bytes, ann, rot);
    b.done();
    const t = toast(el('span', {}, message + ' ', el('button', { class: 'linklike', onclick: async () => { t.remove(); await view.reload(prev.bytes, prev.ann, prev.pageRot); toast('Modification annulée'); } }, 'Annuler')), 'info', 6000);
  } catch (e) {
    b.done();
    console.error(e);
    toast('Impossible de modifier les pages de ce document (protégé ou endommagé).', 'error', 5000);
  }
}

const selfOrder = (n) => Array.from({ length: n }, (_, i) => ({ src: 'self', i }));

export const pageOps = {
  rotate(view, idxs, deg) {
    for (const i of idxs) {
      view.pageRot[i] = ((view.pageRot[i] || 0) + deg + 360) % 360;
      view.pages[i].rendered = 0; view.pages[i].textRot = null;
    }
    view.relayout();
    view.markDirty(idxs);
  },

  remove(view, idxs) {
    if (idxs.length >= view.count) { toast('Un document doit garder au moins une page.', 'error'); return; }
    const del = new Set(idxs);
    rebuild(view, selfOrder(view.count).filter(e => !del.has(e.i)), idxs.length > 1 ? 'Pages supprimées.' : 'Page supprimée.');
  },

  move(view, from, to) {
    const order = selfOrder(view.count);
    const [m] = order.splice(from, 1);
    order.splice(to, 0, m);
    rebuild(view, order, `Page ${from + 1} déplacée en position ${to + 1}.`);
  },

  duplicate(view, i) {
    const order = selfOrder(view.count);
    order.splice(i + 1, 0, { src: 'self', i });
    rebuild(view, order, 'Page dupliquée.');
  },

  insertBlank(view, at) {
    const near = view.base[Math.min(at, view.count - 1)] || { w: 595, h: 842 };
    let style = 'seyes', size = 'same';
    const papers = el('div', { class: 'paper-grid' }, PAPERS.map(([k, label]) =>
      el('button', { class: 'paper' + (k === style ? ' on' : ''), 'data-k': k, onclick: (e) => {
        style = k; papers.querySelectorAll('.paper').forEach(p => p.classList.toggle('on', p.dataset.k === k));
      } }, el('span', { class: 'paper-prev p-' + k }), el('span', {}, label))));
    const sizeSel = el('select', { class: 'input', onchange: (e) => (size = e.target.value) },
      el('option', { value: 'same' }, 'Comme la page voisine'),
      el('option', { value: 'a4' }, 'A4 portrait'), el('option', { value: 'a4l' }, 'A4 paysage'),
      el('option', { value: 'letter' }, 'Lettre US'));
    modal({ title: 'Insérer une page de notes', body: el('div', {}, papers, el('label', { class: 'field' }, el('span', {}, 'Format'), sizeSel)),
      actions: [{ label: 'Annuler' }, { label: 'Insérer', primary: true, onClick: () => {
        const dims = { same: [near.w, near.h], a4: [595.28, 841.89], a4l: [841.89, 595.28], letter: [612, 792] }[size];
        const order = selfOrder(view.count);
        order.splice(at, 0, { src: 'blank', w: dims[0], h: dims[1], style });
        rebuild(view, order, 'Page de notes insérée.');
      } }] });
  },

  async insertPdf(view, at) {
    const [f] = await pickFiles('application/pdf');
    if (!f) return;
    try {
      const doc = await loadLib(new Uint8Array(await f.arrayBuffer()));
      const order = selfOrder(view.count);
      order.splice(at, 0, ...doc.getPageIndices().map(i => ({ src: 'ext', doc, i })));
      rebuild(view, order, `${doc.getPageCount()} page(s) insérée(s).`);
    } catch { toast('Ce PDF ne peut pas être lu.', 'error'); }
  },

  async extract(view, idxs) {
    const b = busy('Extraction…');
    try {
      const L = await PDFLib();
      const full = await L.PDFDocument.load(await buildAnnotatedPdf(view, { embed: false }));
      const out = await L.PDFDocument.create();
      for (const p of await out.copyPages(full, idxs)) out.addPage(p);
      downloadBlob(new Blob([await out.save()], { type: 'application/pdf' }),
        `${baseName(view.name)}_p${idxs.map(i => i + 1).join('-')}.pdf`);
    } catch (e) { console.error(e); toast('Extraction impossible.', 'error'); }
    b.done();
  },
};
