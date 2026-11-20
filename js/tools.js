// Boîte à outils (façon iLovePDF) : tout est traité localement, rien n'est envoyé.
import { PDFLib, loadLib, openPdf, renderPageToCanvas, canvasToBytes } from './pdf.js';
import { el, icon, btn, modal, toast, pickFiles, downloadBlob, fmtSize, baseName, parseRanges, busy } from './ui.js';
import { makeZip } from './zip.js';
import { drawPaper, PAPERS } from './pages.js';

const MM = 72 / 25.4;
const pdfBlob = (b) => new Blob([b], { type: 'application/pdf' });
const readBytes = async (f) => new Uint8Array(await f.arrayBuffer());

// --- Définition des outils ------------------------------------------------------
export const TOOLS = [
  { id: 'merge', icon: 'merge', title: 'Fusionner', desc: 'Assembler plusieurs PDF en un seul, dans l\'ordre voulu.', multi: true, cat: 'Organiser' },
  { id: 'split', icon: 'split', title: 'Diviser', desc: 'Séparer par plages, toutes les N pages ou page par page.', cat: 'Organiser' },
  { id: 'organize', icon: 'organize', title: 'Organiser les pages', desc: 'Réordonner, pivoter, supprimer, ajouter des pages.', cat: 'Organiser' },
  { id: 'remove', icon: 'trash', title: 'Supprimer des pages', desc: 'Retirer les pages choisies.', cat: 'Organiser' },
  { id: 'extract', icon: 'pages', title: 'Extraire des pages', desc: 'Créer un PDF avec une sélection de pages.', cat: 'Organiser' },
  { id: 'rotate', icon: 'rotate', title: 'Pivoter', desc: 'Faire pivoter tout ou partie des pages.', cat: 'Organiser' },
  { id: 'compress', icon: 'compress', title: 'Compresser', desc: 'Réduire la taille en recompressant les images.', multi: true, cat: 'Optimiser' },
  { id: 'crop', icon: 'crop', title: 'Recadrer / rogner les marges', desc: 'Supprimer les marges blanches, idéal pour lire sur tablette.', cat: 'Optimiser' },
  { id: 'repair', icon: 'wrench', title: 'Réparer', desc: 'Tenter de récupérer un PDF endommagé.', cat: 'Optimiser' },
  { id: 'ocr', icon: 'ocr', title: 'OCR : rendre un scan cherchable', desc: 'Reconnaître le texte d\'un document numérisé.', cat: 'Optimiser' },
  { id: 'img2pdf', icon: 'fromimg', title: 'Images en PDF', desc: 'Convertir des JPG / PNG en un PDF.', multi: true, accept: 'image/*', cat: 'Convertir' },
  { id: 'pdf2img', icon: 'toimg', title: 'PDF en images', desc: 'Exporter les pages en JPG ou PNG.', cat: 'Convertir' },
  { id: 'pdf2txt', icon: 'text', title: 'PDF en texte', desc: 'Extraire tout le texte dans un fichier .txt.', cat: 'Convertir' },
  { id: 'nup', icon: 'nup', title: 'Plusieurs pages par feuille', desc: '2, 4 ou 6 pages par feuille pour imprimer.', cat: 'Convertir' },
  { id: 'watermark', icon: 'watermark', title: 'Filigrane', desc: 'Ajouter un texte en filigrane.', cat: 'Modifier' },
  { id: 'numbers', icon: 'numbers', title: 'Numéros de page', desc: 'Numéroter les pages, position et format au choix.', cat: 'Modifier' },
  { id: 'meta', icon: 'info', title: 'Propriétés du document', desc: 'Modifier titre, auteur, sujet, mots-clés.', cat: 'Modifier' },
  { id: 'form', icon: 'form', title: 'Remplir un formulaire', desc: 'Compléter les champs d\'un formulaire PDF.', cat: 'Modifier' },
  { id: 'flatten', icon: 'layers', title: 'Aplatir', desc: 'Figer formulaires et annotations dans la page.', cat: 'Modifier' },
  { id: 'blank', icon: 'blank', title: 'Cahier de notes', desc: 'Créer un PDF de pages lignées, Seyès, quadrillées…', noFile: true, cat: 'Modifier' },
  { id: 'unlock', icon: 'lock', title: 'Déverrouiller', desc: 'Retirer le mot de passe d\'un PDF dont vous l\'avez.', cat: 'Sécurité' },
  { id: 'compare', icon: 'compare', title: 'Comparer deux PDF', desc: 'Voir les différences de texte entre deux versions.', multi: true, cat: 'Sécurité' },
];

