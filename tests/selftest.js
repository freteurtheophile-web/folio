// Batterie de tests de Folio, exécutée dans la page de l'application.
// Utilisation (console du navigateur sur l'app) :
//   const t = await import('/tests/selftest.js'); await t.run();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info = '') => { results.push({ name, ok: !!cond, info: String(info) }); };
async function step(name, fn) {
  try { await fn(); } catch (e) { results.push({ name, ok: false, info: 'EXCEPTION ' + (e?.message || e) }); console.error(name, e); }
}
const app = () => window.folio;
const btnByText = (txt, root = document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim() === txt || b.title === txt);
const lastModal = () => [...document.querySelectorAll('.modal-back')].pop();
const closeModals = () => document.querySelectorAll('.modal-back, .popmenu, .note-pop').forEach(m => m.remove());

// Téléchargements interceptés
const downloads = [];
const origClick = HTMLAnchorElement.prototype.click;
function hookDownloads() {
  HTMLAnchorElement.prototype.click = function () { if (this.download) { downloads.push(this.download); return; } return origClick.call(this); };
}
function unhookDownloads() { HTMLAnchorElement.prototype.click = origClick; }

async function makePdf(pages = 5) {
  const { PDFLib } = await import('/js/pdf.js');
  const L = await PDFLib();
  const d = await L.PDFDocument.create();
  const f = await d.embedFont(L.StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const pg = d.addPage([595, 842]);
    pg.drawText(`Chapitre ${p + 1} : Biologie végétale`, { x: 60, y: 770, size: 22, font: f });
    for (let l = 0; l < 25; l++) pg.drawText(`La photosynthese convertit la lumiere en energie chimique, ligne ${l} page ${p + 1}`, { x: 60, y: 720 - l * 24, size: 11, font: f });
  }
  return d.save();
}

// Simule un geste (stylet, souris ou doigt) sur une page.
function gesture(v, pageIdx, points, { type = 'pen', buttons = 1, id = 11, button = 0 } = {}) {
  const pg = v.pages[pageIdx];
  const r = pg.div.getBoundingClientRect();
  const target = pg.live;
  const ev = (t, [x, y, p = 0.5], extra = {}) => target.dispatchEvent(new PointerEvent(t, {
    bubbles: true, cancelable: true, pointerId: id, pointerType: type, pressure: t === 'pointerup' ? 0 : p,
    clientX: r.left + x, clientY: r.top + y, button: t === 'pointermove' ? -1 : button, buttons: t === 'pointerup' ? 0 : buttons, ...extra,
  }));
  ev('pointerdown', points[0]);
  for (const p of points.slice(1)) ev('pointermove', p);
  ev('pointerup', points[points.length - 1]);
}
const wave = (x0, y0, len = 300, n = 40, pr = (t) => Math.sin(t * Math.PI)) =>
  Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [x0 + t * len, y0 + Math.sin(t * 10) * 8, pr(t)]; });

