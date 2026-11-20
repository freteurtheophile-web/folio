// Lecteur PDF : pages en défilement continu, zoom, rotation, miniatures, sommaire,
// recherche, signets, liens, sélection de texte.
import { pdfjs, openPdf, CSS_UNITS } from './pdf.js';
import { el, icon, btn, toast, promptBox, popMenu, $ } from './ui.js';
import { idb, patchRecent, getSettings, setSetting } from './store.js';
import { drawStroke } from './ink.js';
import { Annotator } from './annot.js';
import { extractFolioData } from './save.js';

const GAP = 14;
const MAX_PIXELS = 16_000_000;

export class DocView {
  constructor(app, src) {
    this.app = app;
    this.name = src.name;
    this.handle = src.handle || null;
    this.srcBytes = new Uint8Array(src.bytes);
    this.zoom = 1;
    this.rotation = 0;
    this.pageRot = [];
    this.ann = [];            // annotations par page
    this.pages = [];
    this.dirty = false;
    this.bookmarks = [];
    this.textIndex = null;
    this.readStart = Date.now();
    this.el = el('div', { class: 'docview' });
  }

  async open() {
    // Annotations Folio intégrées au fichier lors d'un enregistrement précédent ?
    let bytes = this.srcBytes, embedded = null;
    try {
      const r = await extractFolioData(bytes);
      if (r) { bytes = r.cleanBytes; embedded = r.data; }
    } catch (e) { console.warn('Lecture des annotations Folio impossible', e); }
    this.bytes = bytes;

    this.pdf = await openPdf(bytes, {
      onPassword: async (update, reason) => {
        const pw = await promptBox(reason === 2 ? 'Mot de passe incorrect' : 'Document protégé', 'Mot de passe du PDF');
        if (pw == null) { update(''); return; }
        this.password = pw; update(pw);
      },
    });
    this.key = this.pdf.fingerprints[0] + ':' + this.pdf.numPages;
    this.count = this.pdf.numPages;
    this.pageRot = embedded?.pageRot || new Array(this.count).fill(0);
    this.ann = Array.from({ length: this.count }, () => []);

    // Annotations : celles du fichier, sinon la sauvegarde automatique locale.
    const saved = await idb.get('annots', this.key);
    this.lastPage = (await idb.get('recents', this.key))?.lastPage;
    const src = embedded?.ann || saved?.ann;
    if (src) src.forEach((a, i) => { if (i < this.count) this.ann[i] = a; });
    if (embedded) this.bookmarks = embedded.bookmarks || [];
    else if (saved?.bookmarks) this.bookmarks = saved.bookmarks;

    // Dimensions de base de chaque page (pt).
    this.base = [];
    const first = await this.pdf.getPage(1);
    this.pageCache = new Map([[0, first]]);
    for (let i = 0; i < this.count; i++) {
      const p = i === 0 ? first : await this.getPage(i);
      const vp = p.getViewport({ scale: 1, rotation: 0 });
      this.base.push({ w: vp.width, h: vp.height, rot: p.rotate });
      if (i > 40 && i % 50 === 0) await new Promise(r => setTimeout(r));
    }
    this.buildUI();
    this.annotator = new Annotator(this);
    this.annotBarHost.append(this.annotator.bar);
    this.buildPages();
    requestAnimationFrame(() => {
      this.fitWidth(true);
      const last = this.lastPage;
      if (last && last < this.count) this.goto(last, false);
    });
    return this;
  }

  // Recharge après une opération sur les pages (suppression, insertion…).
  async reload(bytes, ann, pageRot) {
    const cur = this.current;
    this.annotator.clearSelection();
    this.annotator.undoStack = []; this.annotator.redoStack = [];
    for (const pg of this.pages) pg.task?.cancel();
    const old = this.pdf;
    this.bytes = bytes;
    this.pdf = await openPdf(bytes);
    old?.destroy();
    this.count = this.pdf.numPages;
    this.key = this.pdf.fingerprints[0] + ':' + this.count;
    this.pageCache = new Map();
    this.base = [];
    for (let i = 0; i < this.count; i++) {
      const p = await this.getPage(i);
      const vp = p.getViewport({ scale: 1, rotation: 0 });
      this.base.push({ w: vp.width, h: vp.height, rot: p.rotate });
    }
    this.ann = ann.slice(0, this.count);
    while (this.ann.length < this.count) this.ann.push([]);
    this.pageRot = pageRot.slice(0, this.count);
    this.bookmarks = this.bookmarks.filter(b => b.page < this.count);
    this.textIndex = null;
    this.annotator.objEls.clear();
    this.buildPages();
    this.countLabel.textContent = ' / ' + this.count;
    this.showSide(this.sideTab || 'pages', false);
    requestAnimationFrame(() => this.goto(Math.min(cur, this.count - 1)));
    this.markDirty();
    this.annotator.refreshBar();
  }

  async getPage(i) {
    if (this.pageCache.has(i)) return this.pageCache.get(i);
    const p = await this.pdf.getPage(i + 1);
    this.pageCache.set(i, p);
    return p;
  }

  rotOf(i) { return ((this.base[i].rot + (this.pageRot[i] || 0) + this.rotation) % 360 + 360) % 360; }
  sizeOf(i) {
    const b = this.base[i], r = this.rotOf(i), s = this.zoom * CSS_UNITS;
    const swap = r % 180 !== 0;
    return { w: (swap ? b.h : b.w) * s, h: (swap ? b.w : b.h) * s };
  }