// --- Fenêtre générique ------------------------------------------------------------
export function openTool(app, id, preset) {
  const t = TOOLS.find(x => x.id === id);
  if (!t) return;
  if (id === 'organize') return openOrganizer(app, preset);
  let files = [];
  const list = el('div', { class: 'file-list' });
  const optsHost = el('div', { class: 'tool-opts-form' });
  const results = el('div', { class: 'results' });
  let getOpts = () => ({});

  const renderList = () => {
    list.innerHTML = '';
    files.forEach((f, k) => list.append(el('div', { class: 'file-row' },
      icon(f.type.startsWith('image') ? 'image' : 'pages', 18),
      el('span', { class: 'grow ellipsis' }, f.name), el('span', { class: 'muted small' }, fmtSize(f.size)),
      t.multi ? btn('chevl', 'Monter', () => { if (k) { [files[k - 1], files[k]] = [files[k], files[k - 1]]; renderList(); } }, 'tiny up') : null,
      t.multi ? btn('chevr', 'Descendre', () => { if (k < files.length - 1) { [files[k + 1], files[k]] = [files[k], files[k + 1]]; renderList(); } }, 'tiny down') : null,
      btn('close', 'Retirer', () => { files.splice(k, 1); renderList(); refreshOpts(); }, 'tiny'))));
  };
  const refreshOpts = async () => {
    optsHost.innerHTML = '';
    const r = await (OPTIONS[id]?.(optsHost, files) ?? null);
    getOpts = r || (() => ({}));
  };
  const addFiles = (fs) => {
    const accept = t.accept || 'application/pdf';
    fs = fs.filter(f => accept === 'image/*' ? f.type.startsWith('image/') : (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)));
    files = t.multi ? files.concat(fs) : fs.slice(0, 1);
    renderList(); refreshOpts();
  };
  const drop = el('div', { class: 'drop small' }, icon('open', 26),
    el('div', {}, t.multi ? 'Déposez vos fichiers ici ou ' : 'Déposez un fichier ici ou ', el('button', { class: 'linklike', onclick: async () => addFiles(await pickFiles(t.accept || 'application/pdf,.pdf', !!t.multi)) }, 'parcourez')));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); });

  const run = async () => {
    if (!t.noFile && !files.length) { toast('Ajoutez d\'abord un fichier.', 'error'); return false; }
    if (id === 'compare' && files.length !== 2) { toast('Choisissez exactement deux PDF.', 'error'); return false; }
    const b = busy('Traitement…');
    try {
      const out = await RUN[id](files, getOpts(), (m) => b.set(m), app);
      b.done();
      if (out) showResults(out);
    } catch (e) { b.done(); console.error(e); toast(e.userMessage || 'Le traitement a échoué : ' + (e.message || e), 'error', 6000); }
    return false;
  };

  const showResults = (out) => {
    results.innerHTML = '';
    if (out.html) { results.append(out.html); return; }
    const total = out.reduce((s, f) => s + f.data.length, 0);
    results.append(el('h3', {}, out.length > 1 ? `${out.length} fichiers prêts (${fmtSize(total)})` : 'Fichier prêt'));
    if (out.note) results.append(el('p', { class: 'muted' }, out.note));
    for (const f of out) {
      const type = /\.pdf$/.test(f.name) ? 'application/pdf' : /\.png$/.test(f.name) ? 'image/png' : /\.txt$/.test(f.name) ? 'text/plain' : 'image/jpeg';
      results.append(el('div', { class: 'file-row' }, icon(type === 'application/pdf' ? 'pages' : 'image', 18),
        el('span', { class: 'grow ellipsis' }, f.name), el('span', { class: 'muted small' }, fmtSize(f.data.length) + (f.info ? ' · ' + f.info : '')),
        type === 'application/pdf' ? el('button', { class: 'btn small', onclick: () => { m.close(); app.openBytes(f.data, f.name); } }, 'Ouvrir') : null,
        el('button', { class: 'btn small primary', onclick: () => downloadBlob(new Blob([f.data], { type }), f.name) }, 'Télécharger')));
    }
    if (out.length > 1) results.append(el('button', { class: 'btn primary', onclick: () => downloadBlob(makeZip(out), (out.zipName || 'folio') + '.zip') }, icon('download', 16), ' Tout télécharger (ZIP)'));
  };

  const body = el('div', { class: 'tool-body' },
    el('p', { class: 'muted' }, t.desc),
    t.noFile ? null : drop, t.noFile ? null : list, optsHost, results);
  const m = modal({ title: t.title, body, wide: true, actions: [{ label: 'Fermer' }, { label: 'Lancer', primary: true, onClick: run }] });
  if (preset?.length) addFiles(preset); else refreshOpts();
}

// --- Champs d'options ---------------------------------------------------------------
const field = (label, input, hint) => el('label', { class: 'field' }, el('span', {}, label), input, hint ? el('small', { class: 'muted' }, hint) : null);
const select = (opts, value) => {
  const s = el('select', { class: 'input' });
  for (const [v, l] of opts) { const o = el('option', {}, l); o.value = v; if (v === value) o.selected = true; s.append(o); }
  return s;
};
const input = (value, attrs = {}) => el('input', { class: 'input', value, ...attrs });
const radios = (name, opts, value) => {
  const w = el('div', { class: 'seg' });
  for (const [v, l, d] of opts) w.append(el('label', { class: 'seg-item' }, el('input', { type: 'radio', name, value: v, checked: v === value }), el('span', {}, el('b', {}, l), d ? el('small', {}, d) : null)));
  w.get = () => w.querySelector('input:checked')?.value;
  return w;
};
async function pageCountOf(f) { try { const d = await openPdf(await readBytes(f)); const n = d.numPages; d.destroy(); return n; } catch { return 0; } }

