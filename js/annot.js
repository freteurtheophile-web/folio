// Annotateur : barre d'outils, saisie au stylet / souris / doigt, objets (texte, notes,
// formes, images, signatures), sélection au lasso, gomme, annuler / rétablir.
import { el, icon, btn, popMenu, toast } from './ui.js';
import { getSettings, setSetting } from './store.js';
import {
  PENS, PEN_ORDER, SWATCHES, newId, drawStroke, strokeHit, eraseFromStroke, strokeInPoly,
  pointInPoly, translateStroke, mapPressure, tiltOf, simplify, strokeBBox, invalidate, coalesced,
} from './ink.js';

const DRAW_TOOLS = new Set(['pen', 'eraser', 'lasso', 'laser', 'text', 'note', 'shape', 'stamp', 'hand']);
const clone = (o) => structuredClone(o);

export class Annotator {
  constructor(view) {
    this.view = view;
    this.tool = 'select';
    this.pen = 'bic';
    const saved = getSettings().penPresets || {};
    this.penCfg = {};
    for (const k of PEN_ORDER) this.penCfg[k] = { color: PENS[k].color, width: PENS[k].width, opacity: PENS[k].opacity, ...(saved[k] || {}) };
    this.shapeKind = 'rect';
    this.shapeCfg = { color: '#c0392b', width: 1.5 };
    this.textCfg = { color: '#1b1b1b', size: 12, font: 'Helvetica', bold: false, bg: '' };
    this.eraserMode = 'stroke';
    this.eraserSize = 10;
    this.undoStack = []; this.redoStack = [];
    this.selection = null;
    this.objEls = new Map();
    this.lastPenAt = 0;
    this.bar = this.buildBar();
    this.view.el.classList.add('tool-select');
    this.bindPointer();
  }

  // --- Barre d'outils -------------------------------------------------------
  buildBar() {
    const mk = (tool, ic, title, extra) => {
      const b = el('button', { class: 'tbtn', title, 'data-tool': tool, onclick: () => this.setTool(tool, extra) }, icon(ic));
      return b;
    };
    this.penBtns = PEN_ORDER.map(k => {
      const b = el('button', { class: 'tbtn pen', title: PENS[k].label + ' (double-clic : réglages)', 'data-tool': 'pen', 'data-pen': k,
        onclick: () => { if (this.tool === 'pen' && this.pen === k) this.openPenPanel(b); else this.setTool('pen', k); } },
        icon(PENS[k].icon), el('span', { class: 'pen-dot' }));
      b.addEventListener('dblclick', () => this.openPenPanel(b));
      return b;
    });
    this.shapeBtn = el('button', { class: 'tbtn', title: 'Formes', 'data-tool': 'shape', onclick: (e) => popMenu(e.currentTarget, [
      { label: 'Rectangle', icon: 'rect', onClick: () => this.setTool('shape', 'rect') },
      { label: 'Ellipse', icon: 'ellipse', onClick: () => this.setTool('shape', 'ellipse') },
      { label: 'Ligne', icon: 'line', onClick: () => this.setTool('shape', 'line') },
      { label: 'Flèche', icon: 'arrow', onClick: () => this.setTool('shape', 'arrow') },
    ]) }, icon('shapes'));
    this.eraserBtn = el('button', { class: 'tbtn', title: 'Gomme (cliquer à nouveau : options)', 'data-tool': 'eraser', onclick: (e) => {
      if (this.tool === 'eraser') popMenu(e.currentTarget, [
        { label: (this.eraserMode === 'stroke' ? '✓ ' : '') + 'Gommer le trait entier', icon: 'eraser', onClick: () => (this.eraserMode = 'stroke') },
        { label: (this.eraserMode === 'precise' ? '✓ ' : '') + 'Gomme précise', icon: 'eraser', onClick: () => (this.eraserMode = 'precise') },
        '-', ...[6, 10, 20, 40].map(s => ({ label: `Taille ${s}${this.eraserSize === s ? ' ✓' : ''}`, onClick: () => (this.eraserSize = s) })),
        '-', { label: 'Effacer toutes les annotations de la page', icon: 'trash', onClick: () => this.clearPage(this.view.current) },
      ]);
      else this.setTool('eraser');
    } }, icon('eraser'));

    this.opts = el('div', { class: 'tool-opts' });
    this.undoBtn = btn('undo', 'Annuler (Ctrl+Z)', () => this.undo());
    this.redoBtn = btn('redo', 'Rétablir (Ctrl+Y)', () => this.redo());
    const bar = el('div', { class: 'annot-bar' },
      el('div', { class: 'tgroup' }, mk('select', 'cursor', 'Sélection et texte (V)'), mk('hand', 'hand', 'Main : déplacer la page (H)')),
      el('div', { class: 'tgroup pens' }, this.penBtns),
      el('div', { class: 'tgroup' }, this.eraserBtn, mk('lasso', 'lasso', 'Lasso : sélectionner des traits (L)'), mk('laser', 'laser', 'Pointeur laser')),
      el('div', { class: 'tgroup' }, mk('text', 'textbox', 'Zone de texte (T)'), mk('note', 'note', 'Note (N)'), this.shapeBtn,
        el('button', { class: 'tbtn', title: 'Signature ou tampon', 'data-tool': 'stamp', onclick: () => this.view.app.signs.pick((s) => this.armStamp(s)) }, icon('sign')),
        el('button', { class: 'tbtn', title: 'Insérer une image', onclick: () => this.pickImage() }, icon('image'))),
      el('div', { class: 'tgroup' }, this.undoBtn, this.redoBtn),
      this.opts);
    this.barEl = bar;
    this.refreshBar();
    return bar;
  }

  refreshBar() {
    for (const b of this.barEl.querySelectorAll('.tbtn[data-tool]')) {
      const on = b.dataset.tool === this.tool && (!b.dataset.pen || b.dataset.pen === this.pen);
      b.classList.toggle('on', on);
    }
    for (const b of this.penBtns) {
      const c = this.penCfg[b.dataset.pen];
      b.querySelector('.pen-dot').style.background = c.color;
    }
    this.undoBtn.disabled = !this.undoStack.length;
    this.redoBtn.disabled = !this.redoStack.length;
    this.renderOpts();
  }

