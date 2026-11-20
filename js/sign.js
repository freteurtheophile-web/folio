// Signatures et tampons enregistrés : dessinés au stylet, tapés, importés (avec
// suppression du fond blanc) ou générés (APPROUVÉ, date, cachet…).
import { el, icon, btn, modal, toast, pickFiles, confirmBox } from './ui.js';
import { idb, getSettings } from './store.js';
import { drawStroke, newId, mapPressure, tiltOf, invalidate, coalesced } from './ink.js';

const FONTS = ['Great Vibes', 'Dancing Script', 'Allura', 'Sacramento', 'Caveat'];
let fontsLoaded = false;
function loadFonts() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  document.head.append(el('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Allura&family=Caveat:wght@500&family=Dancing+Script:wght@600&family=Great+Vibes&family=Sacramento&display=swap' }));
}

// Recadre un canvas sur son contenu non transparent.
function trim(canvas, pad = 6) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const out = el('canvas', { width: x1 - x0 + 1, height: y1 - y0 + 1 });
  out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

async function store(kind, canvas, name) {
  const src = canvas.toDataURL('image/png');
  const item = { kind, src, w: canvas.width, h: canvas.height, name: name || (kind === 'signature' ? 'Signature' : 'Tampon'), at: Date.now() };
  await idb.set('signatures', newId(), item);
  return item;
}

export const signs = {
  async pick(onPick) {
    const grid = el('div', { class: 'sig-grid' });
    const render = async () => {
      grid.innerHTML = '';
      const all = (await idb.all('signatures')).sort((a, b) => b.value.at - a.value.at);
      if (!all.length) grid.append(el('p', { class: 'empty' }, 'Aucune signature ni tampon enregistré. Créez-en un ci-dessous : il sera conservé sur cet appareil.'));
      for (const { key, value: s } of all) {
        grid.append(el('div', { class: 'sig-card', title: 'Cliquez pour placer', onclick: () => { m.close(); onPick?.(s); } },
          el('img', { src: s.src }), el('span', { class: 'small muted' }, s.name),
          btn('trash', 'Supprimer', async (e) => { e.stopPropagation(); if (await confirmBox('Supprimer', `Supprimer « ${s.name} » ?`, 'Supprimer')) { await idb.del('signatures', key); render(); } }, 'tiny sig-del')));
      }
    };
    const m = modal({ title: 'Signatures et tampons', wide: true, body: el('div', {},
      grid,
      el('div', { class: 'row wrap' },
        el('button', { class: 'btn', onclick: () => this.create('draw', async (s) => { await render(); }) }, icon('sign', 16), ' Dessiner une signature'),
        el('button', { class: 'btn', onclick: () => this.create('type', render) }, icon('text', 16), ' Taper une signature'),
        el('button', { class: 'btn', onclick: () => this.create('import', render) }, icon('image', 16), ' Importer (signature ou cachet)'),
        el('button', { class: 'btn', onclick: () => this.create('stamp', render) }, icon('stamp', 16), ' Créer un tampon'))) });
    render();
  },

  create(mode, done) {
    const fn = { draw: drawSig, type: typeSig, import: importSig, stamp: stampSig }[mode];
    fn(async (canvas, kind, name) => { if (!canvas) return; await store(kind, canvas, name); toast('Enregistré'); done?.(); });
  },
};