const OPTIONS = {
  async split(h, files) {
    const n = files[0] ? await pageCountOf(files[0]) : 0;
    const mode = radios('split', [['ranges', 'Par plages', 'Ex. : 1-3, 4-8, 9-'], ['every', 'Toutes les N pages'], ['each', 'Une page par fichier']], 'ranges');
    const ranges = input(n ? `1-${Math.ceil(n / 2)}, ${Math.ceil(n / 2) + 1}-${n}` : '1-3, 4-');
    const every = input('2', { type: 'number', min: 1 });
    h.append(n ? el('p', { class: 'muted small' }, `${n} pages`) : '', mode, field('Plages', ranges), field('N', every));
    return () => ({ mode: mode.get(), ranges: ranges.value, every: +every.value || 1 });
  },
  async remove(h, files) {
    const n = files[0] ? await pageCountOf(files[0]) : 0;
    const r = input(''); h.append(n ? el('p', { class: 'muted small' }, `${n} pages`) : '', field('Pages à supprimer', r, 'Ex. : 2, 5-7'));
    return () => ({ ranges: r.value });
  },
  async extract(h, files) {
    const n = files[0] ? await pageCountOf(files[0]) : 0;
    const r = input(''); h.append(n ? el('p', { class: 'muted small' }, `${n} pages`) : '', field('Pages à extraire', r, 'Ex. : 1, 3-4, 10-'));
    return () => ({ ranges: r.value });
  },
  rotate(h) {
    const a = radios('rot', [['90', '90° à droite'], ['180', '180°'], ['270', '90° à gauche']], '90');
    const r = input(''); h.append(a, field('Pages (vide = toutes)', r));
    return () => ({ angle: +a.get(), ranges: r.value });
  },
  compress(h) {
    const lv = radios('lvl', [
      ['low', 'Légère', 'Optimise la structure, aucune perte de qualité.'],
      ['rec', 'Recommandée', 'Recompresse les photos. Le texte reste net et sélectionnable.'],
      ['high', 'Forte', 'Images plus petites et plus compressées.'],
      ['extreme', 'Extrême', 'Transforme chaque page en image : taille minimale, texte non sélectionnable.'],
    ], 'rec');
    h.append(lv);
    return () => ({ level: lv.get() });
  },
  crop(h) {
    const mode = radios('crop', [['auto', 'Automatique', 'Détecte les marges blanches.'], ['manual', 'Manuel', 'Marges en millimètres.']], 'auto');
    const t = input('10', { type: 'number' }), r = input('10', { type: 'number' }), b = input('10', { type: 'number' }), l = input('10', { type: 'number' });
    const pad = input('4', { type: 'number' });
    h.append(mode, el('div', { class: 'grid4' }, field('Haut', t), field('Droite', r), field('Bas', b), field('Gauche', l)), field('Marge conservée en mode automatique (mm)', pad));
    return () => ({ mode: mode.get(), t: +t.value, r: +r.value, b: +b.value, l: +l.value, pad: +pad.value });
  },
  ocr(h) {
    const lang = select([['fra', 'Français'], ['eng', 'Anglais'], ['fra+eng', 'Français + anglais'], ['deu', 'Allemand'], ['spa', 'Espagnol'], ['ita', 'Italien'], ['lat', 'Latin']], 'fra');
    const r = input('');
    h.append(field('Langue du document', lang), field('Pages (vide = toutes)', r),
      el('p', { class: 'muted small' }, 'La reconnaissance se fait sur cet appareil. Au premier usage, le moteur et le dictionnaire de la langue (environ 15 Mo) sont téléchargés depuis jsDelivr.'));
    return () => ({ lang: lang.value, ranges: r.value });
  },
  img2pdf(h) {
    const size = select([['a4', 'A4'], ['letter', 'Lettre US'], ['fit', 'Taille de l\'image']], 'a4');
    const margin = select([['0', 'Aucune'], ['10', 'Petite (10 mm)'], ['20', 'Grande (20 mm)']], '0');
    h.append(el('div', { class: 'grid2' }, field('Format de page', size), field('Marges', margin)));
    return () => ({ size: size.value, margin: +margin.value });
  },
  pdf2img(h) {
    const fmt = select([['jpg', 'JPG'], ['png', 'PNG']], 'jpg');
    const dpi = select([['72', '72 ppp (écran)'], ['150', '150 ppp (standard)'], ['300', '300 ppp (impression)']], '150');
    const r = input('');
    h.append(el('div', { class: 'grid2' }, field('Format', fmt), field('Résolution', dpi)), field('Pages (vide = toutes)', r));
    return () => ({ fmt: fmt.value, dpi: +dpi.value, ranges: r.value });
  },
  nup(h) {
    const n = select([['2', '2 pages par feuille'], ['4', '4 pages par feuille'], ['6', '6 pages par feuille']], '2');
    const border = el('input', { type: 'checkbox', checked: true });
    h.append(field('Disposition', n), el('label', { class: 'check' }, border, ' Encadrer chaque page'));
    return () => ({ n: +n.value, border: border.checked });
  },
  watermark(h) {
    const text = input('CONFIDENTIEL'), size = input('60', { type: 'number' }), color = el('input', { type: 'color', value: '#c0392b' });
    const op = el('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: 0.25 });
    const pos = select([['center', 'Centré en diagonale'], ['tile', 'Répété (mosaïque)'], ['top', 'En haut'], ['bottom', 'En bas']], 'center');
    h.append(field('Texte', text), el('div', { class: 'grid2' }, field('Taille', size), field('Couleur', color)), field('Opacité', op), field('Position', pos));
    return () => ({ text: text.value, size: +size.value, color: color.value, opacity: +op.value, pos: pos.value });
  },
  numbers(h) {
    const pos = select([['bc', 'En bas au centre'], ['br', 'En bas à droite'], ['bl', 'En bas à gauche'], ['tc', 'En haut au centre'], ['tr', 'En haut à droite'], ['tl', 'En haut à gauche']], 'bc');
    const fmt = select([['{n}', '1'], ['{n} / {t}', '1 / 10'], ['Page {n}', 'Page 1'], ['Page {n} sur {t}', 'Page 1 sur 10'], ['- {n} -', '- 1 -']], '{n} / {t}');
    const start = input('1', { type: 'number' }), from = input('1', { type: 'number' }), size = input('10', { type: 'number' });
    h.append(el('div', { class: 'grid2' }, field('Position', pos), field('Format', fmt)), el('div', { class: 'grid3' }, field('Premier numéro', start), field('À partir de la page', from), field('Taille', size)));
    return () => ({ pos: pos.value, fmt: fmt.value, start: +start.value, from: +from.value, size: +size.value });
  },
  async meta(h, files) {
    if (!files[0]) return null;
    const doc = await loadLib(await readBytes(files[0]));
    const f = { title: input(doc.getTitle() || ''), author: input(doc.getAuthor() || ''), subject: input(doc.getSubject() || ''), keywords: input(doc.getKeywords() || ''), creator: input(doc.getCreator() || '') };
    const wipe = el('input', { type: 'checkbox' });
    h.append(field('Titre', f.title), field('Auteur', f.author), field('Sujet', f.subject), field('Mots-clés', f.keywords), field('Application d\'origine', f.creator), el('label', { class: 'check' }, wipe, ' Tout effacer (anonymiser)'));
    return () => ({ wipe: wipe.checked, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.value])) });
  },
  async form(h, files) {
    if (!files[0]) return null;
    const doc = await loadLib(await readBytes(files[0]));
    let fields = [];
    try { fields = doc.getForm().getFields(); } catch {}
    if (!fields.length) { h.append(el('p', { class: 'empty' }, 'Ce PDF ne contient pas de champs de formulaire.')); return null; }
    const getters = [];
    for (const fl of fields) {
      const name = fl.getName(), kind = fl.constructor.name;
      let inp;
      try {
        if (kind === 'PDFTextField') { inp = input(fl.getText() || ''); getters.push(() => [name, 'text', inp.value]); }
        else if (kind === 'PDFCheckBox') { inp = el('input', { type: 'checkbox', checked: fl.isChecked() }); getters.push(() => [name, 'check', inp.checked]); }
        else if (kind === 'PDFDropdown' || kind === 'PDFOptionList') { const o = fl.getOptions(); inp = select([['', '—'], ...o.map(x => [x, x])], fl.getSelected()[0] || ''); getters.push(() => [name, 'select', inp.value]); }
        else if (kind === 'PDFRadioGroup') { const o = fl.getOptions(); inp = select([['', '—'], ...o.map(x => [x, x])], fl.getSelected() || ''); getters.push(() => [name, 'radio', inp.value]); }
        else continue;
      } catch { continue; }
      h.append(field(name, inp));
    }
    const flat = el('input', { type: 'checkbox' });
    h.append(el('label', { class: 'check' }, flat, ' Aplatir après remplissage (non modifiable ensuite)'));
    return () => ({ values: getters.map(g => g()), flatten: flat.checked });
  },
  blank(h) {
    const style = select(PAPERS, 'seyes');
    const n = input('20', { type: 'number', min: 1 });
    const size = select([['a4', 'A4 portrait'], ['a4l', 'A4 paysage'], ['a5', 'A5'], ['letter', 'Lettre US']], 'a4');
    h.append(el('div', { class: 'grid3' }, field('Papier', style), field('Nombre de pages', n), field('Format', size)));
    return () => ({ style: style.value, n: Math.min(500, +n.value || 1), size: size.value });
  },
  unlock(h) {
    const pw = input('', { type: 'password', autocomplete: 'off' });
    h.append(field('Mot de passe du PDF', pw), el('p', { class: 'muted small' }, 'Le document est reconstruit page par page en images de haute qualité. Le texte n\'est alors plus sélectionnable (vous pouvez ensuite lancer l\'OCR).'));
    return () => ({ password: pw.value });
  },
};

