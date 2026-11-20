// Mode étude : confort visuel (filtre lumière bleue, sépia, nuit, gris, contraste,
// assombrissement), règle de lecture, mode focus, Pomodoro, rappel 20-20-20,
// fiche de synthèse des annotations, révision des passages surlignés.
import { el, icon, btn, toast, modal, downloadBlob, baseName, popMenu } from './ui.js';
import { getSettings, setSetting, onSetting } from './store.js';

const PAGE_MODES = [['normal', 'Normal'], ['sepia', 'Sépia'], ['night', 'Nuit'], ['gray', 'Gris'], ['contrast', 'Contraste']];

export class Study {
  constructor(app) {
    this.app = app;
    this.filter = el('div', { id: 'blue-filter' });
    this.ruler = el('div', { id: 'reading-ruler', class: 'hidden' });
    document.body.append(this.filter, this.ruler);
    this.applyAll();
    onSetting((k) => { if (['blueFilter', 'pageMode', 'pageDim', 'blueAuto', 'blueFrom', 'blueTo', 'blueAutoLevel'].includes(k)) this.applyAll(); });
    setInterval(() => this.tick(), 30_000);
    this.pomo = null;
    this.badge = el('button', { class: 'pomo-badge hidden', title: 'Minuteur Pomodoro', onclick: (e) => this.pomoMenu(e.currentTarget) });
    document.addEventListener('pointermove', (e) => this.moveRuler(e), { passive: true });
    this.lastEye = Date.now();
  }

  // --- Confort visuel -------------------------------------------------------------
  autoActive() {
    const s = getSettings();
    if (!s.blueAuto) return false;
    const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
    const t = (x) => { const [h, mm] = x.split(':').map(Number); return h * 60 + mm; };
    const a = t(s.blueFrom), b = t(s.blueTo);
    return a < b ? m >= a && m < b : m >= a || m < b;
  }
  applyAll() {
    const s = getSettings();
    const level = Math.max(s.blueFilter, this.autoActive() ? s.blueAutoLevel : 0);
    this.filter.style.opacity = level;
    this.filter.classList.toggle('on', level > 0);
    document.body.dataset.pagemode = s.pageMode;
    document.body.style.setProperty('--page-dim', s.pageDim);
    this.app.updateStudyBtn?.(level > 0 || s.pageMode !== 'normal');
  }
  tick() {
    this.applyAll();
    const s = getSettings();
    if (s.eyeReminder && Date.now() - this.lastEye > 20 * 60_000) {
      this.lastEye = Date.now();
      toast('Pause pour les yeux : regardez un point éloigné (6 m) pendant 20 secondes.', 'info', 20000);
      this.beep(660, 0.15);
    }
  }

  // --- Règle de lecture -------------------------------------------------------------
  toggleRuler(on = this.ruler.classList.contains('hidden')) {
    this.ruler.classList.toggle('hidden', !on);
    document.body.classList.toggle('ruler-on', on);
  }
  moveRuler(e) {
    if (this.ruler.classList.contains('hidden')) return;
    if (!e.target.closest?.('.scroller')) return;
    this.ruler.style.top = e.clientY + 'px';
  }

  // --- Focus ----------------------------------------------------------------------
  toggleFocus() {
    const on = !document.body.classList.contains('focus');
    document.body.classList.toggle('focus', on);
    if (on) { document.documentElement.requestFullscreen?.().catch(() => {}); toast('Mode focus : Échap pour quitter.', 'info', 2500); }
    else if (document.fullscreenElement) document.exitFullscreen?.();
  }