// --- Dessin au stylet -------------------------------------------------------------------
function drawSig(save) {
  const W = 900, H = 300;
  const pad = el('canvas', { class: 'sig-pad', width: W, height: H });
  const strokes = [];
  let cur = null, color = '#14204f', pen = 'plume', width = 2.2;
  const ctx = pad.getContext('2d');
  const redraw = (bg = true) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (bg) { ctx.strokeStyle = '#ccc'; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(40, H - 70); ctx.lineTo(W - 40, H - 70); ctx.stroke(); ctx.setLineDash([]); }
    ctx.setTransform(3, 0, 0, -3, 0, H);
    for (const s of strokes) drawStroke(ctx, s);
    if (cur) drawStroke(ctx, cur);
  };
  redraw();
  const pt = (e) => { const r = pad.getBoundingClientRect(), k = W / r.width; return [(e.clientX - r.left) * k / 3, (H - (e.clientY - r.top) * k) / 3]; };
  pad.style.touchAction = 'none';
  pad.addEventListener('pointerdown', (e) => {
    try { pad.setPointerCapture(e.pointerId); } catch {}
    cur = { type: 'ink', id: newId(), pen, color, width, opacity: 1, pts: [...pt(e), mapPressure(e, getSettings()), tiltOf(e)] };
  });
  pad.addEventListener('pointermove', (e) => {
    if (!cur) return;
    for (const ev of coalesced(e)) cur.pts.push(...pt(ev), mapPressure(ev, getSettings()), tiltOf(ev));
    invalidate(cur); redraw();
  });
  pad.addEventListener('pointerup', () => { if (cur) strokes.push(cur); cur = null; redraw(); });
  const colors = el('div', { class: 'row' }, ['#14204f', '#1f3fae', '#111111'].map(c => el('button', { class: 'swatch', style: { background: c }, onclick: () => (color = c) })),
    el('select', { class: 'input', style: { width: 'auto' }, onchange: (e) => (pen = e.target.value) },
      [['plume', 'Stylo plume'], ['bic', 'Bic'], ['feutre', 'Feutre']].map(([v, l]) => { const o = el('option', {}, l); o.value = v; return o; })),
    el('button', { class: 'btn small', onclick: () => { strokes.pop(); redraw(); } }, 'Annuler le dernier trait'),
    el('button', { class: 'btn small', onclick: () => { strokes.length = 0; redraw(); } }, 'Effacer'));
  const name = el('input', { class: 'input', value: 'Ma signature' });
  modal({ title: 'Dessiner une signature', wide: true, body: el('div', {}, el('p', { class: 'muted' }, 'Signez dans le cadre avec votre stylet, la souris ou le doigt. La pression du stylet est prise en compte.'), pad, colors, el('label', { class: 'field' }, el('span', {}, 'Nom'), name)),
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', primary: true, onClick: () => {
      if (!strokes.length) { toast('Signez d\'abord dans le cadre.', 'error'); return false; }
      redraw(false); save(trim(pad), 'signature', name.value);
    } }] });
}

// --- Signature tapée ------------------------------------------------------------------------
function typeSig(save) {
  loadFonts();
  const input = el('input', { class: 'input', placeholder: 'Prénom Nom', value: '' });
  let font = FONTS[0], color = '#14204f';
  const prev = el('div', { class: 'sig-fonts' });
  const render = () => {
    prev.innerHTML = '';
    for (const f of FONTS) prev.append(el('button', { class: 'sig-font' + (f === font ? ' on' : ''), style: { fontFamily: `'${f}', cursive`, color }, onclick: () => { font = f; render(); } }, input.value || 'Votre signature'));
  };
  input.addEventListener('input', render);
  render();
  document.fonts?.ready.then(render);
  modal({ title: 'Taper une signature', wide: true, body: el('div', {}, el('label', { class: 'field' }, el('span', {}, 'Votre nom'), input), prev,
    el('div', { class: 'row' }, ['#14204f', '#1f3fae', '#111111'].map(c => el('button', { class: 'swatch', style: { background: c }, onclick: () => { color = c; render(); } })))),
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', primary: true, onClick: async () => {
      if (!input.value.trim()) { toast('Tapez votre nom.', 'error'); return false; }
      await document.fonts.load(`96px '${font}'`);
      const c = el('canvas', { width: 1400, height: 320 });
      const x = c.getContext('2d');
      x.font = `120px '${font}', cursive`; x.fillStyle = color; x.textBaseline = 'middle';
      x.fillText(input.value, 30, 170);
      save(trim(c), 'signature', input.value);
    } }] });
}

// --- Import (signature scannée, cachet d'entreprise) -------------------------------------
async function importSig(save) {
  const [f] = await pickFiles('image/*');
  if (!f) return;
  const bm = await createImageBitmap(f);
  const s = Math.min(1, 1600 / Math.max(bm.width, bm.height));
  const src = el('canvas', { width: Math.round(bm.width * s), height: Math.round(bm.height * s) });
  src.getContext('2d').drawImage(bm, 0, 0, src.width, src.height);
  const view = el('canvas', { class: 'sig-pad checker', width: src.width, height: src.height });
  let thr = 200, removeBg = true, kind = 'stamp';
  const process = () => {
    const x = view.getContext('2d');
    x.clearRect(0, 0, view.width, view.height);
    x.drawImage(src, 0, 0);
    if (!removeBg) return;
    const id = x.getImageData(0, 0, view.width, view.height), d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
      if (l >= thr) d[i + 3] = 0;
      else if (l > thr - 40) d[i + 3] = Math.round(d[i + 3] * (thr - l) / 40);
    }
    x.putImageData(id, 0, 0);
  };
  process();
  const range = el('input', { type: 'range', min: 120, max: 250, value: thr, oninput: (e) => { thr = +e.target.value; process(); } });
  const name = el('input', { class: 'input', value: f.name.replace(/\.[^.]+$/, '') });
  const kindSel = el('select', { class: 'input', onchange: (e) => (kind = e.target.value) },
    [['stamp', 'Tampon / cachet'], ['signature', 'Signature']].map(([v, l]) => { const o = el('option', {}, l); o.value = v; return o; }));
  modal({ title: 'Importer une image', wide: true, body: el('div', {}, view,
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: true, onchange: (e) => { removeBg = e.target.checked; process(); } }), ' Rendre le fond blanc transparent'),
    el('label', { class: 'field' }, el('span', {}, 'Seuil du fond'), range),
    el('div', { class: 'grid2' }, el('label', { class: 'field' }, el('span', {}, 'Nom'), name), el('label', { class: 'field' }, el('span', {}, 'Type'), kindSel))),
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', primary: true, onClick: () => save(trim(view, 2) || view, kind, name.value) }] });
}