// --- Traitements ------------------------------------------------------------------
async function copyAll(out, src, idx) { for (const p of await out.copyPages(src, idx ?? src.getPageIndices())) out.addPage(p); }
const err = (m) => Object.assign(new Error(m), { userMessage: m });

export const RUN = {
  async merge(files, o, prog) {
    const L = await PDFLib();
    const out = await L.PDFDocument.create();
    for (const [k, f] of files.entries()) { prog(`Fusion ${k + 1} / ${files.length}…`); await copyAll(out, await loadLib(await readBytes(f))); }
    return [{ name: 'fusion.pdf', data: await out.save() }];
  },

  async split(files, o, prog) {
    const L = await PDFLib();
    const src = await loadLib(await readBytes(files[0]));
    const n = src.getPageCount(), base = baseName(files[0].name);
    let groups = [];
    if (o.mode === 'each') groups = Array.from({ length: n }, (_, i) => [i]);
    else if (o.mode === 'every') for (let i = 0; i < n; i += o.every) groups.push(Array.from({ length: Math.min(o.every, n - i) }, (_, k) => i + k));
    else groups = o.ranges.split(/[,;]/).map(r => parseRanges(r, n)).filter(g => g.length);
    if (!groups.length) throw err('Aucune page valide dans les plages indiquées.');
    const outs = [];
    for (const [k, g] of groups.entries()) {
      prog(`Fichier ${k + 1} / ${groups.length}…`);
      const out = await L.PDFDocument.create();
      await copyAll(out, src, g);
      const label = g.length === 1 ? `p${g[0] + 1}` : `p${g[0] + 1}-${g[g.length - 1] + 1}`;
      outs.push({ name: `${base}_${label}.pdf`, data: await out.save() });
    }
    outs.zipName = base + '_divise';
    return outs;
  },

  async remove(files, o) {
    const L = await PDFLib();
    const src = await loadLib(await readBytes(files[0]));
    const del = new Set(parseRanges(o.ranges, src.getPageCount()));
    if (!del.size) throw err('Indiquez les pages à supprimer.');
    if (del.size >= src.getPageCount()) throw err('Vous ne pouvez pas supprimer toutes les pages.');
    const out = await L.PDFDocument.create();
    await copyAll(out, src, src.getPageIndices().filter(i => !del.has(i)));
    return [{ name: baseName(files[0].name) + '_modifie.pdf', data: await out.save() }];
  },

  async extract(files, o) {
    const L = await PDFLib();
    const src = await loadLib(await readBytes(files[0]));
    const idx = parseRanges(o.ranges, src.getPageCount());
    if (!idx.length) throw err('Indiquez les pages à extraire.');
    const out = await L.PDFDocument.create();
    await copyAll(out, src, idx);
    return [{ name: baseName(files[0].name) + '_extrait.pdf', data: await out.save() }];
  },

  async rotate(files, o) {
    const L = await PDFLib();
    const doc = await loadLib(await readBytes(files[0]));
    const pages = doc.getPages();
    const idx = o.ranges.trim() ? parseRanges(o.ranges, pages.length) : pages.map((_, i) => i);
    for (const i of idx) pages[i].setRotation(L.degrees((pages[i].getRotation().angle + o.angle) % 360));
    return [{ name: baseName(files[0].name) + '_pivote.pdf', data: await doc.save() }];
  },

  async compress(files, o, prog) {
    const outs = [];
    for (const [k, f] of files.entries()) {
      prog(`Compression ${k + 1} / ${files.length}…`);
      const bytes = await readBytes(f);
      let data;
      if (o.level === 'extreme') data = await rasterize(bytes, 110, 0.5, prog);
      else data = await compressImages(bytes, o.level, prog);
      let info;
      if (data.length >= bytes.length) { data = bytes; info = 'déjà optimisé'; }
      else info = '−' + Math.round((1 - data.length / bytes.length) * 100) + ' %';
      outs.push({ name: baseName(f.name) + '_compresse.pdf', data, info });
    }
    outs.note = outs.map(x => `${x.name} : ${x.info}`).join(' · ');
    return outs;
  },

  async crop(files, o, prog) {
    const bytes = await readBytes(files[0]);
    const doc = await loadLib(bytes);
    const pages = doc.getPages();
    if (o.mode === 'manual') {
      for (const p of pages) {
        const b = p.getCropBox();
        p.setCropBox(b.x + o.l * MM, b.y + o.b * MM, Math.max(20, b.width - (o.l + o.r) * MM), Math.max(20, b.height - (o.t + o.b) * MM));
      }
    } else {
      const pdf = await openPdf(bytes);
      for (let i = 0; i < pdf.numPages; i++) {
        prog(`Analyse de la page ${i + 1} / ${pdf.numPages}…`);
        const page = await pdf.getPage(i + 1);
        const bb = await contentBox(page);
        if (!bb) continue;
        const pad = o.pad * MM;
        pages[i].setCropBox(bb.x - pad, bb.y - pad, bb.w + 2 * pad, bb.h + 2 * pad);
      }
      pdf.destroy();
    }
    return [{ name: baseName(files[0].name) + '_recadre.pdf', data: await doc.save() }];
  },

  async repair(files, o, prog) {
    const bytes = await readBytes(files[0]);
    try {
      const doc = await loadLib(bytes, { throwOnInvalidObject: false });
      return [{ name: baseName(files[0].name) + '_repare.pdf', data: await doc.save() }];
    } catch {
      prog('Reconstruction par images…');
      return [{ name: baseName(files[0].name) + '_repare.pdf', data: await rasterize(bytes, 200, 0.85, prog), info: 'reconstruit en images' }];
    }
  },

  async ocr(files, o, prog) {
    const bytes = await readBytes(files[0]);
    return await runOcr(bytes, files[0].name, o, prog);
  },

  async img2pdf(files, o, prog) {
    const L = await PDFLib();
    const out = await L.PDFDocument.create();
    for (const [k, f] of files.entries()) {
      prog(`Image ${k + 1} / ${files.length}…`);
      let img;
      const buf = await readBytes(f);
      if (f.type === 'image/png') img = await out.embedPng(buf);
      else if (f.type === 'image/jpeg') img = await out.embedJpg(buf);
      else {
        const bm = await createImageBitmap(new Blob([buf], { type: f.type }));
        const c = el('canvas', { width: bm.width, height: bm.height });
        c.getContext('2d').drawImage(bm, 0, 0);
        img = await out.embedJpg(await canvasToBytes(c, 'image/jpeg', 0.92));
      }
      const m = o.margin * MM;
      let W, H;
      if (o.size === 'fit') { W = img.width * 0.75 + 2 * m; H = img.height * 0.75 + 2 * m; }
      else {
        [W, H] = o.size === 'letter' ? [612, 792] : [595.28, 841.89];
        if (img.width > img.height) [W, H] = [H, W];
      }
      const s = Math.min((W - 2 * m) / img.width, (H - 2 * m) / img.height);
      const w = img.width * s, h = img.height * s;
      out.addPage([W, H]).drawImage(img, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
    }
    return [{ name: 'images.pdf', data: await out.save() }];
  },

  async pdf2img(files, o, prog) {
    const pdf = await openPdf(await readBytes(files[0]));
    const idx = o.ranges.trim() ? parseRanges(o.ranges, pdf.numPages) : Array.from({ length: pdf.numPages }, (_, i) => i);
    const outs = [], base = baseName(files[0].name);
    for (const i of idx) {
      prog(`Page ${i + 1}…`);
      const { canvas } = await renderPageToCanvas(await pdf.getPage(i + 1), o.dpi / 72);
      outs.push({ name: `${base}_p${String(i + 1).padStart(3, '0')}.${o.fmt}`, data: await canvasToBytes(canvas, o.fmt === 'png' ? 'image/png' : 'image/jpeg', 0.9) });
      canvas.width = canvas.height = 0;
    }
    pdf.destroy();
    outs.zipName = base + '_images';
    return outs;
  },

  async pdf2txt(files, o, prog) {
    const pdf = await openPdf(await readBytes(files[0]));
    let txt = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      prog(`Page ${i} / ${pdf.numPages}…`);
      const tc = await (await pdf.getPage(i)).getTextContent();
      txt += `\n\n——— Page ${i} ———\n\n` + tc.items.map(it => (it.str || '') + (it.hasEOL ? '\n' : ' ')).join('');
    }
    pdf.destroy();
    return [{ name: baseName(files[0].name) + '.txt', data: new TextEncoder().encode(txt.trim()) }];
  },

  async nup(files, o) {
    const L = await PDFLib();
    const src = await loadLib(await readBytes(files[0]));
    const out = await L.PDFDocument.create();
    const pages = await out.embedPages(src.getPages());
    const [cols, rows] = o.n === 2 ? [2, 1] : o.n === 4 ? [2, 2] : [3, 2];
    const [W, H] = o.n === 4 ? [595.28, 841.89] : [841.89, 595.28];
    const m = 8 * MM, cw = (W - m * (cols + 1)) / cols, ch = (H - m * (rows + 1)) / rows;
    for (let i = 0; i < pages.length; i += o.n) {
      const sheet = out.addPage([W, H]);
      for (let k = 0; k < o.n && i + k < pages.length; k++) {
        const p = pages[i + k], c = k % cols, r = Math.floor(k / cols);
        const s = Math.min(cw / p.width, ch / p.height), w = p.width * s, h = p.height * s;
        const x = m + c * (cw + m) + (cw - w) / 2, y = H - m - (r + 1) * ch - r * m + (ch - h) / 2;
        sheet.drawPage(p, { x, y, width: w, height: h });
        if (o.border) sheet.drawRectangle({ x, y, width: w, height: h, borderColor: L.rgb(0.7, 0.7, 0.7), borderWidth: 0.5 });
      }
    }
    return [{ name: `${baseName(files[0].name)}_${o.n}par-feuille.pdf`, data: await out.save() }];
  },

  async watermark(files, o) {
    const L = await PDFLib();
    const doc = await loadLib(await readBytes(files[0]));
    const font = await doc.embedFont(L.StandardFonts.HelveticaBold);
    const [r, g, b] = [1, 3, 5].map(k => parseInt(o.color.slice(k, k + 2), 16) / 255);
    const text = o.text.replace(/[^\x20-\x7e -ÿ]/g, '?');
    for (const p of doc.getPages()) {
      const { width: W, height: H } = p.getSize();
      const tw = font.widthOfTextAtSize(text, o.size);
      const opt = { size: o.size, font, color: L.rgb(r, g, b), opacity: o.opacity };
      if (o.pos === 'center') {
        const a = Math.atan2(H, W);
        p.drawText(text, { ...opt, x: W / 2 - (tw / 2) * Math.cos(a) + (o.size / 3) * Math.sin(a), y: H / 2 - (tw / 2) * Math.sin(a) - (o.size / 3) * Math.cos(a), rotate: L.radians(a) });
      } else if (o.pos === 'tile') {
        for (let y = -H; y < H * 1.5; y += o.size * 4) for (let x = -W; x < W * 1.5; x += tw + o.size * 2) p.drawText(text, { ...opt, x, y, rotate: L.degrees(30) });
      } else p.drawText(text, { ...opt, x: (W - tw) / 2, y: o.pos === 'top' ? H - o.size - 20 : 20 });
    }
    return [{ name: baseName(files[0].name) + '_filigrane.pdf', data: await doc.save() }];
  },

  async numbers(files, o) {
    const L = await PDFLib();
    const doc = await loadLib(await readBytes(files[0]));
    const font = await doc.embedFont(L.StandardFonts.Helvetica);
    const pages = doc.getPages(), total = pages.length - (o.from - 1);
    pages.forEach((p, i) => {
      if (i < o.from - 1) return;
      const n = o.start + i - (o.from - 1);
      const t = o.fmt.replace('{n}', n).replace('{t}', total + o.start - 1);
      const { width: W, height: H } = p.getSize();
      const box = p.getCropBox();
      const tw = font.widthOfTextAtSize(t, o.size), m = 12 * MM;
      const x = box.x + (o.pos[1] === 'c' ? (box.width - tw) / 2 : o.pos[1] === 'r' ? box.width - tw - m : m);
      const y = box.y + (o.pos[0] === 'b' ? m * 0.8 : box.height - m * 0.8 - o.size);
      p.drawText(t, { x, y, size: o.size, font, color: L.rgb(0.25, 0.25, 0.25) });
    });
    return [{ name: baseName(files[0].name) + '_numerote.pdf', data: await doc.save() }];
  },

  async meta(files, o) {
    const doc = await loadLib(await readBytes(files[0]), { updateMetadata: false });
    if (o.wipe) { for (const k of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer']) doc[`set${k}`](k === 'Keywords' ? [] : ''); }
    else {
      doc.setTitle(o.title); doc.setAuthor(o.author); doc.setSubject(o.subject);
      doc.setKeywords(o.keywords.split(/[,;]\s*/).filter(Boolean)); doc.setCreator(o.creator);
    }
    return [{ name: files[0].name, data: await doc.save() }];
  },

  async form(files, o) {
    if (!o.values) throw err('Aucun champ à remplir.');
    const doc = await loadLib(await readBytes(files[0]));
    const form = doc.getForm();
    for (const [name, kind, v] of o.values) {
      try {
        if (kind === 'text') form.getTextField(name).setText(v);
        else if (kind === 'check') v ? form.getCheckBox(name).check() : form.getCheckBox(name).uncheck();
        else if (kind === 'select' && v) form.getDropdown(name).select(v);
        else if (kind === 'radio' && v) form.getRadioGroup(name).select(v);
      } catch (e) { console.warn(name, e); }
    }
    if (o.flatten) form.flatten();
    return [{ name: baseName(files[0].name) + '_rempli.pdf', data: await doc.save() }];
  },

  async flatten(files) {
    const doc = await loadLib(await readBytes(files[0]));
    try { doc.getForm().flatten(); } catch {}
    return [{ name: baseName(files[0].name) + '_aplati.pdf', data: await doc.save() }];
  },

  async blank(files, o) {
    const L = await PDFLib();
    const out = await L.PDFDocument.create();
    const dims = { a4: [595.28, 841.89], a4l: [841.89, 595.28], a5: [419.53, 595.28], letter: [612, 792] }[o.size];
    for (let i = 0; i < o.n; i++) drawPaper(L, out.addPage(dims), o.style);
    out.setTitle('Cahier de notes');
    return [{ name: `cahier_${o.style}.pdf`, data: await out.save() }];
  },

  async unlock(files, o, prog) {
    const bytes = await readBytes(files[0]);
    return [{ name: baseName(files[0].name) + '_deverrouille.pdf', data: await rasterize(bytes, 200, 0.88, prog, o.password) }];
  },

  async compare(files, o, prog) {
    const texts = [];
    for (const f of files) {
      const pdf = await openPdf(await readBytes(f));
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) { prog(`Lecture de ${f.name}, page ${i}…`); pages.push((await (await pdf.getPage(i)).getTextContent()).items.map(x => x.str || '').join(' ')); }
      texts.push(pages); pdf.destroy();
    }
    const n = Math.max(texts[0].length, texts[1].length);
    const box = el('div', { class: 'compare' });
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const a = (texts[0][i] || '').split(/\s+/).filter(Boolean), b = (texts[1][i] || '').split(/\s+/).filter(Boolean);
      const d = diffWords(a, b);
      if (!d.some(x => x[0] !== '=')) continue;
      changed++;
      box.append(el('h4', {}, 'Page ' + (i + 1)), el('p', { class: 'diff' }, d.map(([op, w]) => op === '=' ? w + ' ' : el(op === '+' ? 'ins' : 'del', {}, w + ' '))));
    }
    box.prepend(el('p', { class: 'muted' }, changed ? `${changed} page(s) avec des différences. En vert : ajouté dans « ${files[1].name} ». En rouge barré : supprimé.` : 'Aucune différence de texte trouvée.'));
    return { html: box };
  },
};