  renderOpts() {
    const o = this.opts; o.innerHTML = '';
    if (this.tool === 'pen') {
      const cfg = this.penCfg[this.pen];
      const sw = this.pen === 'fluo' ? SWATCHES.fluo : SWATCHES.ink;
      o.append(...sw.map(c => el('button', { class: 'swatch' + (cfg.color === c ? ' on' : ''), style: { background: c }, title: c,
        onclick: () => { cfg.color = c; this.savePens(); this.refreshBar(); } })));
      const ci = el('input', { type: 'color', class: 'colorpick', value: cfg.color, title: 'Autre couleur',
        oninput: () => { cfg.color = ci.value; this.savePens(); this.refreshBar(); } });
      o.append(ci, this.widthSlider(cfg));
    } else if (this.tool === 'shape') {
      o.append(...SWATCHES.ink.slice(0, 7).map(c => el('button', { class: 'swatch' + (this.shapeCfg.color === c ? ' on' : ''), style: { background: c },
        onclick: () => { this.shapeCfg.color = c; this.renderOpts(); } })), this.widthSlider(this.shapeCfg));
    } else if (this.tool === 'text') {
      o.append(el('span', { class: 'muted small' }, 'Cliquez sur la page pour écrire'));
    } else if (this.tool === 'eraser') {
      o.append(el('span', { class: 'muted small' }, this.eraserMode === 'stroke' ? 'Gomme : trait entier' : 'Gomme précise'));
    } else if (this.tool === 'stamp' && this.pendingStamp) {
      o.append(el('span', { class: 'muted small' }, 'Cliquez sur la page pour placer'), el('img', { class: 'stamp-prev', src: this.pendingStamp.src }));
    }
  }

  widthSlider(cfg) {
    const toS = (w) => Math.log(w / 0.3) / Math.log(120);
    const fromS = (s) => +(0.3 * Math.pow(120, s)).toFixed(2);
    const label = el('span', { class: 'wlabel' }, cfg.width.toFixed(1) + ' pt');
    const r = el('input', { type: 'range', min: 0, max: 1, step: 0.005, value: toS(cfg.width), class: 'wslider', title: 'Épaisseur',
      oninput: () => { cfg.width = fromS(+r.value); label.textContent = cfg.width.toFixed(1) + ' pt'; this.savePens(); } });
    return el('span', { class: 'wbox' }, r, label);
  }