// --- Tampons générés ---------------------------------------------------------------------
function stampSig(save) {
  const presets = ['APPROUVÉ', 'REÇU', 'PAYÉ', 'CONFIDENTIEL', 'COPIE', 'BROUILLON', 'URGENT', 'VU', 'À REVOIR', 'REFUSÉ'];
  const text = el('input', { class: 'input', value: 'APPROUVÉ' });
  const sub = el('input', { class: 'input', value: '', placeholder: 'Ligne secondaire (facultatif), ex. nom ou service' });
  const date = el('input', { type: 'checkbox', checked: true });
  const color = el('input', { type: 'color', value: '#c0392b' });
  const shape = el('select', { class: 'input' }, [['rect', 'Rectangle'], ['round', 'Arrondi'], ['double', 'Double cadre'], ['circle', 'Rond (cachet)']].map(([v, l]) => { const o = el('option', {}, l); o.value = v; return o; }));
  const tilt = el('input', { type: 'checkbox', checked: false });
  const prev = el('canvas', { class: 'stamp-preview' });
  const draw = () => {
    const c = prev, x = c.getContext('2d');
    const t = text.value.toUpperCase(), s2 = sub.value, d = date.checked ? new Date().toLocaleDateString('fr-FR') : '';
    const lines = [s2, d].filter(Boolean);
    const circle = shape.value === 'circle';
    x.font = '800 64px Helvetica, Arial, sans-serif';
    const tw = x.measureText(t).width;
    const W = circle ? Math.max(360, tw + 80) : tw + 80, H = circle ? W : 110 + lines.length * 40;
    c.width = W + 40; c.height = H + 40;
    x.clearRect(0, 0, c.width, c.height);
    x.save();
    x.translate(c.width / 2, c.height / 2);
    if (tilt.checked) x.rotate(-0.12);
    x.strokeStyle = x.fillStyle = color.value; x.lineWidth = 7;
    if (circle) {
      x.beginPath(); x.arc(0, 0, W / 2 - 6, 0, 7); x.stroke();
      x.lineWidth = 3; x.beginPath(); x.arc(0, 0, W / 2 - 20, 0, 7); x.stroke();
    } else {
      const r = shape.value === 'round' ? 26 : 4;
      x.beginPath(); x.roundRect(-W / 2, -H / 2, W, H, r); x.stroke();
      if (shape.value === 'double') { x.lineWidth = 3; x.beginPath(); x.roundRect(-W / 2 + 12, -H / 2 + 12, W - 24, H - 24, 2); x.stroke(); }
    }
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '800 64px Helvetica, Arial, sans-serif';
    x.fillText(t, 0, -lines.length * 20);
    x.font = '600 32px Helvetica, Arial, sans-serif';
    lines.forEach((l, k) => x.fillText(l, 0, 40 - lines.length * 20 + k * 40 + 6));
    x.restore();
    // Texture « encre » légère
    const id = x.getImageData(0, 0, c.width, c.height), dd = id.data;
    for (let i = 3; i < dd.length; i += 4) if (dd[i] && Math.random() < 0.08) dd[i] = dd[i] * 0.55;
    x.putImageData(id, 0, 0);
  };
  for (const n of [text, sub, date, color, shape, tilt]) n.addEventListener('input', draw);
  draw();
  modal({ title: 'Créer un tampon', wide: true, body: el('div', {},
    el('div', { class: 'row wrap' }, presets.map(p => el('button', { class: 'chip', onclick: () => { text.value = p; draw(); } }, p))),
    el('div', { class: 'grid2' }, el('label', { class: 'field' }, el('span', {}, 'Texte'), text), el('label', { class: 'field' }, el('span', {}, 'Forme'), shape)),
    el('label', { class: 'field' }, el('span', {}, 'Ligne secondaire'), sub),
    el('div', { class: 'row' }, el('label', { class: 'check' }, date, ' Ajouter la date du jour'), el('label', { class: 'check' }, tilt, ' Légèrement incliné'), color),
    el('div', { class: 'stamp-wrap checker' }, prev),
    el('p', { class: 'muted small' }, 'Astuce : la date est celle du jour de création du tampon. Pour un tampon daté automatiquement, recréez-le le jour voulu.')),
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', primary: true, onClick: () => save(trim(prev, 2), 'stamp', text.value) }] });
}