// --- Aides ------------------------------------------------------------------------
async function rasterize(bytes, dpi, quality, prog, password) {
  const L = await PDFLib();
  const pdf = await (await import('./pdf.js')).pdfjs.getDocument({ data: bytes.slice(0), password, isEvalSupported: false }).promise
    .catch((e) => { throw err(e?.name === 'PasswordException' ? 'Mot de passe incorrect.' : 'Ce PDF ne peut pas être lu.'); });
  const out = await L.PDFDocument.create();
  for (let i = 1; i <= pdf.numPages; i++) {
    prog?.(`Page ${i} / ${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const { canvas } = await renderPageToCanvas(page, dpi / 72);
    const img = await out.embedJpg(await canvasToBytes(canvas, 'image/jpeg', quality));
    const vp = page.getViewport({ scale: 1 });
    out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
    canvas.width = canvas.height = 0;
  }
  pdf.destroy();
  return await out.save({ useObjectStreams: true });
}

// Recompression des images JPEG (et, en mode fort, des images brutes) sans toucher au texte.
async function compressImages(bytes, level, prog) {
  const L = await PDFLib();
  const doc = await loadLib(bytes);
  if (level !== 'low') {
    const [maxDim, q] = level === 'rec' ? [1700, 0.62] : [1100, 0.45];
    const objs = doc.context.enumerateIndirectObjects();
    let k = 0;
    for (const [ref, obj] of objs) {
      if (!(obj instanceof L.PDFRawStream)) continue;
      const d = obj.dict;
      if (d.get(L.PDFName.of('Subtype'))?.toString() !== '/Image') continue;
      const filter = d.get(L.PDFName.of('Filter'));
      const fstr = filter ? filter.toString() : '';
      const W = d.get(L.PDFName.of('Width'))?.asNumber?.() || 0, H = d.get(L.PDFName.of('Height'))?.asNumber?.() || 0;
      if (W * H < 160 * 160) continue;
      if (d.get(L.PDFName.of('ImageMask'))?.toString() === 'true') continue;
      const cs = d.get(L.PDFName.of('ColorSpace'))?.toString() || '';
      try {
        let bm;
        if (/^\/DCTDecode$|^\[ ?\/DCTDecode ?\]$/.test(fstr.trim())) {
          if (cs.includes('CMYK') || d.get(L.PDFName.of('Decode'))) continue;
          bm = await createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' }));
        } else if (level === 'high' && /FlateDecode/.test(fstr) && !d.get(L.PDFName.of('SMask')) && (cs === '/DeviceRGB' || cs === '/DeviceGray') && d.get(L.PDFName.of('BitsPerComponent'))?.asNumber?.() === 8) {
          const raw = L.decodePDFRawStream(obj).decode();
          const ch = cs === '/DeviceRGB' ? 3 : 1;
          if (raw.length < W * H * ch) continue;
          const id = new ImageData(W, H);
          for (let p = 0, s = 0; p < W * H; p++, s += ch) { id.data[p * 4] = raw[s]; id.data[p * 4 + 1] = raw[s + (ch === 3 ? 1 : 0)]; id.data[p * 4 + 2] = raw[s + (ch === 3 ? 2 : 0)]; id.data[p * 4 + 3] = 255; }
          bm = await createImageBitmap(id);
        } else continue;
        const s = Math.min(1, maxDim / Math.max(bm.width, bm.height));
        const c = el('canvas', { width: Math.max(1, Math.round(bm.width * s)), height: Math.max(1, Math.round(bm.height * s)) });
        const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height); cx.drawImage(bm, 0, 0, c.width, c.height);
        const jpg = await canvasToBytes(c, 'image/jpeg', q);
        if (jpg.length >= obj.contents.length * 0.92) continue;
        const nd = doc.context.obj({});
        for (const [key, val] of d.entries()) {
          const ks = key.toString();
          if (['/Length', '/Width', '/Height', '/Filter', '/DecodeParms', '/ColorSpace', '/BitsPerComponent', '/Decode'].includes(ks)) continue;
          nd.set(key, val);
        }
        nd.set(L.PDFName.of('Width'), L.PDFNumber.of(c.width)); nd.set(L.PDFName.of('Height'), L.PDFNumber.of(c.height));
        nd.set(L.PDFName.of('ColorSpace'), L.PDFName.of('DeviceRGB')); nd.set(L.PDFName.of('BitsPerComponent'), L.PDFNumber.of(8));
        nd.set(L.PDFName.of('Filter'), L.PDFName.of('DCTDecode'));
        doc.context.assign(ref, L.PDFRawStream.of(nd, jpg));
        if (++k % 5 === 0) prog?.(`${k} images recompressées…`);
      } catch (e) { /* image ignorée */ }
    }
  }
  return await doc.save({ useObjectStreams: true });
}

// Boîte du contenu non blanc d'une page (coordonnées PDF, CropBox).
async function contentBox(page) {
  const scale = 0.6;
  const { canvas, viewport } = await renderPageToCanvas(page, scale, { rotation: 0 });
  const { width: w, height: h } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  canvas.width = canvas.height = 0;
  if (x1 < 0) return null;
  const [ax, ay] = viewport.convertToPdfPoint(x0, y1), [bx, by] = viewport.convertToPdfPoint(x1 + 1, y0);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

function diffWords(a, b) {
  if (a.length * b.length > 4e6) return [['-', a.join(' ')], ['+', b.join(' ')]];
  const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { out.push(['=', a[i]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(['-', a[i++]]); else out.push(['+', b[j++]]); }
  while (i < n) out.push(['-', a[i++]]); while (j < m) out.push(['+', b[j++]]);
  return out;
}

// --- OCR (Tesseract.js, chargé à la demande) -----------------------------------------
let tessP;
function loadTesseract() {
  if (!tessP) tessP = new Promise((res, rej) => {
    if (window.Tesseract) return res(window.Tesseract);
    const s = el('script', { src: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js' });
    s.onload = () => res(window.Tesseract); s.onerror = () => { tessP = null; rej(err('Impossible de charger le moteur OCR (connexion internet requise la première fois).')); };
    document.head.append(s);
  });
  return tessP;
}

export async function runOcr(bytes, name, o, prog) {
  const T = await loadTesseract();
  prog('Préparation du moteur OCR…');
  const worker = await T.createWorker(o.lang || 'fra', 1, { logger: (m) => m.status === 'recognizing text' && prog(`Reconnaissance… ${Math.round(m.progress * 100)} %`) });
  const L = await PDFLib();
  const doc = await loadLib(bytes);
  const font = await doc.embedFont(L.StandardFonts.Helvetica);
  const pdf = await openPdf(bytes);
  const idx = o.ranges?.trim() ? parseRanges(o.ranges, pdf.numPages) : Array.from({ length: pdf.numPages }, (_, i) => i);
  let allText = '';
  for (const i of idx) {
    prog(`Page ${i + 1} / ${pdf.numPages}…`);
    const page = await pdf.getPage(i + 1);
    const scale = 2.2;
    const { canvas, viewport } = await renderPageToCanvas(page, scale, { rotation: 0 });
    const { data } = await worker.recognize(canvas);
    allText += `\n\n——— Page ${i + 1} ———\n\n` + data.text;
    const p = doc.getPage(i);
    for (const w of data.words || []) {
      const t = w.text.replace(/[^\x20-\x7e -ÿ]/g, '');
      if (!t.trim()) continue;
      const [x0, y0] = viewport.convertToPdfPoint(w.bbox.x0, w.bbox.y1), [x1, y1] = viewport.convertToPdfPoint(w.bbox.x1, w.bbox.y0);
      const h = Math.abs(y1 - y0), wd = Math.abs(x1 - x0);
      let size = h * 0.95;
      const tw = font.widthOfTextAtSize(t, size);
      if (tw > 0) size = Math.min(size * 1.2, size * wd / tw);
      try { p.drawText(t, { x: Math.min(x0, x1), y: Math.min(y0, y1) + h * 0.15, size: Math.max(1, size), font, opacity: 0 }); } catch {}
    }
    canvas.width = canvas.height = 0;
  }
  await worker.terminate();
  pdf.destroy();
  return [
    { name: baseName(name) + '_ocr.pdf', data: await doc.save() },
    { name: baseName(name) + '_ocr.txt', data: new TextEncoder().encode(allText.trim()) },
  ];
}

// --- Organiseur visuel ----------------------------------------------------------------
async function openOrganizer(app, preset) {
  let file = preset?.[0];
  if (!file) { [file] = await pickFiles('application/pdf,.pdf'); if (!file) return; }
  const b = busy('Chargement des pages…');
  const bytes = await readBytes(file);
  let pdf;
  try { pdf = await openPdf(bytes); } catch { b.done(); toast('Ce PDF ne peut pas être lu.', 'error'); return; }
  const sources = [{ bytes, pdf }];
  let items = Array.from({ length: pdf.numPages }, (_, i) => ({ s: 0, i, rot: 0 }));
  const grid = el('div', { class: 'org-grid' });
  const thumbCache = new Map();
  const thumb = async (it) => {
    const key = it.s + ':' + it.i;
    if (it.s === -1) return null;
    if (!thumbCache.has(key)) thumbCache.set(key, (async () => {
      const { canvas } = await renderPageToCanvas(await sources[it.s].pdf.getPage(it.i + 1), 0.32);
      return canvas.toDataURL('image/jpeg', 0.7);
    })());
    return thumbCache.get(key);
  };
  let dragFrom = null;
  const render = () => {
    grid.innerHTML = '';
    items.forEach((it, k) => {
      const img = el('img', { draggable: false });
      if (it.s >= 0) thumb(it).then(u => (img.src = u)); else img.classList.add('blank-thumb');
      img.style.transform = `rotate(${it.rot}deg)`;
      const card = el('div', { class: 'org-card', draggable: true },
        el('div', { class: 'org-img' }, img),
        el('div', { class: 'org-bar' }, el('span', { class: 'small' }, String(k + 1)),
          btn('rotl', 'Pivoter à gauche', () => { it.rot = (it.rot + 270) % 360; render(); }, 'tiny'),
          btn('rotate', 'Pivoter à droite', () => { it.rot = (it.rot + 90) % 360; render(); }, 'tiny'),
          btn('copy', 'Dupliquer', () => { items.splice(k + 1, 0, { ...it }); render(); }, 'tiny'),
          btn('trash', 'Supprimer', () => { items.splice(k, 1); render(); }, 'tiny')));
      card.addEventListener('dragstart', () => { dragFrom = k; card.classList.add('drag'); });
      card.addEventListener('dragend', () => card.classList.remove('drag'));
      card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('over'); });
      card.addEventListener('dragleave', () => card.classList.remove('over'));
      card.addEventListener('drop', (e) => { e.preventDefault(); if (dragFrom == null || dragFrom === k) return; const [m] = items.splice(dragFrom, 1); items.splice(k, 0, m); dragFrom = null; render(); });
      grid.append(card);
    });
  };
  render();
  b.done();
  const addPdf = async () => {
    const [f] = await pickFiles('application/pdf,.pdf'); if (!f) return;
    const bb = await readBytes(f); const p = await openPdf(bb);
    sources.push({ bytes: bb, pdf: p });
    for (let i = 0; i < p.numPages; i++) items.push({ s: sources.length - 1, i, rot: 0 });
    render();
  };
  const addBlank = () => { items.push({ s: -1, i: 0, rot: 0 }); render(); };
  const save = async () => {
    const bz = busy('Création du PDF…');
    try {
      const L = await PDFLib();
      const libs = await Promise.all(sources.map(s => loadLib(s.bytes)));
      const out = await L.PDFDocument.create();
      for (const it of items) {
        if (it.s === -1) { out.addPage([595.28, 841.89]); continue; }
        const [p] = await out.copyPages(libs[it.s], [it.i]);
        if (it.rot) p.setRotation(L.degrees((p.getRotation().angle + it.rot) % 360));
        out.addPage(p);
      }
      const data = await out.save();
      bz.done();
      return { data, name: baseName(file.name) + '_organise.pdf' };
    } catch (e) { bz.done(); toast('Échec : ' + e.message, 'error'); return null; }
  };
  modal({ title: 'Organiser les pages', wide: true,
    body: el('div', {}, el('p', { class: 'muted' }, 'Glissez les pages pour les réordonner.'),
      el('div', { class: 'row' }, el('button', { class: 'btn small', onclick: addPdf }, icon('plus', 16), ' Ajouter un PDF'), el('button', { class: 'btn small', onclick: addBlank }, icon('blank', 16), ' Page blanche')),
      grid),
    onClose: () => sources.forEach(s => s.pdf.destroy()),
    actions: [
      { label: 'Ouvrir dans Folio', onClick: async () => { const r = await save(); if (r) app.openBytes(r.data, r.name); else return false; } },
      { label: 'Télécharger', primary: true, onClick: async () => { const r = await save(); if (r) downloadBlob(pdfBlob(r.data), r.name); return false; } },
    ] });
}