  openPenPanel(anchor) {
    const cfg = this.penCfg[this.pen], s = getSettings();
    document.querySelector('.pen-panel')?.remove();
    const op = el('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: cfg.opacity,
      oninput: () => { cfg.opacity = +op.value; this.savePens(); } });
    const curve = el('input', { type: 'range', min: 0.4, max: 2.5, step: 0.05, value: s.pressureCurve,
      oninput: () => setSetting('pressureCurve', +curve.value) });
    const smooth = el('input', { type: 'range', min: 0, max: 0.95, step: 0.05, value: s.smoothing,
      oninput: () => setSetting('smoothing', +smooth.value) });
    const pad = el('canvas', { class: 'pen-pad', width: 560, height: 160 });
    const p = el('div', { class: 'popmenu pen-panel' },
      el('h3', {}, PENS[this.pen].label),
      el('label', { class: 'field' }, el('span', {}, 'Opacité'), op),
      el('label', { class: 'field' }, el('span', {}, 'Sensibilité à la pression (gauche : plus douce, droite : plus ferme)'), curve),
      el('label', { class: 'field' }, el('span', {}, 'Lissage du trait'), smooth),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: s.straighten, onchange: (e) => setSetting('straighten', e.target.checked) }), ' Rester immobile en fin de trait pour le rendre droit'),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: s.fingerDraw, onchange: (e) => setSetting('fingerDraw', e.target.checked) }), ' Dessiner aussi au doigt'),
      el('span', { class: 'muted small' }, 'Essayez ici :'), pad,
      el('button', { class: 'btn small', onclick: () => { this.penCfg[this.pen] = { color: PENS[this.pen].color, width: PENS[this.pen].width, opacity: PENS[this.pen].opacity }; this.savePens(); this.refreshBar(); p.remove(); } }, 'Réinitialiser ce stylo'));
    document.body.append(p);
    const r = anchor.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(innerWidth - p.offsetWidth - 8, r.left)) + 'px';
    p.style.top = (r.bottom + 6) + 'px';
    this.setupPad(pad);
    setTimeout(() => document.addEventListener('pointerdown', function h(e) {
      if (!p.contains(e.target)) { p.remove(); document.removeEventListener('pointerdown', h); }
    }), 0);
  }

  // Zone d'essai du stylo dans le panneau de réglages.
  setupPad(pad) {
    const ctx = pad.getContext('2d');
    const strokes = [];
    let cur = null;
    const redraw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pad.width, pad.height);
      // Repère PDF : y vers le haut, 1 pt = 2 px
      ctx.setTransform(2, 0, 0, -2, 0, pad.height);
      for (const s of strokes) drawStroke(ctx, s);
      if (cur) drawStroke(ctx, cur);
    };
    redraw();
    const pt = (e) => { const r = pad.getBoundingClientRect(); const sx = pad.width / r.width; return [(e.clientX - r.left) * sx / 2, (pad.height - (e.clientY - r.top) * sx) / 2]; };
    pad.style.touchAction = 'none';
    pad.addEventListener('pointerdown', (e) => {
      try { pad.setPointerCapture(e.pointerId); } catch {}
      const c = this.penCfg[this.pen];
      cur = { type: 'ink', id: newId(), pen: this.pen, color: c.color, width: c.width, opacity: c.opacity, pts: [] };
      const [x, y] = pt(e); cur.pts.push(x, y, mapPressure(e, getSettings()), tiltOf(e)); redraw();
    });
    pad.addEventListener('pointermove', (e) => {
      if (!cur) return;
      for (const ev of coalesced(e)) { const [x, y] = pt(ev); cur.pts.push(x, y, mapPressure(ev, getSettings()), tiltOf(ev)); }
      invalidate(cur); redraw();
    });
    pad.addEventListener('pointerup', () => { if (cur) strokes.push(cur); cur = null; redraw(); });
  }

  savePens() { setSetting('penPresets', clone(this.penCfg)); }

  setTool(tool, extra) {
    if (tool === 'pen' && extra) this.pen = extra;
    if (tool === 'shape' && extra) this.shapeKind = extra;
    if (tool !== 'stamp') this.pendingStamp = null;
    this.tool = tool;
    const v = this.view.el;
    v.classList.remove('tool-select', 'tool-draw', 'tool-hand', 'tool-eraser', 'tool-text');
    v.classList.add(tool === 'select' ? 'tool-select' : 'tool-draw');
    if (tool === 'hand') v.classList.add('tool-hand');
    if (tool === 'eraser') v.classList.add('tool-eraser');
    if (tool === 'text' || tool === 'note' || tool === 'stamp') v.classList.add('tool-text');
    if (tool !== 'select' && tool !== 'lasso') this.clearSelection();
    this.view.clearSel?.();
    this.refreshBar();
  }

  armStamp(s) {
    this.setTool('stamp');
    this.pendingStamp = s;
    this.renderOpts();
  }

  async pickImage() {
    const { pickFiles } = await import('./ui.js');
    const [f] = await pickFiles('image/*');
    if (!f) return;
    const src = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
    const img = new Image(); img.src = src; await img.decode();
    this.armStamp({ src, w: img.naturalWidth, h: img.naturalHeight, kind: 'image' });
  }

  // --- Historique -----------------------------------------------------------
  change(page, fn, { redraw = true } = {}) {
    const before = clone(this.view.ann[page]);
    fn(this.view.ann[page]);
    this.commit(page, before, redraw);
  }
  commit(page, before, redraw = true) {
    this.undoStack.push({ page, before, after: clone(this.view.ann[page]) });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    if (redraw) this.view.drawAnnots(page);
    this.view.markDirty([page]);
    this.refreshBar();
  }
  undo() {
    const h = this.undoStack.pop(); if (!h) return;
    this.redoStack.push(h);
    this.view.ann[h.page] = clone(h.before);
    this.clearSelection();
    this.view.drawAnnots(h.page); this.view.markDirty([h.page]); this.refreshBar();
  }
  redo() {
    const h = this.redoStack.pop(); if (!h) return;
    this.undoStack.push(h);
    this.view.ann[h.page] = clone(h.after);
    this.clearSelection();
    this.view.drawAnnots(h.page); this.view.markDirty([h.page]); this.refreshBar();
  }
  clearPage(i) {
    if (!this.view.ann[i].length) return;
    this.change(i, (l) => l.splice(0));
    toast('Annotations de la page effacées (Ctrl+Z pour annuler)');
  }

  // --- Coordonnées -----------------------------------------------------------
  pageAt(target) { const d = target.closest?.('.page'); return d ? this.view.pages[+d.dataset.i] : null; }
  vp(i) { return this.view.viewport(i) || this.view.pages[i].vp; }
  toPdf(pg, e) {
    const r = pg.div.getBoundingClientRect();
    return this.vp(pg.i).convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
  }
  ptPerPx(i) { return 1 / (this.view.zoom * 96 / 72); }

  // --- Saisie ---------------------------------------------------------------
  bindPointer() {
    const host = this.view.pagesEl;
    this._down = (e) => this.onDown(e);
    this._move = (e) => this.onMove(e);
    this._up = (e) => this.onUp(e);
    host.addEventListener('pointerdown', this._down, true);
    host.addEventListener('pointermove', this._move);
    host.addEventListener('pointerup', this._up);
    host.addEventListener('pointercancel', this._up);
    host.addEventListener('contextmenu', (e) => { if (this.tool !== 'select') e.preventDefault(); });
  }
  attachPages() {}

  onDown(e) {
    const pg = this.pageAt(e.target);
    if (e.pointerType === 'pen') this.lastPenAt = Date.now();
    if (!pg) return;

    // Outil sélection : clic sur un trait / une forme / un surlignage dessiné.
    if (this.tool === 'select') {
      if (e.target.closest('.obj, .selbox, .link')) return;
      const hit = this.hitTest(pg.i, this.toPdf(pg, e), e.pointerType === 'mouse' ? 4 : 8);
      if (hit) {
        e.preventDefault(); e.stopPropagation();
        this.select(pg.i, hit.id);
        this.startMove(e, pg);
      } else this.clearSelection();
      return;
    }
    if (!e.target.classList.contains('live')) return;

    const s = getSettings();
    // Rejet de la paume : le doigt est ignoré pendant que le stylet est utilisé.
    if (e.pointerType === 'touch') {
      if (Date.now() - this.lastPenAt < 1500) { e.preventDefault(); return; }
      if (!s.fingerDraw || this.touchCount() > 0 || this.tool === 'hand') { this.startPan(e); return; }
    }
    if (e.button !== 0 && !(e.pointerType === 'pen' && (e.buttons & 32))) {
      if (e.button === 1 || e.button === 2) this.startPan(e);
      return;
    }
    if (this.tool === 'hand') { this.startPan(e); return; }
    e.preventDefault();
    try { e.target.setPointerCapture(e.pointerId); } catch {}
    const tool = (e.pointerType === 'pen' && (e.buttons & 32)) ? 'eraser' : this.tool;
    const p = this.toPdf(pg, e);
    this.act = { tool, pg, id: e.pointerId, start: p, last: [e.clientX, e.clientY], sm: [e.clientX, e.clientY], t0: Date.now() };

    if (tool === 'pen') {
      const c = this.penCfg[this.pen];
      this.act.stroke = { type: 'ink', id: newId(), pen: this.pen, color: c.color, width: c.width, opacity: c.opacity, pts: [p[0], p[1], mapPressure(e, s), tiltOf(e)] };
      this.act.lastMove = Date.now();
      this.armStraighten();
      this.drawLive();
    } else if (tool === 'eraser') {
      this.act.before = clone(this.view.ann[pg.i]);
      this.act.changed = false;
      this.eraseAt(pg, p);
    } else if (tool === 'lasso') {
      this.clearSelection();
      this.act.poly = [p];
    } else if (tool === 'laser') {
      this.laser ??= [];
      this.act.trail = { pg, pts: [[p[0], p[1], Date.now()]] };
      this.laser.push(this.act.trail);
      this.animateLaser();
    } else if (tool === 'shape') {
      this.act.shape = { type: 'shape', id: newId(), kind: this.shapeKind, color: this.shapeCfg.color, width: this.shapeCfg.width, x1: p[0], y1: p[1], x2: p[0], y2: p[1] };
    } else if (tool === 'text') {
      this.act = null;
      this.addText(pg, p);
    } else if (tool === 'note') {
      this.act = null;
      this.addNote(pg, p);
    } else if (tool === 'stamp') {
      this.act = null;
      this.placeStamp(pg, p);
    }
  }

  touchCount() { return this._touches?.size || 0; }

  startPan(e) {
    const sc = this.view.scroller;
    this._touches ??= new Map();
    this._touches.set(e.pointerId, true);
    this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { e.target.setPointerCapture(e.pointerId); } catch {}
    const move = (ev) => {
      if (ev.pointerId !== this.pan?.id || this.view.pinching) return;
      sc.scrollLeft -= ev.clientX - this.pan.x; sc.scrollTop -= ev.clientY - this.pan.y;
      this.pan.x = ev.clientX; this.pan.y = ev.clientY;
    };
    const up = (ev) => {
      this._touches.delete(ev.pointerId);
      if (ev.pointerId === this.pan?.id) this.pan = null;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }

  onMove(e) {
    if (e.pointerType === 'pen') this.lastPenAt = Date.now();
    const a = this.act;
    if (!a || e.pointerId !== a.id) return;
    const s = getSettings();
    const evs = coalesced(e);
    const r = a.pg.div.getBoundingClientRect();
    const vp = this.vp(a.pg.i);
    if (a.tool === 'pen') {
      const k = 1 - Math.min(0.92, s.smoothing) * 0.75;
      for (const ev of evs) {
        if (Math.hypot(ev.clientX - a.last[0], ev.clientY - a.last[1]) > 2.5) { a.lastMove = Date.now(); a.last = [ev.clientX, ev.clientY]; }
        a.sm[0] += (ev.clientX - a.sm[0]) * k; a.sm[1] += (ev.clientY - a.sm[1]) * k;
        const p = vp.convertToPdfPoint(a.sm[0] - r.left, a.sm[1] - r.top);
        const pr = mapPressure(ev, s), t = tiltOf(ev);
        if (a.straight) {
          const st = a.stroke;
          st.pts.length = 8; st.pts[4] = p[0]; st.pts[5] = p[1];
          this.fillLine(st);
        } else a.stroke.pts.push(p[0], p[1], pr, t);
      }
      invalidate(a.stroke);
      this.drawLive();
    } else if (a.tool === 'eraser') {
      for (const ev of evs) this.eraseAt(a.pg, vp.convertToPdfPoint(ev.clientX - r.left, ev.clientY - r.top));
      this.drawEraserCursor(e);
    } else if (a.tool === 'lasso') {
      a.poly.push(vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top));
      this.drawLive();
    } else if (a.tool === 'laser') {
      const p = vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
      a.trail.pts.push([p[0], p[1], Date.now()]);
    } else if (a.tool === 'shape') {
      let p = vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
      const sh = a.shape;
      if (e.shiftKey) {
        const dx = p[0] - sh.x1, dy = p[1] - sh.y1;
        if (sh.kind === 'line' || sh.kind === 'arrow') {
          const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
          p = [sh.x1 + Math.cos(ang) * len, sh.y1 + Math.sin(ang) * len];
        } else { const m = Math.max(Math.abs(dx), Math.abs(dy)); p = [sh.x1 + Math.sign(dx) * m, sh.y1 + Math.sign(dy) * m]; }
      }
      sh.x2 = p[0]; sh.y2 = p[1];
      this.drawLive();
    }
  }

  // Rester immobile ~0,6 s en fin de trait : le trait devient une ligne droite.
  armStraighten() {
    clearInterval(this._st);
    if (!getSettings().straighten) return;
    this._st = setInterval(() => {
      const a = this.act;
      if (!a || a.tool !== 'pen' || a.straight) { clearInterval(this._st); return; }
      if (Date.now() - a.lastMove > 650 && a.stroke.pts.length >= 40) {
        const st = a.stroke, n = st.pts.length;
        const x0 = st.pts[0], y0 = st.pts[1], x1 = st.pts[n - 4], y1 = st.pts[n - 3];
        if (Math.hypot(x1 - x0, y1 - y0) < 15) return;
        let pr = 0; for (let i = 2; i < n; i += 4) pr += st.pts[i]; pr /= n / 4;
        st.avgP = pr;
        st.pts = [x0, y0, pr, 0, x1, y1, pr, 0];
        this.fillLine(st);
        a.straight = true;
        invalidate(st); this.drawLive();
        clearInterval(this._st);
      }
    }, 100);
  }
  fillLine(st) {
    const x0 = st.pts[0], y0 = st.pts[1], x1 = st.pts[4], y1 = st.pts[5], p = st.avgP ?? 0.5;
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 3));
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, p, 0);
    st.pts = pts;
  }

  onUp(e) {
    const a = this.act;
    if (!a || e.pointerId !== a.id) return;
    this.act = null;
    clearInterval(this._st);
    const i = a.pg.i;
    if (a.tool === 'pen') {
      const st = a.stroke;
      // Le lissage introduit un léger retard : on termine le trait au point réel du stylet.
      if (!a.straight) {
        const r = a.pg.div.getBoundingClientRect();
        const p = this.vp(i).convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
        const n = st.pts.length;
        if (Math.hypot(p[0] - st.pts[n - 4], p[1] - st.pts[n - 3]) > 0.3) st.pts.push(p[0], p[1], st.pts[n - 2], st.pts[n - 1]);
      }
      st.pts = simplify(st.pts, 0.08);
      this.change(i, (l) => l.push(st));
      this.clearLive(a.pg);
    } else if (a.tool === 'eraser') {
      if (a.changed) this.commit(i, a.before);
      this.clearLive(a.pg);
    } else if (a.tool === 'lasso') {
      const poly = a.poly;
      this.clearLive(a.pg);
      if (poly.length < 3) return;
      const ids = new Set();
      for (const an of this.view.ann[i]) {
        if (an.type === 'ink' ? strokeInPoly(an, poly) : (() => { const b = this.bbox(an); return b && pointInPoly((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, poly); })()) ids.add(an.id);
      }
      if (ids.size) { this.selection = { page: i, ids }; this.view.drawAnnots(i); }
    } else if (a.tool === 'shape') {
      const sh = a.shape;
      this.clearLive(a.pg);
      if (Math.hypot(sh.x2 - sh.x1, sh.y2 - sh.y1) < 3) return;
      this.change(i, (l) => l.push(sh));
    }
  }

  // --- Rendu ------------------------------------------------------------------
  liveCtx(pg) {
    const c = pg.live, ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(pg.dpr || 1, 0, 0, pg.dpr || 1, 0, 0);
    ctx.transform(...pg.vp.transform);
    return ctx;
  }
  clearLive(pg) { const c = pg.live; c.getContext('2d').setTransform(1, 0, 0, 1, 0, 0); c.getContext('2d').clearRect(0, 0, c.width, c.height); }

  drawLive() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const a = this.act;
      if (!a || !a.pg.vp) return;
      const ctx = this.liveCtx(a.pg);
      if (a.tool === 'pen') {
        if (a.stroke.pen === 'fluo') { ctx.save(); ctx.globalCompositeOperation = 'multiply'; drawStroke(ctx, a.stroke); ctx.restore(); }
        else drawStroke(ctx, a.stroke);
      } else if (a.tool === 'lasso') {
        ctx.beginPath();
        a.poly.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        const px = this.ptPerPx();
        ctx.lineWidth = 1.5 * px; ctx.setLineDash([5 * px, 4 * px]);
        ctx.strokeStyle = '#F5A623'; ctx.fillStyle = 'rgba(245,166,35,0.08)';
        ctx.fill(); ctx.stroke();
      } else if (a.tool === 'shape') this.drawShape(ctx, a.shape);
    });
  }

  drawEraserCursor(e) {
    const a = this.act; if (!a) return;
    const ctx = this.liveCtx(a.pg);
    const r = a.pg.div.getBoundingClientRect();
    const p = this.vp(a.pg.i).convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
    ctx.beginPath(); ctx.arc(p[0], p[1], this.eraserSize * this.ptPerPx(), 0, 7);
    ctx.lineWidth = this.ptPerPx(); ctx.strokeStyle = '#888'; ctx.stroke();
  }

  animateLaser() {
    if (this._laserRaf) return;
    const step = () => {
      const now = Date.now();
      const pages = new Set();
      this.laser = this.laser.filter(t => { t.pts = t.pts.filter(p => now - p[2] < 1200); pages.add(t.pg); return t.pts.length || this.act?.trail === t; });
      for (const pg of pages) {
        if (!pg.vp) continue;
        const ctx = this.liveCtx(pg);
        for (const t of this.laser.filter(t => t.pg === pg)) {
          const px = this.ptPerPx();
          for (let k = 1; k < t.pts.length; k++) {
            const age = (now - t.pts[k][2]) / 1200;
            ctx.strokeStyle = `rgba(255,40,40,${(1 - age) * 0.9})`;
            ctx.lineWidth = 4 * px * (1 - age * 0.5); ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(t.pts[k - 1][0], t.pts[k - 1][1]); ctx.lineTo(t.pts[k][0], t.pts[k][1]); ctx.stroke();
          }
          const last = t.pts[t.pts.length - 1];
          if (last && this.act?.trail === t) { ctx.fillStyle = 'rgba(255,40,40,0.95)'; ctx.shadowColor = 'red'; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(last[0], last[1], 5 * px, 0, 7); ctx.fill(); ctx.shadowBlur = 0; }
        }
      }
      if (this.laser.length) this._laserRaf = requestAnimationFrame(step);
      else { this._laserRaf = 0; for (const pg of pages) this.clearLive(pg); }
    };
    this._laserRaf = requestAnimationFrame(step);
  }

  drawOne(ctx, a, selected, pg) {
    if (a.type === 'ink') drawStroke(ctx, a, { selected });
    else if (a.type === 'markup') {
      ctx.save();
      for (const [x0, y0, x1, y1] of a.rects) {
        const h = y1 - y0;
        if (a.kind === 'highlight') { ctx.globalAlpha = 0.42; ctx.fillStyle = a.color; ctx.fillRect(x0, y0, x1 - x0, h); }
        else {
          ctx.strokeStyle = a.color; ctx.lineWidth = Math.max(0.7, h * 0.07);
          const y = a.kind === 'underline' ? y0 + h * 0.06 : y0 + h * 0.45;
          ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        }
      }
      if (selected) { const b = this.bbox(a); ctx.globalAlpha = 1; ctx.setLineDash([3, 2]); ctx.strokeStyle = '#F5A623'; ctx.lineWidth = 0.8; ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); }
      ctx.restore();
    } else if (a.type === 'shape') {
      this.drawShape(ctx, a);
      if (selected) { const b = this.bbox(a); ctx.save(); ctx.setLineDash([3, 2]); ctx.strokeStyle = '#F5A623'; ctx.lineWidth = 0.8; ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.restore(); }
    }
  }

  drawShape(ctx, s) {
    ctx.save();
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (s.fill) ctx.fillStyle = s.fill;
    ctx.beginPath();
    const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2), w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
    if (s.kind === 'rect') ctx.rect(x, y, w, h);
    else if (s.kind === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else {
      ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2);
      if (s.kind === 'arrow') {
        const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), L = Math.max(6, s.width * 4);
        ctx.moveTo(s.x2, s.y2); ctx.lineTo(s.x2 - L * Math.cos(ang - 0.45), s.y2 - L * Math.sin(ang - 0.45));
        ctx.moveTo(s.x2, s.y2); ctx.lineTo(s.x2 - L * Math.cos(ang + 0.45), s.y2 - L * Math.sin(ang + 0.45));
      }
    }
    if (s.fill) ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // --- Gomme, sélection --------------------------------------------------------
  eraseAt(pg, p) {
    const r = this.eraserSize * this.ptPerPx();
    const list = this.view.ann[pg.i];
    let changed = false;
    for (let k = list.length - 1; k >= 0; k--) {
      const a = list[k];
      if (a.type === 'ink') {
        if (this.eraserMode === 'precise') {
          if (!strokeHit(a, p[0], p[1], r)) continue;
          const parts = eraseFromStroke(a, p[0], p[1], r);
          if (parts) { list.splice(k, 1, ...parts); changed = true; }
        } else if (strokeHit(a, p[0], p[1], r)) { list.splice(k, 1); changed = true; }
      } else if (a.type === 'shape' || a.type === 'markup') {
        if (this.hitOne(a, p, r)) { list.splice(k, 1); changed = true; }
      }
    }
    if (changed) { this.act.changed = true; this.view.drawAnnots(pg.i); }
  }

  bbox(a) {
    if (a.type === 'ink') return strokeBBox(a);
    if (a.type === 'markup') {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const r of a.rects) { x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[2]); y1 = Math.max(y1, r[3]); }
      return { x0, y0, x1, y1 };
    }
    if (a.type === 'shape') { const m = a.width; return { x0: Math.min(a.x1, a.x2) - m, y0: Math.min(a.y1, a.y2) - m, x1: Math.max(a.x1, a.x2) + m, y1: Math.max(a.y1, a.y2) + m }; }
    if ('x' in a) return { x0: a.x, y0: a.y, x1: a.x + (a.w || 20), y1: a.y + (a.h || 20) };
    return null;
  }

  hitOne(a, p, r) {
    if (a.type === 'ink') return strokeHit(a, p[0], p[1], r);
    if (a.type === 'markup') return a.rects.some(([x0, y0, x1, y1]) => p[0] >= x0 - r && p[0] <= x1 + r && p[1] >= y0 - r && p[1] <= y1 + r);
    if (a.type === 'shape') {
      const x = Math.min(a.x1, a.x2), y = Math.min(a.y1, a.y2), w = Math.abs(a.x2 - a.x1), h = Math.abs(a.y2 - a.y1);
      const tol = r + a.width;
      if (a.kind === 'line' || a.kind === 'arrow') {
        const dx = a.x2 - a.x1, dy = a.y2 - a.y1, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a.x1) * dx + (p[1] - a.y1) * dy) / l2));
        return Math.hypot(p[0] - a.x1 - t * dx, p[1] - a.y1 - t * dy) <= tol;
      }
      if (a.kind === 'ellipse') {
        const cx = x + w / 2, cy = y + h / 2;
        const d = Math.hypot((p[0] - cx) / (w / 2 || 1), (p[1] - cy) / (h / 2 || 1));
        return Math.abs(d - 1) * Math.min(w, h) / 2 <= tol || (a.fill && d <= 1);
      }
      const inside = p[0] >= x - tol && p[0] <= x + w + tol && p[1] >= y - tol && p[1] <= y + h + tol;
      const inner = p[0] > x + tol && p[0] < x + w - tol && p[1] > y + tol && p[1] < y + h - tol;
      return inside && (!inner || a.fill);
    }
    return false;
  }

  hitTest(i, p, px) {
    const r = px * this.ptPerPx();
    const list = this.view.ann[i];
    for (let k = list.length - 1; k >= 0; k--) {
      const a = list[k];
      if ((a.type === 'ink' || a.type === 'shape' || a.type === 'markup') && this.hitOne(a, p, r)) return a;
    }
    return null;
  }

  select(page, id) {
    const prev = this.selection?.page;
    this.selection = { page, ids: new Set([id]) };
    if (prev != null && prev !== page) this.view.drawAnnots(prev);
    this.view.drawAnnots(page);
    const a = this.view.ann[page].find(x => x.id === id);
    if (a && ['text', 'note', 'image'].includes(a.type)) this.objEls.get(id)?.focusObj?.();
  }

  clearSelection() {
    if (!this.selection) return;
    const p = this.selection.page;
    this.selection = null;
    this.view.drawAnnots(p);
  }

  selectedAnns() {
    if (!this.selection) return [];
    return this.view.ann[this.selection.page].filter(a => this.selection.ids.has(a.id));
  }

  // Barre flottante de la sélection (traits, formes, surlignages).
  renderSelBox(i) {
    const pg = this.view.pages[i];
    pg.obj.querySelector('.selbox')?.remove();
    if (this.selection?.page !== i) return;
    const anns = this.selectedAnns();
    if (!anns.length || anns.every(a => ['text', 'note', 'image'].includes(a.type))) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const a of anns) { const b = this.bbox(a); if (!b) continue; x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
    const vp = this.vp(i);
    const [a1, b1, a2, b2] = vp.convertToViewportRectangle([x0, y0, x1, y1]);
    const L = Math.min(a1, a2), T = Math.min(b1, b2), W = Math.abs(a2 - a1), H = Math.abs(b2 - b1);
    const colors = anns[0].type === 'markup' && anns[0].kind === 'highlight' || anns[0].pen === 'fluo' ? SWATCHES.fluo : SWATCHES.ink.slice(0, 7);
    const box = el('div', { class: 'selbox', style: { left: L + 'px', top: T + 'px', width: W + 'px', height: H + 'px' } },
      el('div', { class: 'selbar' },
        ...colors.map(c => el('button', { class: 'swatch sm', style: { background: c }, onclick: (e) => { e.stopPropagation(); this.recolor(c); } })),
        btn('copy', 'Dupliquer', (e) => { e.stopPropagation(); this.duplicateSel(); }, 'tiny'),
        anns.length === 1 && anns[0].type === 'markup' ? btn('note', 'Commentaire', (e) => { e.stopPropagation(); this.editMarkupComment(i, anns[0]); }, 'tiny') : null,
        anns.length === 1 && anns[0].type === 'markup' ? btn('translate', 'Traduire', (e) => { e.stopPropagation(); this.view.app.lookup.translate(this.view, anns[0].text || ''); }, 'tiny') : null,
        btn('trash', 'Supprimer (Suppr)', (e) => { e.stopPropagation(); this.deleteSel(); }, 'tiny')));
    box.addEventListener('pointerdown', (e) => { if (e.target === box) { e.preventDefault(); e.stopPropagation(); this.startMove(e, pg); } });
    pg.obj.append(box);
  }

  startMove(e, pg) {
    const i = pg.i;
    const before = clone(this.view.ann[i]);
    let last = this.toPdf(pg, e), moved = false;
    const move = (ev) => {
      const p = this.toPdf(pg, ev);
      const dx = p[0] - last[0], dy = p[1] - last[1];
      if (!moved && Math.hypot(dx, dy) < 1.5) return;
      moved = true; last = p;
      for (const a of this.selectedAnns()) this.translate(a, dx, dy);
      this.view.drawAnnots(i);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (moved) this.commit(i, before);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  translate(a, dx, dy) {
    if (a.type === 'ink') translateStroke(a, dx, dy);
    else if (a.type === 'markup') a.rects = a.rects.map(([x0, y0, x1, y1]) => [x0 + dx, y0 + dy, x1 + dx, y1 + dy]);
    else if (a.type === 'shape') { a.x1 += dx; a.x2 += dx; a.y1 += dy; a.y2 += dy; }
    else if ('x' in a) { a.x += dx; a.y += dy; }
  }

  recolor(c) {
    if (!this.selection) return;
    this.change(this.selection.page, () => { for (const a of this.selectedAnns()) { a.color = c; } });
  }
  deleteSel() {
    if (!this.selection) return;
    const { page, ids } = this.selection;
    this.selection = null;
    this.change(page, (l) => { for (let k = l.length - 1; k >= 0; k--) if (ids.has(l[k].id)) l.splice(k, 1); });
  }
  duplicateSel() {
    if (!this.selection) return;
    const page = this.selection.page;
    const copies = this.selectedAnns().map(a => { const c = clone(a); c.id = newId(); this.translate(c, 12, -12); return c; });
    this.change(page, (l) => l.push(...copies));
    this.selection = { page, ids: new Set(copies.map(c => c.id)) };
    this.view.drawAnnots(page);
  }

  // --- Surlignage depuis la sélection de texte ----------------------------------
  markupFromRects(kind, color, rects, text, withComment = false) {
    const byPage = new Map();
    for (const r of rects) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const pg = this.view.pages.find(p => { const b = p.div.getBoundingClientRect(); return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom; });
      if (!pg) continue;
      const b = pg.div.getBoundingClientRect(), vp = this.vp(pg.i);
      const p1 = vp.convertToPdfPoint(r.left - b.left, r.top - b.top), p2 = vp.convertToPdfPoint(r.right - b.left, r.bottom - b.top);
      const q = [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])];
      if (!byPage.has(pg.i)) byPage.set(pg.i, []);
      byPage.get(pg.i).push(q);
    }
    let lastAnn = null, lastPage = null;
    for (const [i, qs] of byPage) {
      // Fusionne les rectangles d'une même ligne.
      qs.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      const merged = [];
      for (const q of qs) {
        const m = merged.find(o => Math.abs(o[1] - q[1]) < (q[3] - q[1]) * 0.5 && Math.abs(o[3] - q[3]) < (q[3] - q[1]) * 0.5 && q[0] <= o[2] + 3 && q[2] >= o[0] - 3);
        if (m) { m[0] = Math.min(m[0], q[0]); m[2] = Math.max(m[2], q[2]); m[1] = Math.min(m[1], q[1]); m[3] = Math.max(m[3], q[3]); }
        else merged.push([...q]);
      }
      const a = { type: 'markup', id: newId(), kind, color, rects: merged.map(r => r.map(v => Math.round(v * 100) / 100)), text };
      this.change(i, (l) => l.push(a));
      lastAnn = a; lastPage = i;
    }
    if (withComment && lastAnn) this.editMarkupComment(lastPage, lastAnn);
  }

  async editMarkupComment(i, a) {
    const { promptBox } = await import('./ui.js');
    const t = await promptBox('Commentaire', 'Votre commentaire sur ce passage', a.comment || '');
    if (t == null) return;
    this.change(i, () => { const x = this.view.ann[i].find(o => o.id === a.id); if (x) x.comment = t; });
  }

  // --- Objets DOM : texte, notes, images ---------------------------------------
  addText(pg, p) {
    const c = this.textCfg;
    const a = { type: 'text', id: newId(), x: p[0], y: p[1] - c.size * 1.4, w: 180, h: c.size * 1.4, text: '', size: c.size, color: c.color, font: c.font, bold: c.bold, bg: c.bg };
    this.change(pg.i, (l) => l.push(a));
    this.setTool('select');
    setTimeout(() => this.objEls.get(a.id)?.focusObj?.(true), 30);
  }

  addNote(pg, p) {
    const a = { type: 'note', id: newId(), x: p[0] - 10, y: p[1] - 10, w: 20, h: 20, text: '', color: '#ffd54f' };
    this.change(pg.i, (l) => l.push(a));
    this.setTool('select');
    setTimeout(() => this.openNote(pg.i, a.id), 30);
  }

  placeStamp(pg, p) {
    const s = this.pendingStamp; if (!s) return;
    const targetW = s.kind === 'signature' ? 150 : s.kind === 'stamp' ? 130 : Math.min(240, s.w * 0.6);
    const w = targetW, h = targetW * (s.h / s.w);
    const a = { type: 'image', id: newId(), kind: s.kind, x: p[0] - w / 2, y: p[1] - h / 2, w, h, src: s.src };
    this.change(pg.i, (l) => l.push(a));
    this.pendingStamp = null;
    this.setTool('select');
    this.select(pg.i, a.id);
  }

  addTranslationNote(orig, translated) {
    const i = this.view.current, b = this.view.base[i];
    const a = { type: 'note', id: newId(), x: b.w - 40, y: b.h - 40, w: 20, h: 20, text: `${orig}\n→ ${translated}`, color: '#64b5f6' };
    this.change(i, (l) => l.push(a));
    toast('Traduction ajoutée en note sur la page ' + (i + 1));
  }

  refreshObjects() { for (const pg of this.view.pages) if (pg.visible || pg.obj.childElementCount) this.syncObjects(pg.i); }

  syncObjects(i) {
    const pg = this.view.pages[i];
    const vp = this.vp(i);
    if (!vp) return;
    const s = this.view.zoom * 96 / 72;
    const present = new Set();
    for (const a of this.view.ann[i]) {
      if (!['text', 'note', 'image'].includes(a.type)) continue;
      present.add(a.id);
      let n = this.objEls.get(a.id);
      if (!n || n.parentNode !== pg.obj) { n?.remove(); n = this.makeObj(i, a); this.objEls.set(a.id, n); pg.obj.append(n); }
      const [x1, y1, x2, y2] = vp.convertToViewportRectangle([a.x, a.y, a.x + a.w, a.y + a.h]);
      Object.assign(n.style, { left: Math.min(x1, x2) + 'px', top: Math.min(y1, y2) + 'px', width: Math.abs(x2 - x1) + 'px' });
      if (a.type !== 'text') n.style.height = Math.abs(y2 - y1) + 'px';
      else if (!n.contains(document.activeElement)) {
        const ed = n.querySelector('.tb-edit');
        if (ed.innerText !== a.text) ed.innerText = a.text;
        Object.assign(ed.style, { fontSize: a.size * s + 'px', color: a.color, fontWeight: a.bold ? '700' : '400',
          fontFamily: a.font === 'Times' ? 'Georgia, "Times New Roman", serif' : a.font === 'Courier' ? '"Courier New", monospace' : 'Helvetica, Arial, sans-serif',
          background: a.bg || 'transparent' });
      } else n.querySelector('.tb-edit').style.fontSize = a.size * s + 'px';
      n.classList.toggle('sel', !!this.selection?.ids.has(a.id) && this.selection.page === i);
    }
    for (const n of [...pg.obj.querySelectorAll('.obj')]) if (!present.has(n.dataset.id)) { this.objEls.delete(n.dataset.id); n.remove(); }
    this.renderSelBox(i);
  }

  findAnn(i, id) { return this.view.ann[i].find(a => a.id === id); }

  makeObj(i, a) {
    const n = el('div', { class: 'obj obj-' + a.type, 'data-id': a.id });
    const sel = () => { this.selection = { page: i, ids: new Set([a.id]) }; this.view.drawAnnots(i); };
    // Déplacement par glisser
    const dragFrom = (e, mode) => {
      e.preventDefault(); e.stopPropagation();
      sel();
      const pg = this.view.pages[i];
      const before = clone(this.view.ann[i]);
      const start = this.toPdf(pg, e);
      const cur = this.findAnn(i, a.id);
      const o = { x: cur.x, y: cur.y, w: cur.w, h: cur.h };
      let moved = false;
      const mv = (ev) => {
        const p = this.toPdf(pg, ev), dx = p[0] - start[0], dy = p[1] - start[1];
        if (!moved && Math.hypot(dx, dy) < 1) return;
        moved = true;
        const t = this.findAnn(i, a.id); if (!t) return;
        if (mode === 'move') { t.x = o.x + dx; t.y = o.y + dy; }
        else if (mode === 'resize') {
          const nw = Math.max(16, o.w + dx);
          if (t.type === 'image') { const k = nw / o.w; t.w = nw; t.h = o.h * k; t.y = o.y + o.h - t.h; }
          else t.w = nw;
        }
        this.syncObjects(i);
      };
      const up = () => {
        window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
        if (moved) this.commit(i, before, false); else if (mode === 'move' && a.type === 'note') this.openNote(i, a.id);
        else if (mode === 'move' && a.type === 'text') n.focusObj(true);
      };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    };
    const handle = el('div', { class: 'obj-resize', title: 'Redimensionner', onpointerdown: (e) => dragFrom(e, 'resize') });
    const del = el('button', { class: 'obj-del', title: 'Supprimer', onpointerdown: (e) => e.stopPropagation(),
      onclick: (e) => { e.stopPropagation(); this.change(i, (l) => { const k = l.findIndex(x => x.id === a.id); if (k >= 0) l.splice(k, 1); }); } }, icon('close', 14));

    if (a.type === 'image') {
      n.append(el('img', { src: a.src, draggable: false }), handle, del);
      n.addEventListener('pointerdown', (e) => { if (e.target === n || e.target.tagName === 'IMG') dragFrom(e, 'move'); });
      n.focusObj = () => sel();
    } else if (a.type === 'note') {
      n.append(icon('note', 18), del);
      n.style.setProperty('--nc', a.color);
      n.addEventListener('pointerdown', (e) => { if (!e.target.closest('.obj-del')) dragFrom(e, 'move'); });
      n.focusObj = () => this.openNote(i, a.id);
      n.title = a.text || 'Note';
    } else if (a.type === 'text') {
      const ed = el('div', { class: 'tb-edit', contenteditable: 'true', spellcheck: 'true' });
      const grip = el('div', { class: 'obj-grip', title: 'Déplacer', onpointerdown: (e) => dragFrom(e, 'move') }, icon('move', 14));
      const fmt = this.textFormatBar(i, a.id);
      n.append(grip, ed, handle, del, fmt);
      let before = null;
      ed.addEventListener('focus', () => { before = clone(this.view.ann[i]); sel(); n.classList.add('editing'); });
      ed.addEventListener('input', () => {
        const t = this.findAnn(i, a.id); if (!t) return;
        t.text = ed.innerText.replace(/\n$/, '');
        t.h = Math.max(t.size * 1.4, ed.offsetHeight / (this.view.zoom * 96 / 72));
        t.y = t.y; // l'ancrage se fait par le haut
      });
      ed.addEventListener('blur', () => {
        n.classList.remove('editing');
        const t = this.findAnn(i, a.id);
        if (!t) return;
        // Ancrage par le haut : recalcule y à partir de la hauteur réelle
        const top = t.y + t.h;
        t.h = Math.max(t.size * 1.4, ed.offsetHeight / (this.view.zoom * 96 / 72));
        t.y = top - t.h;
        if (!t.text.trim()) { this.view.ann[i] = this.view.ann[i].filter(x => x.id !== a.id); this.syncObjects(i); }
        if (before && JSON.stringify(before) !== JSON.stringify(this.view.ann[i])) this.commit(i, before, false);
        before = null;
      });
      ed.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') ed.blur(); });
      n.focusObj = (edit) => { sel(); if (edit) { ed.focus(); const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } };
    }
    return n;
  }

  textFormatBar(i, id) {
    const upd = (fn) => { const t = this.findAnn(i, id); if (!t) return; fn(t); Object.assign(this.textCfg, { size: t.size, color: t.color, font: t.font, bold: t.bold, bg: t.bg }); this.syncObjects(i); this.view.markDirty([i]); };
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    const b = el('div', { class: 'tb-fmt', onpointerdown: stop },
      el('button', { class: 'chip', onclick: () => upd(t => (t.size = Math.max(6, t.size - 1))) }, 'A−'),
      el('button', { class: 'chip', onclick: () => upd(t => (t.size = Math.min(96, t.size + 1))) }, 'A+'),
      el('button', { class: 'chip', style: { fontWeight: 700 }, onclick: () => upd(t => (t.bold = !t.bold)) }, 'G'),
      el('button', { class: 'chip', onclick: () => upd(t => (t.font = t.font === 'Helvetica' ? 'Times' : t.font === 'Times' ? 'Courier' : 'Helvetica')) }, 'Police'),
      ...['#1b1b1b', '#1f3fae', '#c0392b', '#1e8449', '#7d3c98'].map(c => el('button', { class: 'swatch sm', style: { background: c }, onclick: () => upd(t => (t.color = c)) })),
      el('button', { class: 'chip', title: 'Fond', onclick: () => upd(t => (t.bg = t.bg ? '' : '#fff7c2')) }, 'Fond'));
    return b;
  }

  openNote(i, id) {
    const a = this.findAnn(i, id); if (!a) return;
    document.querySelector('.note-pop')?.remove();
    const n = this.objEls.get(id); if (!n) return;
    const before = clone(this.view.ann[i]);
    const ta = el('textarea', { class: 'input', rows: 6, placeholder: 'Votre note…' });
    ta.value = a.text;
    const colors = ['#ffd54f', '#81c784', '#64b5f6', '#f48fb1', '#ffb74d'];
    const pop = el('div', { class: 'note-pop' },
      el('div', { class: 'row' }, ...colors.map(c => el('button', { class: 'swatch sm', style: { background: c }, onclick: () => { a.color = c; n.style.setProperty('--nc', c); } })),
        el('div', { class: 'grow' }), btn('close', 'Fermer', () => close())),
      ta);
    const close = () => {
      a.text = ta.value; n.title = a.text || 'Note';
      pop.remove();
      if (JSON.stringify(before) !== JSON.stringify(this.view.ann[i])) this.commit(i, before, false);
    };
    ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    document.body.append(pop);
    const r = n.getBoundingClientRect();
    pop.style.left = Math.min(innerWidth - 300, r.right + 8) + 'px';
    pop.style.top = Math.min(innerHeight - 220, r.top) + 'px';
    setTimeout(() => ta.focus(), 20);
    setTimeout(() => document.addEventListener('pointerdown', function h(e) {
      if (!pop.contains(e.target)) { close(); document.removeEventListener('pointerdown', h); }
    }), 0);
  }

  // --- Clavier ---------------------------------------------------------------
  handleKey(e) {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return true; }
    if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); return true; }
    if ((k === 'delete' || k === 'backspace') && this.selection) { e.preventDefault(); this.deleteSel(); return true; }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const map = { v: ['select'], h: ['hand'], e: ['eraser'], l: ['lasso'], t: ['text'], n: ['note'], p: ['pen', this.pen] };
    if (k === 'escape') { this.setTool('select'); this.clearSelection(); return true; }
    if (map[k]) { this.setTool(...map[k]); return true; }
    if (/^[1-7]$/.test(k)) { this.setTool('pen', PEN_ORDER[+k - 1]); return true; }
    return false;
  }

  destroy() {
    clearInterval(this._st);
    const host = this.view.pagesEl;
    host.removeEventListener('pointerdown', this._down, true);
    document.querySelector('.note-pop')?.remove();
    document.querySelector('.pen-panel')?.remove();
  }
}