  // --- Pomodoro -----------------------------------------------------------------------
  startPomo(phase = 'work') {
    const s = getSettings();
    const mins = phase === 'work' ? s.pomodoroWork : s.pomodoroBreak;
    this.pomo = { phase, end: Date.now() + mins * 60_000, count: (this.pomo?.count || 0) + (phase === 'work' ? 1 : 0) };
    clearInterval(this._pi);
    this._pi = setInterval(() => this.pomoTick(), 1000);
    this.badge.classList.remove('hidden');
    this.pomoTick();
    toast(phase === 'work' ? `Session de travail : ${mins} min` : `Pause : ${mins} min`, 'info', 2500);
  }
  stopPomo() { clearInterval(this._pi); this.pomo = null; this.badge.classList.add('hidden'); }
  pomoTick() {
    if (!this.pomo) return;
    const left = Math.max(0, this.pomo.end - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
    this.badge.textContent = `${this.pomo.phase === 'work' ? '●' : '☕'} ${m}:${String(s).padStart(2, '0')}`;
    this.badge.classList.toggle('break', this.pomo.phase !== 'work');
    if (left <= 0) {
      this.beep(880, 0.25); setTimeout(() => this.beep(660, 0.25), 300);
      if (this.pomo.phase === 'work') { toast('Bravo ! Place à une pause.', 'info', 6000); this.startPomo('break'); }
      else { toast('Pause terminée, on reprend.', 'info', 6000); this.startPomo('work'); }
    }
  }
  pomoMenu(anchor) {
    popMenu(anchor, [
      { label: 'Recommencer une session', icon: 'timer', onClick: () => this.startPomo('work') },
      { label: 'Passer à la pause', icon: 'timer', onClick: () => this.startPomo('break') },
      { label: 'Arrêter le minuteur', icon: 'close', onClick: () => this.stopPomo() },
    ]);
  }
  beep(freq, dur) {
    try {
      const a = this._ac ??= new AudioContext();
      const o = a.createOscillator(), g = a.createGain();
      o.frequency.value = freq; g.gain.setValueAtTime(0.08, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + dur);
    } catch {}
  }

  // --- Panneau « Étude » ---------------------------------------------------------------
  panel(anchor) {
    document.querySelector('.study-panel')?.remove();
    const s = getSettings();
    const view = this.app.active;
    const slider = (key, min, max, step) => el('input', { type: 'range', min, max, step, value: s[key], oninput: (e) => setSetting(key, +e.target.value) });
    const modes = el('div', { class: 'chips' }, PAGE_MODES.map(([k, l]) => el('button', { class: 'chip' + (s.pageMode === k ? ' on' : ''), onclick: (e) => {
      setSetting('pageMode', k); modes.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === e.currentTarget));
    } }, el('span', { class: 'pm-dot pm-' + k }), l)));
    const check = (key, label) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: s[key], onchange: (e) => setSetting(key, e.target.checked) }), ' ' + label);
    const time = (key) => el('input', { type: 'time', class: 'input tiny-input', value: s[key], onchange: (e) => setSetting(key, e.target.value) });
    const act = (ic, label, fn, needDoc = true) => el('button', { class: 'study-act', disabled: needDoc && !view, onclick: () => { p.remove(); fn(); } }, icon(ic, 18), el('span', {}, label));
    const p = el('div', { class: 'popmenu study-panel' },
      el('h3', {}, 'Confort des yeux'),
      el('label', { class: 'field' }, el('span', {}, 'Filtre de lumière bleue'), slider('blueFilter', 0, 0.8, 0.02)),
      el('div', { class: 'row wrap' }, check('blueAuto', 'Automatique de'), time('blueFrom'), el('span', {}, 'à'), time('blueTo')),
      el('label', { class: 'field' }, el('span', {}, 'Intensité du mode automatique'), slider('blueAutoLevel', 0.1, 0.8, 0.02)),
      el('span', { class: 'field-label' }, 'Apparence des pages'), modes,
      el('label', { class: 'field' }, el('span', {}, 'Assombrir les pages'), slider('pageDim', 0, 0.6, 0.02)),
      check('eyeReminder', 'Me rappeler de reposer mes yeux toutes les 20 minutes (règle 20-20-20)'),
      el('h3', {}, 'Lire et réviser'),
      el('div', { class: 'study-grid' },
        act('ruler', 'Règle de lecture', () => this.toggleRuler(), false),
        act('focus', 'Mode focus', () => this.toggleFocus(), false),
        act('timer', 'Pomodoro', () => (this.pomo ? this.stopPomo() : this.startPomo()), false),
        act('speak', 'Lire la page', () => this.app.lookup.readPage(view)),
        act('translate', 'Traduire la page', () => this.app.lookup.translatePage(view)),
        act('sparkle', 'Résumer la page (IA)', () => this.app.lookup.summarizePage(view)),
        act('cards', 'Questions de révision (IA)', () => this.app.lookup.quizPage(view)),
        act('download', 'Fiche de synthèse', () => this.exportSummary(view)),
        act('star', 'Réviser mes surlignages', () => this.review(view))));
    document.body.append(p);
    const r = anchor.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(innerWidth - p.offsetWidth - 8, r.right - p.offsetWidth)) + 'px';
    p.style.top = (r.bottom + 6) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function h(e) {
      if (!p.contains(e.target)) { p.remove(); document.removeEventListener('pointerdown', h); }
    }), 0);
  }

  // --- Fiche de synthèse -------------------------------------------------------------
  collect(view) {
    const items = [];
    view.ann.forEach((list, pi) => list.forEach(a => {
      if (a.type === 'markup') items.push({ page: pi + 1, kind: a.kind, text: a.text, comment: a.comment, color: a.color });
      else if (a.type === 'text' && a.text.trim()) items.push({ page: pi + 1, kind: 'text', text: a.text });
      else if (a.type === 'note' && a.text.trim()) items.push({ page: pi + 1, kind: 'note', text: a.text });
    }));
    return items;
  }

  exportSummary(view) {
    if (!view) return;
    const items = this.collect(view);
    if (!items.length) { toast('Aucun surlignage ni note à résumer pour l\'instant.', 'error'); return; }
    const colorName = { '#ffe14d': 'Jaune', '#9cf26b': 'Vert', '#61d4ff': 'Bleu', '#ff8fd1': 'Rose', '#ffb347': 'Orange' };
    let mdTxt = `# Fiche de synthèse — ${baseName(view.name)}\n\n_${new Date().toLocaleDateString('fr-FR')} · ${items.length} élément(s)_\n`;
    let lastPage = 0;
    for (const it of items) {
      if (it.page !== lastPage) { mdTxt += `\n## Page ${it.page}\n\n`; lastPage = it.page; }
      if (it.kind === 'highlight') mdTxt += `- ${colorName[it.color] ? `**[${colorName[it.color]}]** ` : ''}« ${it.text} »${it.comment ? `\n  - 💬 ${it.comment}` : ''}\n`;
      else if (it.kind === 'underline' || it.kind === 'strike') mdTxt += `- ${it.kind === 'underline' ? 'Souligné' : 'Barré'} : « ${it.text} »${it.comment ? ` — 💬 ${it.comment}` : ''}\n`;
      else if (it.kind === 'note') mdTxt += `- 🗒 ${it.text.replace(/\n/g, ' ')}\n`;
      else mdTxt += `- ✍ ${it.text.replace(/\n/g, ' ')}\n`;
    }
    const pre = el('pre', { class: 'summary-pre' }, mdTxt);
    modal({ title: 'Fiche de synthèse', wide: true, body: pre, actions: [
      { label: 'Copier', onClick: () => { navigator.clipboard.writeText(mdTxt); toast('Fiche copiée'); return false; } },
      { label: 'Télécharger (.md)', primary: true, onClick: () => downloadBlob(new Blob([mdTxt], { type: 'text/markdown' }), baseName(view.name) + '_synthese.md') },
    ] });
  }

  // --- Révision type « cartes » ---------------------------------------------------------
  review(view) {
    if (!view) return;
    const cards = this.collect(view).filter(i => i.kind === 'highlight' || i.kind === 'underline').sort(() => Math.random() - 0.5);
    if (!cards.length) { toast('Surlignez d\'abord des passages importants.', 'error'); return; }
    let k = 0, shown = false;
    const face = el('div', { class: 'card-face' });
    const count = el('span', { class: 'muted small' });
    const draw = () => {
      const c = cards[k];
      face.innerHTML = '';
      count.textContent = `${k + 1} / ${cards.length}`;
      if (c.comment) {
        face.append(el('p', { class: 'card-q' }, c.comment));
        if (shown) face.append(el('p', { class: 'card-a' }, '« ' + c.text + ' »'), el('p', { class: 'muted small' }, 'Page ' + c.page));
      } else {
        // Texte à trous : on masque un mot important.
        const words = c.text.split(/\s+/);
        const idx = words.map((w, i) => [w.replace(/[^\p{L}]/gu, '').length, i]).sort((a, b) => b[0] - a[0]).slice(0, Math.max(1, Math.round(words.length / 8))).map(x => x[1]);
        face.append(el('p', { class: 'card-q' }, words.map((w, i) => idx.includes(i) && !shown ? el('span', { class: 'blank' }, '_'.repeat(Math.min(12, w.length))) : w + ' ')));
        if (shown) face.append(el('p', { class: 'muted small' }, 'Page ' + c.page));
      }
    };
    draw();
    modal({ title: 'Réviser mes surlignages', body: el('div', { class: 'review' }, count, face,
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => { k = (k - 1 + cards.length) % cards.length; shown = false; draw(); } }, 'Précédente'),
        el('button', { class: 'btn primary', onclick: () => { shown = !shown; draw(); } }, 'Afficher / masquer'),
        el('button', { class: 'btn', onclick: () => { k = (k + 1) % cards.length; shown = false; draw(); } }, 'Suivante'),
        el('button', { class: 'btn', onclick: () => { view.goto(cards[k].page - 1); } }, 'Aller à la page'))) });
  }
}