export async function run({ skipNetwork = false } = {}) {
  results.length = 0; downloads.length = 0;
  hookDownloads();
  const st = await import('/js/store.js');
  st.setSetting('fingerDraw', false); st.setSetting('straighten', true); st.setSetting('pageMode', 'normal'); st.setSetting('blueFilter', 0);
  for (const d of [...app().docs]) { d.dirty = false; await app().close(d); }

  const bytes = await makePdf(5);
  let v;
  await step('Ouverture du PDF', async () => {
    await app().openBytes(bytes, 'test-folio.pdf');
    v = app().active;
    ok('Ouverture du PDF', v && v.count === 5, v?.count);
    for (let i = 0; i < 5; i++) v.ann[i] = [];
    v.annotator.undoStack = [];
    v.goto(0); await sleep(600);
    await v.renderPage(0); await v.pages[0].textReady;
    ok('Rendu de la page 1', v.pages[0].pdfC.width > 100, v.pages[0].pdfC.width);
    ok('Couche texte', v.pages[0].textLayer.querySelectorAll('span').length > 10);
    ok('Miniatures', v.sideBody.querySelectorAll('.thumb').length === 5);
  });
  const an = v.annotator;
  const count = (i = 0, type) => v.ann[i].filter(a => !type || a.type === type).length;

  // --- Stylets et pression ---
  await step('Stylets', async () => {
    const { PEN_ORDER } = await import('/js/ink.js');
    PEN_ORDER.forEach((pen, k) => { an.setTool('pen', pen); gesture(v, 0, wave(60, 120 + k * 30)); });
    const inks = v.ann[0].filter(a => a.type === 'ink');
    ok('7 stylets enregistrent un trait', inks.length === 7, inks.map(a => a.pen).join(','));
    ok('Points intermédiaires conservés', inks.every(a => a.pts.length / 4 > 8), inks.map(a => a.pts.length / 4).join(','));
    const prs = inks[0].pts.filter((_, i) => i % 4 === 2);
    ok('Pression variable enregistrée', Math.max(...prs) - Math.min(...prs) > 0.5, prs.map(p => p.toFixed(2)).join(' '));
    an.setTool('pen', 'bic');
    gesture(v, 0, wave(60, 380), { type: 'mouse', id: 1 });
    const m = v.ann[0].at(-1);
    ok('Souris : pression fixe 0,5', m.pts.filter((_, i) => i % 4 === 2).every(p => p === 0.5));
    const before = count();
    gesture(v, 0, wave(60, 420), { type: 'touch', id: 21 });
    ok('Doigt : fait défiler, ne dessine pas', count() === before);
    st.setSetting('fingerDraw', true); an.lastPenAt = 0;
    gesture(v, 0, wave(60, 440), { type: 'touch', id: 22 });
    ok('Doigt : dessine si l\'option est activée', count() === before + 1);
    gesture(v, 0, wave(60, 460), { type: 'pen', id: 23 });
    const b2 = count();
    gesture(v, 0, wave(60, 480), { type: 'touch', id: 24 });
    ok('Rejet de la paume après le stylet', count() === b2);
    st.setSetting('fingerDraw', false);
    // Courbe de pression personnalisée
    st.setSetting('pressureCurve', 2.0);
    gesture(v, 0, [[60, 500, 0.5], [120, 500, 0.5], [200, 500, 0.5]]);
    const pc = v.ann[0].at(-1).pts[2];
    ok('Réglage de sensibilité appliqué', Math.abs(pc - 0.25) < 0.01, pc);
    st.setSetting('pressureCurve', 1.0);
    // Inclinaison
    an.setTool('pen', 'crayon');
    const pg = v.pages[0], r = pg.div.getBoundingClientRect();
    const e = (t, x, y) => pg.live.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 31, pointerType: 'pen', pressure: 0.6, clientX: r.left + x, clientY: r.top + y, buttons: t === 'pointerup' ? 0 : 1, button: t === 'pointermove' ? -1 : 0, tiltX: 60 }));
    e('pointerdown', 60, 520); for (let i = 1; i < 20; i++) e('pointermove', 60 + i * 10, 520); e('pointerup', 260, 520);
    const tl = v.ann[0].at(-1).pts[3];
    ok('Inclinaison du stylet enregistrée', tl > 0.5, tl);
  });

  await step('Ligne droite en restant immobile', async () => {
    an.setTool('pen', 'bic');
    const pg = v.pages[0], r = pg.div.getBoundingClientRect();
    const e = (t, x, y) => pg.live.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 41, pointerType: 'pen', pressure: 0.5, clientX: r.left + x, clientY: r.top + y, buttons: t === 'pointerup' ? 0 : 1, button: t === 'pointermove' ? -1 : 0 }));
    e('pointerdown', 60, 560);
    for (let i = 1; i <= 15; i++) e('pointermove', 60 + i * 15, 560 + Math.sin(i) * 10);
    await sleep(900);
    e('pointermove', 330, 600);
    e('pointerup', 330, 600);
    const s = v.ann[0].at(-1), n = s.pts.length / 4;
    let maxDev = 0;
    const [x0, y0, x1, y1] = [s.pts[0], s.pts[1], s.pts[(n - 1) * 4], s.pts[(n - 1) * 4 + 1]];
    for (let i = 0; i < n; i++) { const px = s.pts[i * 4], py = s.pts[i * 4 + 1]; maxDev = Math.max(maxDev, Math.abs((x1 - x0) * (y0 - py) - (x0 - px) * (y1 - y0)) / Math.hypot(x1 - x0, y1 - y0)); }
    ok('Trait redressé en ligne droite', maxDev < 0.5, 'écart ' + maxDev.toFixed(2));
  });

  // --- Annuler / rétablir, gomme ---
  await step('Annuler / rétablir', async () => {
    const n = count();
    an.undo(); ok('Annuler', count() === n - 1);
    an.redo(); ok('Rétablir', count() === n);
  });
  await step('Gomme', async () => {
    v.goto(1); await sleep(300); await v.renderPage(1);
    an.setTool('pen', 'feutre');
    gesture(v, 1, [[50, 200], [450, 200]].flatMap(([x, y], k, arr) => k ? Array.from({ length: 30 }, (_, i) => [arr[0][0] + (x - arr[0][0]) * (i + 1) / 30, y, 0.6]) : [[x, y, 0.6]]));
    ok('Trait de test page 2', count(1, 'ink') === 1);
    an.setTool('eraser'); an.eraserMode = 'precise';
    gesture(v, 1, [[250, 180], [250, 200], [250, 220]], { type: 'mouse', id: 2 });
    ok('Gomme précise : coupe le trait en deux', count(1, 'ink') === 2, count(1, 'ink'));
    an.eraserMode = 'stroke';
    gesture(v, 1, [[100, 190], [100, 210]], { type: 'mouse', id: 3 });
    ok('Gomme : efface le trait entier', count(1, 'ink') === 1, count(1, 'ink'));
    an.setTool('pen', 'bic');
    gesture(v, 1, [[60, 300, 0.5], [200, 305, 0.5], [300, 300, 0.5]], { type: 'pen', id: 51, buttons: 32 });
    ok('Bout gomme du stylet', count(1, 'ink') === 1);
    an.undo(); an.undo(); an.redo(); an.redo();
  });

  // --- Lasso, sélection ---
  await step('Lasso et sélection', async () => {
    v.goto(2); await sleep(300); await v.renderPage(2);
    an.setTool('pen', 'bic');
    gesture(v, 2, wave(100, 300, 120));
    gesture(v, 2, wave(100, 340, 120));
    an.setTool('lasso');
    gesture(v, 2, [[80, 270], [260, 270], [260, 380], [80, 380], [80, 272]], { type: 'mouse', id: 4 });
    ok('Lasso sélectionne 2 traits', an.selection?.ids.size === 2, an.selection?.ids.size);
    ok('Barre de sélection affichée', !!v.pages[2].obj.querySelector('.selbox'));
    const x0 = v.ann[2][0].pts[0];
    an.recolor('#c0392b');
    ok('Changer la couleur', v.ann[2].every(a => a.color === '#c0392b'));
    an.duplicateSel();
    ok('Dupliquer', count(2) === 4);
    an.deleteSel();
    ok('Supprimer la sélection', count(2) === 2);
    // Outil sélection : clic sur un trait puis déplacement
    an.setTool('select');
    const pg = v.pages[2], r = pg.div.getBoundingClientRect();
    const s = v.ann[2][0], vp = v.viewport(2);
    const [cx, cy] = vp.convertToViewportPoint(s.pts[8], s.pts[9]);
    pg.div.querySelector('.textLayer').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 5, pointerType: 'mouse', clientX: r.left + cx, clientY: r.top + cy, button: 0, buttons: 1 }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 5, clientX: r.left + cx + 40, clientY: r.top + cy + 20 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 5, clientX: r.left + cx + 40, clientY: r.top + cy + 20 }));
    ok('Sélection d\'un trait au clic', an.selection?.ids.has(s.id));
    ok('Déplacer un trait', Math.abs(v.ann[2][0].pts[0] - x0 - 40 / (v.zoom * 4 / 3)) < 1.5, (v.ann[2][0].pts[0] - x0).toFixed(1));
    an.clearSelection();
  });

  // --- Formes, texte, note, image, laser, main ---
  await step('Formes', async () => {
    v.goto(3); await sleep(300); await v.renderPage(3);
    for (const k of ['rect', 'ellipse', 'line', 'arrow']) { an.setTool('shape', k); gesture(v, 3, [[80, 100], [150, 140], [220, 180]], { type: 'mouse', id: 6 }); }
    ok('4 formes ajoutées', count(3, 'shape') === 4, v.ann[3].map(a => a.kind).join(','));
  });
  await step('Zone de texte', async () => {
    an.setTool('text');
    gesture(v, 3, [[100, 300]], { type: 'mouse', id: 7 });
    await sleep(80);
    const t = v.ann[3].find(a => a.type === 'text');
    ok('Zone de texte créée', !!t);
    const ed = v.pages[3].obj.querySelector('.tb-edit');
    ok('Zone de texte éditable', ed && document.activeElement === ed);
    ed.dispatchEvent(new FocusEvent('focus'));
    ed.innerText = 'Bonjour Folio : énergie, chlorophylle, œuvre';
    ed.dispatchEvent(new Event('input'));
    v.pages[3].obj.querySelector('.tb-fmt .chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ed.dispatchEvent(new FocusEvent('blur')); await sleep(50);
    const t2 = v.ann[3].find(a => a.type === 'text');
    ok('Texte enregistré', t2?.text.startsWith('Bonjour Folio'), t2?.text);
    ok('Mise en forme (taille)', t2?.size === 11, t2?.size);
    an.setTool('text'); gesture(v, 3, [[100, 500]], { type: 'mouse', id: 8 }); await sleep(80);
    { const e2 = v.pages[3].obj.querySelectorAll('.tb-edit'); e2[e2.length - 1].dispatchEvent(new FocusEvent('blur')); } await sleep(50);
    ok('Zone de texte vide supprimée', count(3, 'text') === 1, count(3, 'text'));
  });
  await step('Note', async () => {
    an.setTool('note');
    gesture(v, 3, [[400, 120]], { type: 'mouse', id: 9 });
    await sleep(80);
    const pop = document.querySelector('.note-pop');
    ok('Fenêtre de note ouverte', !!pop);
    pop.querySelector('textarea').value = 'À réviser pour jeudi';
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await sleep(50);
    ok('Texte de la note enregistré', v.ann[3].find(a => a.type === 'note')?.text === 'À réviser pour jeudi');
  });
  await step('Signature / image', async () => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 80; const x = c.getContext('2d'); x.strokeStyle = '#14204f'; x.lineWidth = 4; x.beginPath(); x.moveTo(10, 60); x.bezierCurveTo(60, 0, 120, 100, 190, 20); x.stroke();
    an.armStamp({ src: c.toDataURL('image/png'), w: 200, h: 80, kind: 'signature' });
    gesture(v, 3, [[300, 600]], { type: 'mouse', id: 10 });
    await sleep(50);
    const img = v.ann[3].find(a => a.type === 'image');
    ok('Signature placée', !!img && Math.abs(img.w - 150) < 1);
    ok('Signature affichée', !!v.pages[3].obj.querySelector('.obj-image img'));
  });
  await step('Pointeur laser et main', async () => {
    const n = count(3);
    an.setTool('laser'); gesture(v, 3, wave(50, 700, 200), { type: 'mouse', id: 12 });
    ok('Laser : ne laisse pas de trace', count(3) === n);
    an.setTool('hand');
    const top = v.scroller.scrollTop;
    const pg = v.pages[3], r = pg.div.getBoundingClientRect();
    pg.live.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 13, pointerType: 'mouse', clientX: r.left + 200, clientY: r.top + 300, button: 0, buttons: 1 }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 13, clientX: r.left + 200, clientY: r.top + 150 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 13, clientX: r.left + 200, clientY: r.top + 150 }));
    ok('Main : fait défiler la page', v.scroller.scrollTop > top, v.scroller.scrollTop - top);
    an.setTool('select');
  });

  // --- Surlignage de texte sélectionné ---
  await step('Sélection de texte', async () => {
    v.goto(4); await sleep(500); await v.renderPage(4); await v.pages[4].textReady;
    const spans = v.pages[4].textLayer.querySelectorAll('span:not(.markedContent)');
    const range = document.createRange(); range.setStart(spans[1].firstChild, 3); range.setEnd(spans[1].firstChild, 16);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    v.scroller.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await sleep(60);
    const pop = document.querySelector('.selpop');
    ok('Mini-barre de sélection', !!pop);
    pop.querySelector('.dot').click();
    const mk = v.ann[4].find(a => a.type === 'markup');
    ok('Surlignage créé', mk?.kind === 'highlight' && mk.text === 'photosynthese', mk?.text);
    const rects = [...range.getClientRects()];
    an.markupFromRects('underline', '#d0342c', rects, 'x');
    an.markupFromRects('strike', '#d0342c', rects, 'x');
    ok('Souligner et barrer', count(4, 'markup') === 3);
  });

  // --- Navigation, zoom, recherche, signets ---
  await step('Navigation et zoom', async () => {
    v.goto(2); await sleep(100);
    ok('Aller à la page 3', v.current === 2, v.current);
    const z = v.zoom; v.setZoom(z * 1.5); ok('Zoom avant', Math.abs(v.zoom - z * 1.5) < 0.01);
    v.fitWidth(); await sleep(50); ok('Ajuster à la largeur', v.pages[0].div.offsetWidth <= v.scroller.clientWidth);
    v.fitPage(); await sleep(80); ok('Page entière', v.pages[2].div.offsetHeight <= v.scroller.clientHeight);
    v.toggleSpread(); ok('Deux pages', v.pagesEl.classList.contains('spread')); v.toggleSpread();
    v.rotateView(90); ok('Pivoter l\'affichage', v.rotOf(0) === 90); v.rotateView(-90);
    v.fitWidth(); await sleep(300);
  });
  await step('Recherche', async () => {
    v.showSide('search');
    v.searchInput.value = 'ligne 7'; v.searchInput.dispatchEvent(new Event('input'));
    await sleep(900);
    const hits = v.searchHits?.length;
    ok('Recherche plein texte', hits === 5, hits);
    await v.showHit(v.searchHits[2]);
    ok('Aller au résultat et le surligner', v.current === 2 && v.pages[2].textLayer.querySelector('.highlight'));
    v.showSide('outline'); await sleep(100);
    ok('Sommaire (document sans sommaire)', v.sideBody.textContent.includes('pas de sommaire'));
  });
  await step('Signets et panneau des annotations', async () => {
    v.goto(1); await sleep(100);
    const p = v.toggleBookmark(); await sleep(50);
    lastModal().querySelector('input').value = 'Définition';
    btnByText('OK', lastModal()).click(); await p; await sleep(50);
    ok('Signet ajouté', v.bookmarks.some(b => b.page === 1 && b.label === 'Définition'));
    v.showSide('notes'); await sleep(50);
    ok('Liste des annotations', v.sideBody.querySelectorAll('.note-item').length >= 5, v.sideBody.querySelectorAll('.note-item').length);
    v.showSide('pages');
  });

  // --- Opérations sur les pages ---
  await step('Pages : pivoter, insérer, dupliquer, déplacer, supprimer', async () => {
    app().pageOps.rotate(v, [0], 90);
    ok('Pivoter une page', v.pageRot[0] === 90);
    app().pageOps.rotate(v, [0], -90);
    const inkP3 = count(3);
    app().pageOps.insertBlank(v, 1); await sleep(50);
    btnByText('Insérer', lastModal()).click(); await sleep(1500);
    ok('Insérer une page de notes Seyès', v.count === 6, v.count);
    ok('Annotations décalées avec les pages', count(4) === inkP3, count(4) + ' / ' + inkP3);
    app().pageOps.duplicate(v, 0); await sleep(1500);
    ok('Dupliquer une page', v.count === 7);
    ok('Annotations dupliquées', count(1) === count(0) && count(0) > 0);
    app().pageOps.move(v, 6, 0); await sleep(1500);
    ok('Déplacer une page', v.count === 7 && count(0) === 3, count(0));
    app().pageOps.remove(v, [2, 3]); await sleep(1500);
    ok('Supprimer des pages', v.count === 5);
    const undoBtn = [...document.querySelectorAll('.toast .linklike')].pop();
    undoBtn?.click(); await sleep(1500);
    ok('Annuler une opération de pages', v.count === 7, v.count);
    app().pageOps.remove(v, [2, 3]); await sleep(1500);
    downloads.length = 0;
    await app().pageOps.extract(v, [0]);
    ok('Extraire une page', downloads.some(d => /_p1\.pdf$/.test(d)), downloads.join(','));
  });

  // --- Enregistrement, réouverture, impression, export ---
  let saved;
  await step('Enregistrement et réouverture', async () => {
    const { buildAnnotatedPdf, rasterExport } = await import('/js/save.js');
    const totalBefore = v.ann.reduce((s, l) => s + l.length, 0);
    saved = await buildAnnotatedPdf(v);
    ok('PDF annoté généré', saved.length > 1000, saved.length);
    await app().openBytes(saved, 'reouverture.pdf');
    const v2 = app().active;
    const total = v2.ann.reduce((s, l) => s + l.length, 0);
    ok('Annotations modifiables à la réouverture', total === totalBefore, total + ' / ' + totalBefore);
    const { openPdf } = await import('/js/pdf.js');
    const allAnn = async (pdf) => { const o = []; for (let i = 1; i <= pdf.numPages; i++) o.push(...await (await pdf.getPage(i)).getAnnotations()); return o; };
    const pdfAnn = await allAnn(v2.pdf);
    ok('Pas de doublon des notes à la réouverture', pdfAnn.filter(a => a.subtype === 'Text').length === 0, pdfAnn.length);
    const other = await openPdf(saved);
    const annO = await allAnn(other);
    const expectedNotes = v.ann.flat().filter(a => a.type === 'note' || (a.type === 'markup' && a.comment)).length;
    ok('Notes lisibles dans les autres lecteurs', annO.filter(a => a.subtype === 'Text').length === expectedNotes, annO.length + ' / ' + expectedNotes);
    const ras = await rasterExport(v);
    ok('Export de secours en images', ras.length > 1000);
    v2.dirty = false; await app().close(v2);
    app().activate(v);
  });
  await step('Impression et export d\'images', async () => {
    const origPrint = window.print; let printed = 0; window.print = () => { printed++; };
    const root = document.getElementById('print-root');
    const obs = []; const mo = new MutationObserver(() => obs.push(root.childElementCount)); mo.observe(root, { childList: true });
    await app().print(v);
    mo.disconnect(); window.print = origPrint;
    ok('Impression préparée (toutes les pages)', printed === 1 && Math.max(...obs) === v.count, Math.max(...obs));
    downloads.length = 0;
    await app().exportImages(v);
    ok('Export des pages en images (ZIP)', downloads.some(d => d.endsWith('_images.zip')), downloads.join(','));
  });

  // --- Étude ---
  await step('Mode étude', async () => {
    st.setSetting('blueFilter', 0.4);
    ok('Filtre lumière bleue', document.getElementById('blue-filter').style.opacity === '0.4');
    st.setSetting('blueFilter', 0);
    for (const m of ['sepia', 'night', 'gray', 'contrast']) { st.setSetting('pageMode', m); }
    ok('Modes de page', document.body.dataset.pagemode === 'contrast' && getComputedStyle(v.pages[0].pdfC).filter.includes('contrast'));
    st.setSetting('pageMode', 'normal');
    st.setSetting('pageDim', 0.3); ok('Assombrir les pages', getComputedStyle(document.body).getPropertyValue('--page-dim').trim() === '0.3'); st.setSetting('pageDim', 0);
    const s = app().study;
    s.toggleRuler(true); ok('Règle de lecture', !document.getElementById('reading-ruler').classList.contains('hidden')); s.toggleRuler(false);
    s.startPomo(); ok('Pomodoro', /\d+:\d\d/.test(s.badge.textContent), s.badge.textContent); s.stopPomo();
    document.body.classList.add('focus'); ok('Mode focus masque l\'interface', getComputedStyle(document.querySelector('.topbar')).display === 'none'); document.body.classList.remove('focus');
    s.exportSummary(v); await sleep(50);
    ok('Fiche de synthèse', lastModal()?.textContent.includes('photosynthese'));
    closeModals();
    s.review(v); await sleep(50);
    ok('Révision des surlignages', !!lastModal()?.querySelector('.card-face'));
    closeModals();
    s.panel(app().studyBtn); await sleep(30);
    ok('Panneau Étude', document.querySelectorAll('.study-panel .study-act').length === 9);
    closeModals();
  });

  // --- Recherche de mots, IA ---
  await step('Dictionnaire, traduction, IA', async () => {
    const key = st.getSettings().claudeKey; st.setSetting('claudeKey', '');
    await app().lookup.explain(v, 'chlorophylle');
    ok('IA sans clé : invite à ajouter une clé', v.rpanel.textContent.includes('clé API'));
    st.setSetting('claudeKey', key);
    if (!skipNetwork) {
      app().lookup.define(v, 'chlorophylle'); await sleep(3500);
      ok('Dictionnaire (Wiktionnaire)', v.rpanel.textContent.includes('Étymologie') || v.rpanel.textContent.includes('Nom commun'), v.rpanel.textContent.slice(0, 80));
      app().lookup.etymology(v, 'chlorophylle'); await sleep(3500);
      ok('Étymologie (Wiktionnaire)', v.rpanel.querySelector('.dict-etym') && /grec|χλωρ/i.test(v.rpanel.textContent), v.rpanel.textContent.slice(0, 120));
      ok('Étymologie : liens CNRTL / Etymonline', !!v.rpanel.querySelector('a[href*="cnrtl.fr/etymologie/chlorophylle"]') && !!v.rpanel.querySelector('a[href*="etymonline.com"]'));
      app().lookup.translate(v, 'La lumière du soleil'); await sleep(300);
      const sel = v.rpanel.querySelector('select'); sel.value = 'en'; sel.dispatchEvent(new Event('change')); await sleep(2500);
      ok('Traduction (Google)', /sun/i.test(v.rpanel.textContent), v.rpanel.querySelector('.rp-text')?.textContent);
      app().lookup.translatePage(v); await sleep(3000);
      ok('Traduire la page', (v.rpanel.querySelector('.rp-text')?.textContent || '').length > 200);
    }
    v.rpanel.classList.remove('open'); v.rpanel.innerHTML = '';
    ok('Lecture à voix haute disponible', 'speechSynthesis' in window);
  });

  // --- Réglages ---
  await step('Réglages', async () => {
    app().openSettings(); await sleep(50);
    const m = lastModal();
    ok('Fenêtre de réglages', m?.querySelectorAll('select').length >= 5 && m.querySelector('input[type=password]'));
    const sel = m.querySelector('select'); sel.value = 'light'; sel.dispatchEvent(new Event('change'));
    ok('Thème clair', document.documentElement.dataset.theme === 'light');
    sel.value = 'dark'; sel.dispatchEvent(new Event('change'));
    closeModals();
  });

  // --- Outils PDF ---
  await step('Outils PDF', async () => {
    const { RUN, openTool } = await import('/js/tools.js');
    const { PDFLib } = await import('/js/pdf.js');
    const L = await PDFLib();
    const src = new File([bytes], 'source.pdf', { type: 'application/pdf' });
    const p = () => {};
    const expect = async (name, fn, check) => { try { const o = await fn(); ok('Outil : ' + name, check(o), Array.isArray(o) ? o.map(f => f.name).join(',') : 'html'); } catch (e) { ok('Outil : ' + name, false, e.message); } };
    const pages = async (o) => (await L.PDFDocument.load(o[0].data)).getPageCount();
    await expect('fusionner', () => RUN.merge([src, src], {}, p), async (o) => true);
    ok('Fusion : 10 pages', await pages(await RUN.merge([src, src], {}, p)) === 10);
    await expect('diviser', () => RUN.split([src], { mode: 'every', every: 2 }, p), (o) => o.length === 3);
    await expect('supprimer des pages', () => RUN.remove([src], { ranges: '2-3' }, p), (o) => o.length === 1);
    ok('Suppression : 3 pages restantes', await pages(await RUN.remove([src], { ranges: '2-3' }, p)) === 3);
    await expect('extraire', () => RUN.extract([src], { ranges: '1, 5' }, p), (o) => o.length === 1);
    await expect('pivoter', () => RUN.rotate([src], { angle: 90, ranges: '1' }, p), (o) => o.length === 1);
    const rot = await L.PDFDocument.load((await RUN.rotate([src], { angle: 90, ranges: '1' }, p))[0].data);
    ok('Rotation appliquée', rot.getPage(0).getRotation().angle === 90 && rot.getPage(1).getRotation().angle === 0);
    await expect('compresser', () => RUN.compress([src], { level: 'rec' }, p), (o) => o[0].data.length > 0);
    await expect('recadrer', () => RUN.crop([src], { mode: 'auto', pad: 4 }, p), (o) => o.length === 1);
    const cr = await L.PDFDocument.load((await RUN.crop([src], { mode: 'auto', pad: 4 }, p))[0].data);
    ok('Marges rognées', cr.getPage(0).getCropBox().width < 595, cr.getPage(0).getCropBox().width.toFixed(0));
    await expect('réparer', () => RUN.repair([src], {}, p), (o) => o.length === 1);
    await expect('PDF en images', () => RUN.pdf2img([src], { fmt: 'png', dpi: 72, ranges: '1-2' }, p), (o) => o.length === 2);
    await expect('PDF en texte', () => RUN.pdf2txt([src], {}, p), (o) => new TextDecoder().decode(o[0].data).includes('photosynthese'));
    await expect('plusieurs pages par feuille', () => RUN.nup([src], { n: 2, border: true }, p), (o) => o.length === 1);
    ok('2 par feuille : 3 feuilles', await pages(await RUN.nup([src], { n: 2, border: true }, p)) === 3);
    await expect('filigrane', () => RUN.watermark([src], { text: 'COPIE', size: 50, color: '#c0392b', opacity: 0.3, pos: 'tile' }, p), (o) => o.length === 1);
    await expect('numéros de page', () => RUN.numbers([src], { pos: 'br', fmt: '{n} / {t}', start: 1, from: 2, size: 10 }, p), (o) => o.length === 1);
    const { openPdf } = await import('/js/pdf.js');
    const np = await openPdf((await RUN.numbers([src], { pos: 'br', fmt: '{n} / {t}', start: 1, from: 2, size: 10 }, p))[0].data);
    const txt2 = (await (await np.getPage(2)).getTextContent()).items.map(i => i.str).join(' ');
    ok('Numérotation visible', txt2.includes('1 / 4'), txt2.slice(-30));
    await expect('propriétés', () => RUN.meta([src], { title: 'Mon cours', author: 'Moi', subject: '', keywords: 'bio', creator: '' }, p), (o) => o.length === 1);
    const md = await L.PDFDocument.load((await RUN.meta([src], { title: 'Mon cours', author: 'Moi', subject: '', keywords: 'bio', creator: '' }, p))[0].data);
    ok('Titre modifié', md.getTitle() === 'Mon cours');
    await expect('aplatir', () => RUN.flatten([src], {}, p), (o) => o.length === 1);
    await expect('cahier de notes', () => RUN.blank([], { style: 'cornell', n: 4, size: 'a5' }, p), (o) => o.length === 1);
    const c = document.createElement('canvas'); c.width = 400; c.height = 300; c.getContext('2d').fillRect(50, 50, 100, 100);
    const png = await new Promise(r => c.toBlob(async b => r(new Uint8Array(await b.arrayBuffer())), 'image/png'));
    await expect('images en PDF', () => RUN.img2pdf([new File([png], 'a.png', { type: 'image/png' }), new File([png], 'b.png', { type: 'image/png' })], { size: 'fit', margin: 0 }, p), (o) => o.length === 1);
    await expect('comparer', () => RUN.compare([src, new File([saved], 'b.pdf')], {}, p), (o) => !!o.html);
    // Formulaire
    const fd = await L.PDFDocument.create(); const fp = fd.addPage([595, 842]); const form = fd.getForm();
    const tf = form.createTextField('nom'); tf.addToPage(fp, { x: 50, y: 700, width: 200, height: 24 });
    const cb = form.createCheckBox('accord'); cb.addToPage(fp, { x: 50, y: 650, width: 18, height: 18 });
    const formFile = new File([await fd.save()], 'formulaire.pdf', { type: 'application/pdf' });
    const fo = await RUN.form([formFile], { values: [['nom', 'text', 'Dupont'], ['accord', 'check', true]], flatten: false }, p);
    const filled = (await L.PDFDocument.load(fo[0].data)).getForm();
    ok('Outil : remplir un formulaire', filled.getTextField('nom').getText() === 'Dupont' && filled.getCheckBox('accord').isChecked());
    // Déverrouiller (reconstruction sans mot de passe)
    await expect('déverrouiller', () => RUN.unlock([src], { password: '' }, p), (o) => o.length === 1);
    // Fenêtres des outils
    for (const t of ['merge', 'split', 'compress', 'watermark', 'numbers', 'crop', 'ocr', 'img2pdf', 'pdf2img', 'blank']) {
      openTool(app(), t, t === 'blank' || t === 'img2pdf' ? undefined : [src]); await sleep(300);
      const m = lastModal();
      const okWin = !!m && !!btnByText('Lancer', m);
      if (t === 'split') {
        btnByText('Lancer', m).click(); await sleep(1500);
        ok('Fenêtre outil : diviser puis télécharger', m.querySelectorAll('.results .file-row').length === 2, m.querySelectorAll('.results .file-row').length);
      } else ok('Fenêtre outil : ' + t, okWin);
      closeModals();
    }
    // Organiseur
    openTool(app(), 'organize', [src]); await sleep(1500);
    const om = lastModal();
    ok('Organiseur : miniatures', om?.querySelectorAll('.org-card').length === 5);
    om.querySelector('.org-card [title="Supprimer"]').click(); await sleep(50);
    downloads.length = 0;
    btnByText('Télécharger', om).click(); await sleep(1500);
    ok('Organiseur : télécharger', downloads.some(d => d.endsWith('_organise.pdf')));
    closeModals();
  });

  if (!skipNetwork) await step('OCR', async () => {
    const { runOcr } = await import('/js/tools.js');
    const { PDFLib } = await import('/js/pdf.js');
    const L = await PDFLib();
    const c = document.createElement('canvas'); c.width = 1240; c.height = 1754; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#000'; x.font = '48px Georgia';
    x.fillText('La cellule vegetale contient', 100, 300); x.fillText('des chloroplastes verts.', 100, 380);
    const d = await L.PDFDocument.create(); const img = await d.embedPng(c.toDataURL('image/png'));
    d.addPage([595, 842]).drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
    const out = await runOcr(await d.save(), 'scan.pdf', { lang: 'fra' }, () => {});
    const { openPdf } = await import('/js/pdf.js');
    const t = (await (await (await openPdf(out[0].data)).getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
    ok('OCR : texte cherchable', /chloroplastes/i.test(t), t.slice(0, 80));
  });

  await step('Signatures', async () => {
    const { signs } = await import('/js/sign.js');
    const { idb } = await import('/js/store.js');
    const before = (await idb.all('signatures')).length;
    signs.create('stamp'); await sleep(100);
    btnByText('Enregistrer', lastModal()).click(); await sleep(300);
    signs.create('type'); await sleep(100);
    lastModal().querySelector('input').value = 'Jean Dupont'; lastModal().querySelector('input').dispatchEvent(new Event('input'));
    btnByText('Enregistrer', lastModal()).click(); await sleep(1500);
    const after = await idb.all('signatures');
    ok('Tampon et signature tapée enregistrés', after.length === before + 2, after.length - before);
    for (const s of after.slice(before)) await idb.del('signatures', s.key);
    closeModals();
  });

  unhookDownloads();
  closeModals();
  const failed = results.filter(r => !r.ok);
  console.table(results);
  return { total: results.length, passed: results.length - failed.length, failed };
}