  // --- Interface ---------------------------------------------------------
  buildUI() {
    this.annotBarHost = el('div', { class: 'annot-host' });
    this.pagesEl = el('div', { class: 'pages' + (getSettings().spread ? ' spread' : '') });
    this.scroller = el('div', { class: 'scroller', tabindex: 0 }, this.pagesEl);
    this.sidebar = this.buildSidebar();
    this.rpanel = el('aside', { class: 'rpanel' });
    this.status = this.buildStatus();
    this.el.append(this.annotBarHost,
      el('div', { class: 'doc-main' }, this.sidebar, this.scroller, this.rpanel),
      this.status);
    if (!getSettings().sidebar || innerWidth < 760) this.sidebar.classList.add('hidden');

    this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.scroller.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.zoomAt(this.zoom * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
      }
    }, { passive: false });
    this.setupPinch();
    document.addEventListener('selectionchange', this._sel = () => this.onSelectionChange());
    this.scroller.addEventListener('pointerup', () => setTimeout(() => this.onSelectionChange(true), 10));
  }

  buildStatus() {
    this.pageInput = el('input', { class: 'page-input', value: '1', inputmode: 'numeric',
      onchange: () => this.goto(Math.max(0, Math.min(this.count - 1, (parseInt(this.pageInput.value) || 1) - 1))) });
    this.zoomLabel = el('button', { class: 'zoom-label', title: 'Choisir le zoom', onclick: (e) => popMenu(e.currentTarget, [
      { label: 'Ajuster à la largeur', icon: 'fitw', onClick: () => this.fitWidth() },
      { label: 'Page entière', icon: 'fitp', onClick: () => this.fitPage() },
      '-', ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map(z => ({ label: Math.round(z * 100) + ' %', onClick: () => this.setZoom(z) })),
    ]) }, '100 %');
    this.bmBtn = btn('bookmark', 'Ajouter un signet sur cette page', () => this.toggleBookmark());
    this.countLabel = el('span', { class: 'muted' }, ' / ' + this.count);
    return el('div', { class: 'statusbar' },
      btn('sidebar', 'Afficher / masquer le panneau', () => { this.sidebar.classList.toggle('hidden'); setSetting('sidebar', !this.sidebar.classList.contains('hidden')); }),
      el('div', { class: 'grow' }),
      btn('chevl', 'Page précédente', () => this.goto(this.current - 1)),
      el('span', { class: 'pagebox' }, this.pageInput, this.countLabel),
      btn('chevr', 'Page suivante', () => this.goto(this.current + 1)),
      el('span', { class: 'sep' }),
      btn('zoomout', 'Zoom arrière', () => this.setZoom(this.zoom / 1.2)),
      this.zoomLabel,
      btn('zoomin', 'Zoom avant', () => this.setZoom(this.zoom * 1.2)),
      btn('fitw', 'Ajuster à la largeur', () => this.fitWidth()),
      btn('spread', 'Affichage deux pages', () => this.toggleSpread()),
      btn('rotate', 'Pivoter l\'affichage', () => this.rotateView(90)),
      el('span', { class: 'sep' }),
      this.bmBtn,
      el('div', { class: 'grow' }),
      el('span', { class: 'muted small doc-saved' }, ''));
  }

  buildSidebar() {
    const tabs = [
      ['pages', 'pages', 'Pages'], ['outline', 'list', 'Sommaire'], ['search', 'search', 'Rechercher'],
      ['notes', 'note', 'Annotations'], ['bookmarks', 'bookmark', 'Signets'],
    ];
    this.sideBody = el('div', { class: 'side-body' });
    const head = el('div', { class: 'side-tabs' }, tabs.map(([k, ic, t]) =>
      el('button', { class: 'side-tab', title: t, 'data-k': k, onclick: () => this.showSide(k) }, icon(ic, 18))));
    const side = el('aside', { class: 'sidebar' }, head, this.sideBody);
    setTimeout(() => this.showSide('pages', false));
    return side;
  }

  showSide(k, reveal = true) {
    this.sideTab = k;
    if (reveal) this.sidebar.classList.remove('hidden');
    for (const b of this.sidebar.querySelectorAll('.side-tab')) b.classList.toggle('on', b.dataset.k === k);
    this.sideBody.innerHTML = '';
    if (this.thumbObs) { this.thumbObs.disconnect(); this.thumbObs = null; }
    ({ pages: () => this.sideThumbs(), outline: () => this.sideOutline(), search: () => this.sideSearch(),
       notes: () => this.sideNotes(), bookmarks: () => this.sideBookmarks() })[k]();
  }

  sideThumbs() {
    const list = el('div', { class: 'thumbs' });
    this.thumbObs = new IntersectionObserver((ents) => {
      for (const en of ents) if (en.isIntersecting && !en.target.dataset.done) {
        en.target.dataset.done = 1; this.renderThumb(+en.target.dataset.i, en.target.querySelector('canvas'));
      }
    }, { root: this.sideBody, rootMargin: '300px' });
    for (let i = 0; i < this.count; i++) {
      const c = el('canvas');
      const t = el('div', { class: 'thumb' + (i === this.current ? ' on' : ''), 'data-i': i, draggable: true,
        onclick: () => { this.goto(i); if (innerWidth < 760) this.sidebar.classList.add('hidden'); },
        oncontextmenu: (e) => { e.preventDefault(); this.pageMenu(i, t); } },
        el('div', { class: 'thumb-c' }, c),
        el('div', { class: 'thumb-n' }, el('span', {}, String(i + 1)),
          btn('more', 'Actions sur la page', (e) => { e.stopPropagation(); this.pageMenu(i, e.currentTarget); }, 'tiny')));
      t.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/folio-page', String(i)); t.classList.add('drag'); });
      t.addEventListener('dragend', () => t.classList.remove('drag'));
      t.addEventListener('dragover', (e) => { e.preventDefault(); t.classList.add('over'); });
      t.addEventListener('dragleave', () => t.classList.remove('over'));
      t.addEventListener('drop', (e) => {
        e.preventDefault(); t.classList.remove('over');
        const from = parseInt(e.dataTransfer.getData('text/folio-page'));
        if (!isNaN(from) && from !== i) this.app.pageOps.move(this, from, i);
      });
      list.append(t);
      this.thumbObs.observe(t);
    }
    this.sideBody.append(list);
    this.thumbList = list;
  }

  async renderThumb(i, canvas) {
    const page = await this.getPage(i);
    const rot = this.rotOf(i);
    const vp0 = page.getViewport({ scale: 1, rotation: rot });
    const scale = 150 / vp0.width;
    const vp = page.getViewport({ scale: scale * (devicePixelRatio || 1), rotation: rot });
    canvas.width = vp.width; canvas.height = vp.height;
    canvas.style.width = '150px'; canvas.style.height = (vp.height / (devicePixelRatio || 1)) + 'px';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    try { await page.render({ canvasContext: ctx, viewport: vp }).promise; } catch { return; }
    ctx.save(); ctx.transform(...vp.transform);
    for (const a of this.ann[i]) if (a.type === 'ink') drawStroke(ctx, a);
    ctx.restore();
  }

  refreshThumb(i) {
    const t = this.thumbList?.querySelector(`.thumb[data-i="${i}"]`);
    if (t?.dataset.done) this.renderThumb(i, t.querySelector('canvas'));
  }

  pageMenu(i, anchor) {
    const ops = this.app.pageOps;
    popMenu(anchor, [
      { label: 'Pivoter à droite', icon: 'rotate', onClick: () => ops.rotate(this, [i], 90) },
      { label: 'Pivoter à gauche', icon: 'rotl', onClick: () => ops.rotate(this, [i], -90) },
      { label: 'Insérer une page de notes après', icon: 'blank', onClick: () => ops.insertBlank(this, i + 1) },
      { label: 'Insérer un PDF après…', icon: 'plus', onClick: () => ops.insertPdf(this, i + 1) },
      { label: 'Dupliquer la page', icon: 'copy', onClick: () => ops.duplicate(this, i) },
      { label: 'Extraire cette page', icon: 'download', onClick: () => ops.extract(this, [i]) },
      '-',
      { label: 'Supprimer la page', icon: 'trash', onClick: () => ops.remove(this, [i]) },
    ]);
  }

  async sideOutline() {
    const outline = await this.pdf.getOutline();
    if (!outline?.length) { this.sideBody.append(el('p', { class: 'empty' }, 'Ce document n\'a pas de sommaire.')); return; }
    const mk = (items) => el('ul', { class: 'outline' }, items.map(it => {
      const li = el('li', {}, el('button', { class: 'outline-item', onclick: () => this.gotoDest(it) }, it.title));
      if (it.items?.length) li.append(mk(it.items));
      return li;
    }));
    this.sideBody.append(mk(outline));
  }

  async gotoDest(it) {
    try {
      if (it.url) { window.open(it.url, '_blank', 'noopener'); return; }
      let dest = it.dest ?? it;
      if (typeof dest === 'string') dest = await this.pdf.getDestination(dest);
      if (!Array.isArray(dest)) return;
      const idx = typeof dest[0] === 'object' ? await this.pdf.getPageIndex(dest[0]) : dest[0];
      this.goto(idx);
    } catch (e) { console.warn(e); }
  }

  async buildTextIndex() {
    if (this.textIndex) return this.textIndex;
    const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const idx = [];
    for (let i = 0; i < this.count; i++) {
      const page = await this.getPage(i);
      const tc = await page.getTextContent();
      let text = '';
      const items = [];
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        items.push({ start: text.length, len: it.str.length });
        text += it.str + (it.hasEOL ? '\n' : ' ');
      }
      idx.push({ text, norm: norm(text), items });
    }
    this.textIndex = { pages: idx, norm };
    return this.textIndex;
  }

  async pageText(i) { const idx = await this.buildTextIndex(); return idx.pages[i]?.text || ''; }

  sideSearch() {
    const input = el('input', { class: 'input', placeholder: 'Rechercher dans le document…' });
    const res = el('div', { class: 'search-res' });
    const run = async () => {
      const q = input.value.trim();
      res.innerHTML = '';
      this.searchHits = [];
      this.clearSearchMarks();
      if (q.length < 2) return;
      res.append(el('p', { class: 'muted small' }, 'Recherche…'));
      const idx = await this.buildTextIndex();
      const nq = idx.norm(q);
      const hits = [];
      idx.pages.forEach((p, pi) => {
        let at = p.norm.indexOf(nq);
        while (at >= 0 && hits.length < 500) { hits.push({ page: pi, at, len: nq.length }); at = p.norm.indexOf(nq, at + nq.length); }
      });
      res.innerHTML = '';
      res.append(el('p', { class: 'muted small' }, hits.length ? `${hits.length} résultat${hits.length > 1 ? 's' : ''}` : 'Aucun résultat'));
      this.searchHits = hits;
      for (const h of hits.slice(0, 300)) {
        const t = idx.pages[h.page].text;
        const a = Math.max(0, h.at - 40), b = Math.min(t.length, h.at + h.len + 60);
        res.append(el('button', { class: 'hit', onclick: () => this.showHit(h) },
          el('span', { class: 'hit-p' }, 'p. ' + (h.page + 1)),
          el('span', {}, (a > 0 ? '…' : '') + t.slice(a, h.at), el('mark', {}, t.slice(h.at, h.at + h.len)), t.slice(h.at + h.len, b) + '…')));
      }
    };
    let tm; input.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(run, 280); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const h = this.searchHits?.[0]; if (h) this.showHit(h); } });
    this.sideBody.append(el('div', { class: 'side-pad' }, input), res);
    setTimeout(() => input.focus(), 20);
    this.searchInput = input;
  }

  clearSearchMarks() { for (const s of this.pagesEl.querySelectorAll('.textLayer .highlight')) s.classList.remove('highlight', 'selected'); }

  async showHit(h) {
    this.goto(h.page);
    const pg = this.pages[h.page];
    await this.renderPage(h.page);
    await pg.textReady;
    this.clearSearchMarks();
    const items = this.textIndex.pages[h.page].items;
    const spans = pg.textLayer.querySelectorAll('span:not(.markedContent)');
    let first = null;
    items.forEach((it, k) => {
      if (it.start < h.at + h.len && it.start + it.len > h.at && spans[k]) {
        spans[k].classList.add('highlight', 'selected'); first ??= spans[k];
      }
    });
    if (first) {
      const r = first.getBoundingClientRect(), sr = this.scroller.getBoundingClientRect();
      if (r.top < sr.top + 40 || r.bottom > sr.bottom - 40) this.scroller.scrollTop += r.top - sr.top - sr.height / 3;
    }
  }

  sideNotes() {
    const wrap = el('div', { class: 'side-pad notes-list' });
    const exportBtn = el('button', { class: 'btn small', onclick: () => this.app.study.exportSummary(this) }, icon('download', 16), ' Fiche de synthèse');
    wrap.append(el('div', { class: 'row' }, exportBtn));
    let n = 0;
    this.ann.forEach((list, pi) => list.forEach(a => {
      let label = null, sw = a.color;
      if (a.type === 'markup') label = a.text || '(sélection)';
      else if (a.type === 'text') label = a.text;
      else if (a.type === 'note') label = '🗒 ' + (a.text || '(note vide)');
      else if (a.type === 'image') label = a.kind === 'signature' ? 'Signature' : a.kind === 'stamp' ? 'Tampon' : 'Image';
      else if (a.type === 'ink') return;
      else if (a.type === 'shape') label = 'Forme';
      if (label == null) return;
      n++;
      wrap.append(el('button', { class: 'note-item', onclick: () => { this.goto(pi); this.annotator.select(pi, a.id); } },
        el('span', { class: 'sw', style: { background: sw || 'var(--muted)' } }),
        el('span', { class: 'note-t' }, label.length > 160 ? label.slice(0, 160) + '…' : label),
        el('span', { class: 'hit-p' }, 'p. ' + (pi + 1))));
    }));
    const inkCount = this.ann.reduce((s, l) => s + l.filter(a => a.type === 'ink').length, 0);
    if (!n) wrap.append(el('p', { class: 'empty' }, 'Aucune annotation texte pour l\'instant. Surlignez du texte ou ajoutez une note.'));
    if (inkCount) wrap.append(el('p', { class: 'muted small' }, `${inkCount} trait${inkCount > 1 ? 's' : ''} manuscrit${inkCount > 1 ? 's' : ''}.`));
    this.sideBody.append(wrap);
  }

  sideBookmarks() {
    const wrap = el('div', { class: 'side-pad' });
    wrap.append(el('button', { class: 'btn small', onclick: () => this.toggleBookmark() }, icon('bookmark', 16), ' Signet sur la page ' + (this.current + 1)));
    if (!this.bookmarks.length) wrap.append(el('p', { class: 'empty' }, 'Aucun signet. Ajoutez-en pour retrouver vos passages importants.'));
    for (const b of [...this.bookmarks].sort((a, b) => a.page - b.page)) {
      wrap.append(el('div', { class: 'note-item' },
        el('button', { class: 'linklike grow', onclick: () => this.goto(b.page) }, el('span', { class: 'hit-p' }, 'p. ' + (b.page + 1)), ' ', b.label || ''),
        btn('trash', 'Retirer', () => { this.bookmarks = this.bookmarks.filter(x => x !== b); this.saveLocal(); this.showSide('bookmarks'); this.updateBm(); }, 'tiny')));
    }
    this.sideBody.append(wrap);
  }

  async toggleBookmark() {
    const ex = this.bookmarks.find(b => b.page === this.current);
    if (ex) this.bookmarks = this.bookmarks.filter(b => b !== ex);
    else {
      const label = await promptBox('Nouveau signet', 'Nom du signet (facultatif)', '');
      if (label === null) return;
      this.bookmarks.push({ page: this.current, label });
    }
    this.saveLocal(); this.updateBm();
    if (this.sideTab === 'bookmarks') this.showSide('bookmarks');
  }
  updateBm() { this.bmBtn.classList.toggle('on', this.bookmarks.some(b => b.page === this.current)); }

  // --- Pages ---------------------------------------------------------------
  buildPages() {
    this.pagesEl.innerHTML = '';
    this.pages = [];
    this.io?.disconnect();
    this.io = new IntersectionObserver((ents) => {
      for (const en of ents) {
        const i = +en.target.dataset.i;
        this.pages[i].visible = en.isIntersecting;
        if (en.isIntersecting) this.renderPage(i);
      }
      this.scheduleCleanup();
    }, { root: this.scroller, rootMargin: '120% 0px' });

    for (let i = 0; i < this.count; i++) {
      const d = el('div', { class: 'page', 'data-i': i });
      const pdfC = el('canvas', { class: 'pdf' });
      const hl = el('canvas', { class: 'hl' });
      const ink = el('canvas', { class: 'ink' });
      const tl = el('div', { class: 'textLayer' });
      const obj = el('div', { class: 'objLayer' });
      const live = el('canvas', { class: 'live' });
      d.append(pdfC, hl, ink, tl, obj, live);
      this.pagesEl.append(d);
      const pg = { i, div: d, pdfC, hl, ink, textLayer: tl, obj, live, rendered: 0, visible: false };
      this.pages.push(pg);
      this.layoutPage(i);
      this.io.observe(d);
    }
    this.current = 0;
    this.annotator?.attachPages();
  }

  layoutPage(i) {
    const { w, h } = this.sizeOf(i);
    const pg = this.pages[i];
    pg.div.style.width = w + 'px';
    pg.div.style.height = h + 'px';
    pg.div.style.setProperty('--scale-factor', this.zoom * CSS_UNITS);
    pg.cssW = w; pg.cssH = h;
  }

  viewport(i) {
    const page = this.pageCache.get(i);
    if (!page) return null;
    return page.getViewport({ scale: this.zoom * CSS_UNITS, rotation: this.rotOf(i) });
  }

  async renderPage(i, force = false) {
    const pg = this.pages[i];
    if (!pg) return;
    const key = this.zoom + ':' + this.rotOf(i);
    if (!force && pg.rendered === key) return pg.renderP;
    pg.rendered = key;
    const page = await this.getPage(i);
    const vp = page.getViewport({ scale: this.zoom * CSS_UNITS, rotation: this.rotOf(i) });
    pg.vp = vp;
    let dpr = devicePixelRatio || 1;
    if (vp.width * vp.height * dpr * dpr > MAX_PIXELS) dpr = Math.sqrt(MAX_PIXELS / (vp.width * vp.height));
    pg.dpr = dpr;
    const W = Math.floor(vp.width * dpr), H = Math.floor(vp.height * dpr);

    // Rendu hors écran puis échange, pour éviter le clignotement pendant le zoom.
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const ctx = off.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    pg.task?.cancel();
    const task = page.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS });
    pg.task = task;
    pg.renderP = task.promise.then(() => {
      if (pg.rendered !== key) return;
      pg.pdfC.width = W; pg.pdfC.height = H;
      pg.pdfC.getContext('2d').drawImage(off, 0, 0);
      off.width = off.height = 0;
    }).catch(() => {});

    for (const c of [pg.hl, pg.ink, pg.live]) { c.width = W; c.height = H; }
    this.drawAnnots(i);

    // Couche texte (une seule fois par rotation : elle suit --scale-factor).
    const trot = this.rotOf(i);
    if (pg.textRot !== trot) {
      pg.textRot = trot;
      pg.textLayer.innerHTML = '';
      const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent({ includeMarkedContent: true }), container: pg.textLayer, viewport: vp });
      pg.textReady = tl.render().then(() => pg.textLayer.append(el('div', { class: 'endOfContent' }))).catch(() => {});
      this.renderLinks(i, page, vp);
    } else this.renderLinks(i, page, vp);
    return pg.renderP;
  }

  async renderLinks(i, page, vp) {
    const pg = this.pages[i];
    pg.obj.querySelectorAll('.link').forEach(n => n.remove());
    let annots;
    try { annots = await page.getAnnotations({ intent: 'display' }); } catch { return; }
    for (const a of annots) {
      if (a.subtype !== 'Link') continue;
      const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
      const l = el('a', { class: 'link', style: { left: Math.min(x1, x2) + 'px', top: Math.min(y1, y2) + 'px', width: Math.abs(x2 - x1) + 'px', height: Math.abs(y2 - y1) + 'px' } });
      if (a.url) { l.href = a.url; l.target = '_blank'; l.rel = 'noopener'; l.title = a.url; }
      else if (a.dest) l.addEventListener('click', (e) => { e.preventDefault(); this.gotoDest({ dest: a.dest }); });
      else continue;
      pg.obj.prepend(l);
    }
  }

  drawAnnots(i) {
    const pg = this.pages[i];
    if (!pg?.vp || !pg.ink.width) return;
    const sel = this.annotator?.selection;
    for (const [c, layer] of [[pg.hl, 'hl'], [pg.ink, 'ink']]) {
      const ctx = c.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(pg.dpr, 0, 0, pg.dpr, 0, 0);
      ctx.transform(...pg.vp.transform);
      for (const a of this.ann[i]) {
        const isHl = (a.type === 'ink' && a.pen === 'fluo') || (a.type === 'markup' && a.kind === 'highlight');
        if ((layer === 'hl') !== isHl) continue;
        const selected = sel?.page === i && sel.ids.has(a.id);
        this.annotator.drawOne(ctx, a, selected, pg);
      }
    }
    this.annotator?.syncObjects(i);
  }

  scheduleCleanup() {
    clearTimeout(this._clean);
    this._clean = setTimeout(() => {
      const cur = this.current ?? 0;
      for (const pg of this.pages) {
        if (!pg.visible && pg.rendered && Math.abs(pg.i - cur) > 6) {
          pg.task?.cancel();
          for (const c of [pg.pdfC, pg.hl, pg.ink, pg.live]) { c.width = c.height = 0; }
          pg.rendered = 0;
        }
      }
    }, 500);
  }

  relayout(keepPage = true) {
    const cur = this.current;
    const frac = this.pageFrac();
    for (let i = 0; i < this.count; i++) this.layoutPage(i);
    if (keepPage) this.goto(cur, false, frac);
    clearTimeout(this._rr);
    this._rr = setTimeout(() => { for (const pg of this.pages) if (pg.visible) this.renderPage(pg.i); }, 140);
  }

  pageFrac() {
    const pg = this.pages[this.current];
    if (!pg) return 0;
    return Math.max(0, (this.scroller.scrollTop - pg.div.offsetTop) / pg.div.offsetHeight);
  }

  // --- Navigation & zoom ---------------------------------------------------
  goto(i, smooth = false, frac = 0) {
    i = Math.max(0, Math.min(this.count - 1, i));
    const pg = this.pages[i];
    if (!pg) return;
    this.scroller.scrollTo({ top: pg.div.offsetTop - GAP + frac * pg.div.offsetHeight, behavior: smooth ? 'smooth' : 'auto' });
    this.setCurrent(i);
  }

  setCurrent(i) {
    if (this.current === i && this.pageInput.value == i + 1) return;
    this.current = i;
    if (document.activeElement !== this.pageInput) this.pageInput.value = i + 1;
    this.updateBm();
    this.thumbList?.querySelectorAll('.thumb.on').forEach(t => t.classList.remove('on'));
    const t = this.thumbList?.querySelector(`.thumb[data-i="${i}"]`);
    if (t) { t.classList.add('on'); const r = t.getBoundingClientRect(), sr = this.sideBody.getBoundingClientRect(); if (r.top < sr.top || r.bottom > sr.bottom) t.scrollIntoView({ block: 'nearest' }); }
    clearTimeout(this._lp);
    this._lp = setTimeout(() => this.app.recentKey && patchRecent(this.app.recentKey(this), { lastPage: i }), 800);
  }

  onScroll() {
    const mid = this.scroller.scrollTop + this.scroller.clientHeight * 0.35;
    let lo = 0, hi = this.count - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.pages[m].div.offsetTop <= mid) lo = m; else hi = m - 1; }
    this.setCurrent(lo);
    this.hideSelPop();
  }

  setZoom(z, anchor) {
    const r = this.scroller.getBoundingClientRect();
    this.zoomAt(z, anchor?.x ?? r.left + r.width / 2, anchor?.y ?? r.top + r.height / 2);
  }

  zoomAt(z, cx, cy) {
    z = Math.max(0.2, Math.min(6, z));
    if (Math.abs(z - this.zoom) < 1e-3) return;
    const r = this.scroller.getBoundingClientRect();
    const ax = cx - r.left, ay = cy - r.top;
    const ox = this.scroller.scrollLeft + ax, oy = this.scroller.scrollTop + ay;
    const k = z / this.zoom;
    this.zoom = z;
    for (let i = 0; i < this.count; i++) this.layoutPage(i);
    this.scroller.scrollLeft = ox * k - ax;
    this.scroller.scrollTop = oy * k - ay;
    this.zoomLabel.textContent = Math.round(z * 100) + ' %';
    clearTimeout(this._rr);
    this._rr = setTimeout(() => { for (const pg of this.pages) if (pg.visible) this.renderPage(pg.i); this.annotator?.refreshObjects(); }, 160);
    this.annotator?.refreshObjects();
  }

  fitWidth(initial = false) {
    const maxW = Math.max(...this.base.map((b, i) => (this.rotOf(i) % 180 ? b.h : b.w)));
    const avail = this.scroller.clientWidth - 48;
    const spread = this.pagesEl.classList.contains('spread');
    const z = (spread ? (avail - GAP) / 2 : avail) / (maxW * CSS_UNITS);
    const zz = Math.max(0.2, Math.min(initial ? 2 : 6, z));
    if (initial) { this.zoom = zz; this.relayout(false); this.zoomLabel.textContent = Math.round(zz * 100) + ' %'; }
    else this.setZoom(zz);
  }

  fitPage() {
    const b = this.base[this.current], swap = this.rotOf(this.current) % 180;
    const w = (swap ? b.h : b.w) * CSS_UNITS, h = (swap ? b.w : b.h) * CSS_UNITS;
    const z = Math.min((this.scroller.clientWidth - 48) / w, (this.scroller.clientHeight - 2 * GAP) / h);
    this.setZoom(z);
    setTimeout(() => this.goto(this.current), 30);
  }

  toggleSpread() {
    const on = !this.pagesEl.classList.contains('spread');
    this.pagesEl.classList.toggle('spread', on);
    setSetting('spread', on);
    this.fitWidth();
    setTimeout(() => this.goto(this.current), 50);
  }

  rotateView(d) {
    this.rotation = (this.rotation + d + 360) % 360;
    for (const pg of this.pages) pg.rendered = 0;
    this.relayout();
  }

  // Pincer pour zoomer (écran tactile).
  setupPinch() {
    const pts = new Map();
    let start = null;
    this.scroller.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        start = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.zoom };
        this.pinching = true;
      }
    });
    this.scroller.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && start) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoomAt(start.z * d / start.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
    });
    const end = (e) => { pts.delete(e.pointerId); if (pts.size < 2) { start = null; setTimeout(() => (this.pinching = false), 50); } };
    this.scroller.addEventListener('pointerup', end);
    this.scroller.addEventListener('pointercancel', end);
  }

  // --- Sélection de texte au doigt / au stylet ---------------------------------
  // Stylet : glisser sur le texte sélectionne. Doigt : glisser fait défiler, un appui
  // long sélectionne le mot, puis glisser étend la sélection. Aucun menu système.
  caretAt(x, y) {
    const p = document.caretPositionFromPoint?.(x, y);
    const c = p ? { node: p.offsetNode, off: p.offset } : (() => { const r = document.caretRangeFromPoint?.(x, y); return r && { node: r.startContainer, off: r.startOffset }; })();
    return c && c.node?.nodeType === 3 && c.node.parentElement?.closest('.textLayer') && this.pagesEl.contains(c.node) ? c : null;
  }

  wordAt(c) {
    const t = c.node.data, isW = (ch) => /[\p{L}\p{N}'’\-]/u.test(ch);
    let a = c.off, b = c.off;
    if (!isW(t[a] || '') && a > 0 && isW(t[a - 1])) a = b = a - 1;
    if (!isW(t[a] || '')) return null;
    while (a > 0 && isW(t[a - 1])) a--;
    while (b < t.length && isW(t[b])) b++;
    return { node: c.node, a, b };
  }

  startTextSel(e) {
    const sel = document.getSelection(), sc = this.scroller;
    if (this._tsel) { this._tsel.cancel(); return; } // deuxième doigt : on laisse le zoom au pincement
    const pen = e.pointerType === 'pen';
    const st = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, mode: 'wait', anchor: null, word: null, vx: 0, vy: 0, t: performance.now() };
    this._tsel = st;
    this.hideSelPop();
    try { e.target.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();

    if (pen) {
      st.anchor = this.caretAt(e.clientX, e.clientY);
      st.mode = st.anchor ? 'drag' : 'pan';
      sel.removeAllRanges();
    } else {
      st.timer = setTimeout(() => {
        if (st.mode !== 'wait') return;
        const c = this.caretAt(st.x0, st.y0), w = c && this.wordAt(c);
        if (!w) { st.mode = 'pan'; return; }
        st.mode = 'word'; st.word = w;
        sel.setBaseAndExtent(w.node, w.a, w.node, w.b);
        if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(12);
      }, 450);
    }

    const before = (n1, o1, n2, o2) => { // (n1,o1) est-il avant (n2,o2) ?
      if (n1 === n2) return o1 < o2;
      return !!(n1.compareDocumentPosition(n2) & Node.DOCUMENT_POSITION_FOLLOWING);
    };
    const move = (ev) => {
      if (ev.pointerId !== st.id) return;
      if (this.pinching) { st.cancel(); return; }
      const dx = ev.clientX - st.x, dy = ev.clientY - st.y, now = performance.now(), dt = Math.max(1, now - st.t);
      st.x = ev.clientX; st.y = ev.clientY; st.t = now;
      if (st.mode === 'wait' && Math.hypot(st.x - st.x0, st.y - st.y0) > 10) { st.mode = 'pan'; clearTimeout(st.timer); }
      if (st.mode === 'pan') {
        sc.scrollLeft -= dx; sc.scrollTop -= dy;
        st.vx = 0.8 * (dx / dt) + 0.2 * st.vx; st.vy = 0.8 * (dy / dt) + 0.2 * st.vy;
      } else if (st.mode === 'drag' || st.mode === 'word') {
        const f = this.caretAt(ev.clientX, ev.clientY);
        if (f) {
          if (st.mode === 'drag') {
            // Au stylet, la sélection s'aligne sur des mots entiers.
            const fwd = !before(f.node, f.off, st.anchor.node, st.anchor.off);
            const wa = this.wordAt(st.anchor), wf = this.wordAt(f);
            const a = wa ? { node: wa.node, off: fwd ? wa.a : wa.b } : st.anchor;
            const b = wf ? { node: wf.node, off: fwd ? wf.b : wf.a } : f;
            sel.setBaseAndExtent(a.node, a.off, b.node, b.off);
          }
          else {
            const w = st.word, wf = this.wordAt(f);
            if (before(f.node, f.off, w.node, w.a)) sel.setBaseAndExtent(w.node, w.b, f.node, wf ? wf.a : f.off);
            else if (before(w.node, w.b, f.node, f.off)) sel.setBaseAndExtent(w.node, w.a, f.node, wf ? wf.b : f.off);
            else sel.setBaseAndExtent(w.node, w.a, w.node, w.b);
          }
        }
        // Défilement automatique près des bords.
        const r = sc.getBoundingClientRect();
        if (ev.clientY < r.top + 40) sc.scrollTop -= 12; else if (ev.clientY > r.bottom - 40) sc.scrollTop += 12;
      }
    };
    const finish = () => {
      clearTimeout(st.timer);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (this._tsel === st) this._tsel = null;
    };
    st.cancel = () => { st.mode = 'none'; finish(); };
    const up = (ev) => {
      if (ev.pointerId !== st.id) return;
      const mode = st.mode;
      finish();
      if (mode === 'drag' || mode === 'word') { setTimeout(() => this.onSelectionChange(true), 0); return; }
      if (mode === 'wait') { sel.removeAllRanges(); this.hideSelPop(); return; } // simple toucher
      if (mode === 'pan' && Math.hypot(st.vx, st.vy) > 0.2 && performance.now() - st.t < 80) {
        // Inertie du défilement.
        let vx = st.vx * 16, vy = st.vy * 16;
        const step = () => {
          if (this._tsel || Math.hypot(vx, vy) < 0.5) return;
          sc.scrollLeft -= vx; sc.scrollTop -= vy; vx *= 0.95; vy *= 0.95;
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }

  // --- Sélection de texte --------------------------------------------------
  onSelectionChange(fromUp = false) {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { if (!fromUp) this.hideSelPop(); return; }
    const range = sel.getRangeAt(0);
    if (!this.pagesEl.contains(range.commonAncestorContainer)) return;
    if (!fromUp) return; // on attend la fin de la sélection
    const text = sel.toString().trim();
    if (!text) return;
    const rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1);
    if (!rects.length) return;
    this.showSelPop(text, rects);
  }

  showSelPop(text, rects) {
    this.hideSelPop();
    const ann = this.annotator, app = this.app;
    const colors = ['#ffe14d', '#9cf26b', '#61d4ff', '#ff8fd1', '#ffb347'];
    const pop = el('div', { class: 'selpop' },
      ...colors.map(c => el('button', { class: 'dot', style: { background: c }, title: 'Surligner',
        onmousedown: (e) => e.preventDefault(), onclick: () => { ann.markupFromRects('highlight', c, rects, text); this.clearSel(); } })),
      el('span', { class: 'sep' }),
      btn('underline', 'Souligner', () => { ann.markupFromRects('underline', '#d0342c', rects, text); this.clearSel(); }),
      btn('strike', 'Barrer', () => { ann.markupFromRects('strike', '#d0342c', rects, text); this.clearSel(); }),
      btn('note', 'Commenter', () => { ann.markupFromRects('highlight', '#ffe14d', rects, text, true); this.clearSel(); }),
      el('span', { class: 'sep' }),
      btn('copy', 'Copier', () => { navigator.clipboard.writeText(text); toast('Texte copié'); this.clearSel(); }),
      btn('translate', 'Traduire', () => { app.lookup.translate(this, text); }),
      btn('book', 'Définition', () => { app.lookup.define(this, text); }),
      btn('roots', 'Étymologie', () => { app.lookup.etymology(this, text); }),
      btn('speak', 'Lire à voix haute', () => app.lookup.speak(text)),
      btn('sparkle', 'Expliquer (IA)', () => app.lookup.explain(this, text)),
      btn('search', 'Rechercher dans le document', () => { this.showSide('search'); this.searchInput.value = text; this.searchInput.dispatchEvent(new Event('input')); }));
    pop.querySelectorAll('button').forEach(b => b.addEventListener('mousedown', (e) => e.preventDefault()));
    document.body.append(pop);
    const last = rects[rects.length - 1], first = rects[0];
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let top = first.top - ph - 8;
    if (top < 60) top = last.bottom + 8;
    pop.style.left = Math.max(8, Math.min(innerWidth - pw - 8, first.left)) + 'px';
    pop.style.top = top + 'px';
    this.selPop = pop;
  }

  hideSelPop() { this.selPop?.remove(); this.selPop = null; }
  clearSel() { document.getSelection()?.removeAllRanges(); this.hideSelPop(); }

  // --- État ----------------------------------------------------------------
  markDirty(pages) {
    this.dirty = true;
    this.app.updateTabs();
    for (const i of pages || []) this.refreshThumb(i);
    if (this.sideTab === 'notes') { clearTimeout(this._sn); this._sn = setTimeout(() => this.showSide('notes'), 300); }
    this.saveLocal();
  }

  saveLocal() {
    clearTimeout(this._sl);
    this._sl = setTimeout(async () => {
      await idb.set('annots', this.key, { ann: this.ann, bookmarks: this.bookmarks, at: Date.now() });
      const s = this.status.querySelector('.doc-saved');
      if (s) s.textContent = 'Annotations conservées sur cet appareil';
    }, 600);
  }

  destroy() {
    document.removeEventListener('selectionchange', this._sel);
    this.hideSelPop();
    this.io?.disconnect();
    this.thumbObs?.disconnect();
    this.annotator?.destroy();
    const ms = Date.now() - this.readStart;
    this.app.recentKey && this.app.addReadTime?.(this, ms);
    this.pdf?.destroy();
    this.el.remove();
  }
}
