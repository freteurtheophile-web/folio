// Folio : application principale (accueil, onglets, ouverture / enregistrement, réglages).
import { el, icon, btn, toast, modal, confirmBox, popMenu, pickFiles, downloadBlob, fmtSize, baseName, busy, $ } from './ui.js';
import { loadSettings, getSettings, setSetting, onSetting, addRecent, listRecents, patchRecent, idb } from './store.js';
import { DocView } from './viewer.js';
import { pageOps } from './pages.js';
import { buildAnnotatedPdf, printDoc, renderAnnotatedPage } from './save.js';
import { TOOLS, openTool } from './tools.js';
import { signs } from './sign.js';
import { lookup, LANGS } from './lookup.js';
import { Study } from './study.js';
import { makeZip } from './zip.js';
import { canvasToBytes } from './pdf.js';

export const APP_NAME = 'Folio';
const VERSION = '1.0.0';

class App {
  constructor() {
    this.docs = [];
    this.active = null;
    this.pageOps = pageOps;
    this.signs = signs;
    this.lookup = lookup;
  }

  async start() {
    await loadSettings();
    this.applyTheme();
    onSetting((k) => { if (k === 'theme') this.applyTheme(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    this.buildShell();
    this.study = new Study(this);
    this.topRight.prepend(this.study.badge);
    this.showHome();
    this.bindGlobal();
    this.registerSW();
    this.handleLaunchQueue();
  }

  applyTheme() {
    const t = getSettings().theme;
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#232529' : '#F5F4F1');
  }

  // --- Coquille ----------------------------------------------------------------
  buildShell() {
    this.tabsEl = el('div', { class: 'tabs' });
    this.docActions = el('div', { class: 'doc-actions' });
    this.studyBtn = btn('eye', 'Mode étude et confort des yeux', (e) => this.study.panel(e.currentTarget), 'study-btn');
    this.topRight = el('div', { class: 'top-right' },
      this.docActions, this.studyBtn,
      btn('settings', 'Réglages', () => this.openSettings()));
    const top = el('header', { class: 'topbar' },
      el('button', { class: 'brand', title: 'Accueil', onclick: () => this.showHome() },
        el('img', { src: 'icons/logo.svg', alt: '' }), el('span', {}, APP_NAME)),
      this.tabsEl, el('div', { class: 'grow' }), this.topRight);
    this.main = el('main', { class: 'main' });
    document.getElementById('app').append(top, this.main);
  }

  updateStudyBtn(on) { this.studyBtn?.classList.toggle('on', on); }

  updateTabs() {
    this.tabsEl.innerHTML = '';
    for (const d of this.docs) {
      const t = el('div', { class: 'tab' + (d === this.active ? ' on' : ''), title: d.name, onclick: () => this.activate(d) },
        el('span', { class: 'tab-name' }, baseName(d.name)),
        d.dirty ? el('span', { class: 'tab-dirty', title: 'Modifications non enregistrées dans le fichier' }) : null,
        btn('close', 'Fermer', (e) => { e.stopPropagation(); this.close(d); }, 'tiny'));
      t.addEventListener('auxclick', (e) => { if (e.button === 1) this.close(d); });
      this.tabsEl.append(t);
    }
    this.docActions.innerHTML = '';
    if (this.active) {
      this.docActions.append(
        el('button', { class: 'btn small primary save-btn', title: 'Enregistrer (Ctrl+S)', onclick: () => this.save(this.active) }, icon('save', 16), el('span', {}, 'Enregistrer')),
        btn('more', 'Exporter, imprimer…', (e) => this.docMenu(e.currentTarget)));
    }
  }

  docMenu(anchor) {
    const v = this.active;
    popMenu(anchor, [
      { label: 'Enregistrer sous…', icon: 'save', onClick: () => this.save(v, true) },
      { label: 'Imprimer (Ctrl+P)', icon: 'print', onClick: () => this.print(v) },
      { label: 'Exporter les pages en images', icon: 'toimg', onClick: () => this.exportImages(v) },
      { label: 'Fiche de synthèse des annotations', icon: 'list', onClick: () => this.study.exportSummary(v) },
      '-',
      { label: 'Compresser ce document', icon: 'compress', onClick: () => this.toolOnCurrent('compress') },
      { label: 'Organiser les pages', icon: 'organize', onClick: () => this.toolOnCurrent('organize') },
      { label: 'Ajouter des numéros de page', icon: 'numbers', onClick: () => this.toolOnCurrent('numbers') },
      { label: 'Ajouter un filigrane', icon: 'watermark', onClick: () => this.toolOnCurrent('watermark') },
      { label: 'Rogner les marges (lecture sur tablette)', icon: 'crop', onClick: () => this.toolOnCurrent('crop') },
      { label: 'OCR : rendre le texte cherchable', icon: 'ocr', onClick: () => this.toolOnCurrent('ocr') },
      { label: 'Diviser', icon: 'split', onClick: () => this.toolOnCurrent('split') },
      '-',
      { label: 'Insérer une page de notes', icon: 'blank', onClick: () => pageOps.insertBlank(v, v.current + 1) },
      { label: 'Propriétés du document', icon: 'info', onClick: () => this.toolOnCurrent('meta') },
    ]);
  }

  async toolOnCurrent(id) {
    const v = this.active; if (!v) return;
    const b = busy('Préparation…');
    try {
      const bytes = await buildAnnotatedPdf(v, { embed: false });
      b.done();
      openTool(this, id, [new File([bytes], v.name, { type: 'application/pdf' })]);
    } catch (e) { b.done(); toast('Impossible de préparer le document : ' + e.message, 'error'); }
  }

  // --- Accueil -----------------------------------------------------------------
  async showHome() {
    this.active?.el.classList.add('hidden');
    this.active = null;
    this.updateTabs();
    this.home?.remove();
    const drop = el('div', { class: 'drop hero' },
      el('img', { src: 'icons/logo.svg', class: 'hero-logo', alt: '' }),
      el('h1', {}, 'Ouvrez un PDF pour le lire, l\'annoter, le signer…'),
      el('p', { class: 'muted' }, 'Déposez un fichier ici ou choisissez-le. Tout reste sur votre appareil.'),
      el('div', { class: 'row center' },
        el('button', { class: 'btn primary', onclick: () => this.openDialog() }, icon('open', 18), ' Ouvrir un PDF'),
        el('button', { class: 'btn', onclick: () => openTool(this, 'blank') }, icon('blank', 18), ' Nouveau cahier de notes')));
    const recents = el('section', { class: 'home-sec' });
    const tools = el('section', { class: 'home-sec' }, el('h2', {}, 'Outils PDF'));
    const cats = [...new Set(TOOLS.map(t => t.cat))];
    for (const c of cats) {
      tools.append(el('h3', { class: 'cat' }, c), el('div', { class: 'tool-grid' }, TOOLS.filter(t => t.cat === c).map(t =>
        el('button', { class: 'tool-card', onclick: () => openTool(this, t.id) },
          el('span', { class: 'tool-ic' }, icon(t.icon, 22)),
          el('span', { class: 'tool-t' }, t.title), el('span', { class: 'tool-d' }, t.desc)))));
    }
    tools.append(el('h3', { class: 'cat' }, 'Signatures'), el('div', { class: 'tool-grid' },
      el('button', { class: 'tool-card', onclick: () => signs.pick() }, el('span', { class: 'tool-ic' }, icon('sign', 22)), el('span', { class: 'tool-t' }, 'Mes signatures et tampons'), el('span', { class: 'tool-d' }, 'Créer, importer et gérer vos signatures et cachets.'))));
    this.home = el('div', { class: 'home' }, el('div', { class: 'home-inner' }, drop, recents, tools));
    this.main.append(this.home);
    this.bindDrop(drop);

    const list = await listRecents();
    if (list.length) {
      recents.append(el('div', { class: 'row' }, el('h2', { class: 'grow' }, 'Récents'),
        el('button', { class: 'linklike small', onclick: async () => { for (const r of list) await idb.del('recents', r.key); this.showHome(); } }, 'Effacer la liste')));
      recents.append(el('div', { class: 'recent-grid' }, list.map(({ key, value: r }) => el('button', { class: 'recent', onclick: () => this.openRecent(key, r) },
        el('span', { class: 'recent-ic' }, icon('pages', 22)),
        el('span', { class: 'recent-t' }, baseName(r.name)),
        el('span', { class: 'recent-d muted small' }, [r.pages ? r.pages + ' p.' : '', fmtSize(r.size || 0), r.lastPage ? 'p. ' + (r.lastPage + 1) : '', new Date(r.at).toLocaleDateString('fr-FR')].filter(Boolean).join(' · '))))));
    }
  }

  // --- Ouverture -----------------------------------------------------------------
  async openDialog() {
    if (window.showOpenFilePicker) {
      try {
        const handles = await showOpenFilePicker({ multiple: true, types: [{ description: 'Documents PDF', accept: { 'application/pdf': ['.pdf'] } }] });
        for (const h of handles) await this.openFile(await h.getFile(), h);
      } catch (e) { if (e.name !== 'AbortError') console.warn(e); }
      return;
    }
    for (const f of await pickFiles('application/pdf,.pdf', true)) await this.openFile(f);
  }

  async openFile(file, handle) {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      if (file.type.startsWith('image/')) { openTool(this, 'img2pdf', [file]); return; }
      toast(`« ${file.name} » n'est pas un PDF.`, 'error'); return;
    }
    await this.openBytes(new Uint8Array(await file.arrayBuffer()), file.name, handle);
  }

  async openRecent(key, r) {
    try {
      if (r.handle) {
        let perm = await r.handle.queryPermission?.({ mode: 'read' });
        if (perm !== 'granted') perm = await r.handle.requestPermission?.({ mode: 'read' });
        if (perm === 'granted' || perm === undefined) return this.openFile(await r.handle.getFile(), r.handle);
      }
      if (r.bytes) return this.openBytes(new Uint8Array(r.bytes), r.name);
      toast('Ce fichier n\'est plus accessible. Ouvrez-le à nouveau.', 'error');
    } catch (e) { toast('Impossible d\'ouvrir ce fichier : ' + e.message, 'error'); }
  }

  async openBytes(bytes, name, handle) {
    const b = busy(`Ouverture de « ${name} »…`);
    try {
      const v = new DocView(this, { name, bytes, handle });
      // Le document doit être visible pendant l'ouverture pour calculer le zoom.
      this.home?.classList.add('hidden');
      for (const d of this.docs) d.el.classList.add('hidden');
      this.main.append(v.el);
      try { await v.open(); }
      catch (e) {
        v.el.remove();
        if (this.active) this.active.el.classList.remove('hidden'); else this.home?.classList.remove('hidden');
        throw e;
      }
      this.docs.push(v);
      this.activate(v);
      addRecent({ key: v.key, name, size: bytes.length, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), handle, pages: v.count });
    } catch (e) {
      console.error(e);
      toast(e?.name === 'PasswordException' ? 'Mot de passe requis ou incorrect.' : `Impossible d'ouvrir « ${name} » : ${e.message || e}`, 'error', 6000);
    }
    b.done();
  }

  activate(v) {
    this.home?.remove(); this.home = null;
    for (const d of this.docs) d.el.classList.toggle('hidden', d !== v);
    this.active = v;
    document.title = `${baseName(v.name)} — ${APP_NAME}`;
    this.updateTabs();
    requestAnimationFrame(() => { for (const pg of v.pages) if (pg.visible) v.renderPage(pg.i); });
  }

  async close(v) {
    if (v.dirty) {
      const ok = await confirmBox('Fermer le document',
        `Les annotations de « ${v.name} » ne sont pas encore enregistrées dans le fichier. Elles restent conservées sur cet appareil et réapparaîtront à la prochaine ouverture. Fermer quand même ?`, 'Fermer');
      if (!ok) return;
    }
    v.destroy();
    this.docs = this.docs.filter(d => d !== v);
    if (this.active === v) {
      if (this.docs.length) this.activate(this.docs[this.docs.length - 1]);
      else { document.title = APP_NAME; this.showHome(); }
    } else this.updateTabs();
  }

  recentKey(v) { return v.key; }
  addReadTime(v, ms) { idb.get('recents', v.key).then(r => r && patchRecent(v.key, { readMs: (r.readMs || 0) + ms })); }

  // --- Enregistrement -----------------------------------------------------------
  async save(v, as = false) {
    if (!v) return;
    const b = busy('Enregistrement…');
    let bytes;
    try {
      bytes = await buildAnnotatedPdf(v, { onProgress: (i, n) => b.set(`Enregistrement… page ${i + 1} / ${n}`) });
    } catch (e) { b.done(); console.error(e); toast('Échec de l\'enregistrement : ' + e.message, 'error', 6000); return; }
    b.done();
    try {
      let handle = !as ? v.handle : null;
      if (handle?.createWritable) {
        let perm = await handle.queryPermission?.({ mode: 'readwrite' });
        if (perm !== 'granted') perm = await handle.requestPermission?.({ mode: 'readwrite' });
        if (perm !== 'granted') handle = null;
      } else handle = null;
      if (!handle && window.showSaveFilePicker) {
        handle = await showSaveFilePicker({ suggestedName: as ? baseName(v.name) + '_annoté.pdf' : v.name, types: [{ description: 'Document PDF', accept: { 'application/pdf': ['.pdf'] } }] });
      }
      if (handle) {
        const w = await handle.createWritable();
        await w.write(bytes); await w.close();
        v.handle = handle; v.name = handle.name;
        addRecent({ key: v.key, name: v.name, size: bytes.length, handle, pages: v.count });
      } else downloadBlob(new Blob([bytes], { type: 'application/pdf' }), v.name);
      v.dirty = false;
      this.updateTabs();
      toast(`Enregistré (${fmtSize(bytes.length)}). Les annotations restent modifiables à la réouverture dans ${APP_NAME}.`, 'info', 4500);
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.error(e);
      toast('Échec de l\'écriture du fichier : ' + e.message + '. Le document va être téléchargé à la place.', 'error', 6000);
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), v.name);
    }
  }

  async print(v) {
    if (!v) return;
    const b = busy('Préparation de l\'impression…');
    try { await printDoc(v, (i, n) => b.set(`Préparation… page ${i + 1} / ${n}`)); }
    catch (e) { toast('Impression impossible : ' + e.message, 'error'); }
    b.done();
  }

  async exportImages(v) {
    const b = busy('Export des images…');
    try {
      const files = [];
      for (let i = 0; i < v.count; i++) {
        b.set(`Page ${i + 1} / ${v.count}…`);
        const c = await renderAnnotatedPage(v, i, 150 / 72);
        files.push({ name: `${baseName(v.name)}_p${String(i + 1).padStart(3, '0')}.jpg`, data: await canvasToBytes(c, 'image/jpeg', 0.9) });
        c.width = c.height = 0;
      }
      if (files.length === 1) downloadBlob(new Blob([files[0].data], { type: 'image/jpeg' }), files[0].name);
      else downloadBlob(makeZip(files), baseName(v.name) + '_images.zip');
    } catch (e) { toast('Export impossible : ' + e.message, 'error'); }
    b.done();
  }

  // --- Réglages -----------------------------------------------------------------------
  openSettings(section) {
    const s = getSettings();
    const sel = (key, opts) => { const x = el('select', { class: 'input', onchange: () => setSetting(key, x.value) }); for (const [v, l] of opts) { const o = el('option', {}, l); o.value = v; o.selected = s[key] === v; x.append(o); } return x; };
    const chk = (key, label) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: s[key], onchange: (e) => setSetting(key, e.target.checked) }), ' ' + label);
    const range = (key, min, max, step) => el('input', { type: 'range', min, max, step, value: s[key], oninput: (e) => setSetting(key, +e.target.value) });
    const f = (label, input, hint) => el('label', { class: 'field' }, el('span', {}, label), input, hint ? el('small', { class: 'muted' }, hint) : null);
    const key = el('input', { class: 'input', type: 'password', value: s.claudeKey, placeholder: 'sk-ant-…', autocomplete: 'off', onchange: (e) => setSetting('claudeKey', e.target.value.trim()) });
    const installBtn = this.installEvt ? el('button', { class: 'btn primary', onclick: async () => { this.installEvt.prompt(); this.installEvt = null; } }, icon('download', 16), ` Installer ${APP_NAME} sur cet appareil`) : null;
    const body = el('div', { class: 'settings' },
      el('h3', {}, 'Apparence'),
      f('Thème', sel('theme', [['dark', 'Sombre'], ['light', 'Clair'], ['system', 'Comme le système']])),
      el('h3', {}, 'Stylet et dessin'),
      chk('fingerDraw', 'Dessiner aussi au doigt (sinon le doigt fait défiler et zoomer)'),
      f('Sensibilité à la pression', range('pressureCurve', 0.4, 2.5, 0.05), 'À gauche : un appui léger donne déjà un trait épais. À droite : il faut appuyer davantage.'),
      f('Pression minimale ignorée', range('pressureMin', 0, 0.3, 0.01)),
      f('Lissage des traits', range('smoothing', 0, 0.95, 0.05)),
      chk('straighten', 'Rester immobile en fin de trait pour obtenir une ligne droite'),
      el('h3', { id: 'set-ia' }, 'Traduction, dictionnaire et IA'),
      el('div', { class: 'grid2' },
        f('Service de traduction', sel('translateEngine', [['google', 'Google Traduction (sans clé)'], ['mymemory', 'MyMemory (sans clé)'], ['claude', 'Claude (clé API)']])),
        f('Traduire vers', sel('translateTo', LANGS))),
      f('Dictionnaire', sel('dictLang', [['fr', 'Wiktionnaire français'], ['en', 'Wiktionary anglais']])),
      f('Clé API Anthropic (facultative)', key, 'Active « Expliquer », « Résumer la page », « Questions de révision » et la traduction par IA. Créez une clé sur console.anthropic.com. Elle reste sur cet appareil ; seul le texte que vous choisissez est envoyé.'),
      f('Modèle Claude', sel('claudeModel', [['claude-opus-5-5', 'Claude Opus 5.5 (recommandé)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (plus économique)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (le plus rapide et économique)']])),
      el('h3', {}, 'Étude'),
      el('div', { class: 'grid2' },
        f('Pomodoro : travail (min)', el('input', { class: 'input', type: 'number', min: 5, max: 120, value: s.pomodoroWork, onchange: (e) => setSetting('pomodoroWork', +e.target.value || 25) })),
        f('Pomodoro : pause (min)', el('input', { class: 'input', type: 'number', min: 1, max: 60, value: s.pomodoroBreak, onchange: (e) => setSetting('pomodoroBreak', +e.target.value || 5) }))),
      chk('eyeReminder', 'Rappel 20-20-20 pour reposer les yeux'),
      el('h3', {}, 'Application'),
      installBtn || el('p', { class: 'muted small' }, `Pour installer ${APP_NAME} comme une application : dans Edge ou Chrome, menu ⋯ → Applications → Installer. Sur Android : menu ⋮ → Ajouter à l'écran d'accueil.`),
      el('p', { class: 'muted small' }, `${APP_NAME} ${VERSION}. Affichage : pdf.js (Mozilla). Écriture : pdf-lib. Vos documents ne quittent jamais l'appareil, sauf le texte que vous envoyez vous-même à la traduction, au dictionnaire ou à l'IA.`),
      el('button', { class: 'btn small', onclick: async () => {
        if (!(await confirmBox('Effacer les données', 'Effacer les annotations conservées localement, la liste des récents et les réglages ? Les signatures sont conservées. Vos fichiers PDF ne sont pas touchés.', 'Effacer'))) return;
        for (const st of ['annots', 'recents', 'kv']) for (const r of await idb.all(st)) await idb.del(st, r.key);
        location.reload();
      } }, 'Effacer les données locales'));
    modal({ title: 'Réglages', body, wide: true });
    if (section === 'ia') setTimeout(() => document.getElementById('set-ia')?.scrollIntoView(), 50);
  }

  // --- Événements globaux --------------------------------------------------------------
  bindDrop(target) {
    target.addEventListener('dragover', (e) => { e.preventDefault(); target.classList.add('over'); });
    target.addEventListener('dragleave', () => target.classList.remove('over'));
    target.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); target.classList.remove('over'); this.dropFiles(e); });
  }
  async dropFiles(e) {
    const items = [...(e.dataTransfer.items || [])];
    if (items.length && items[0].getAsFileSystemHandle) {
      for (const it of items) {
        if (it.kind !== 'file') continue;
        const h = await it.getAsFileSystemHandle().catch(() => null);
        if (h?.kind === 'file') await this.openFile(await h.getFile(), h);
      }
      return;
    }
    for (const f of e.dataTransfer.files) await this.openFile(f);
  }

  bindGlobal() {
    document.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    document.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) { e.preventDefault(); this.dropFiles(e); } });
    document.addEventListener('folio:settings', (e) => this.openSettings(e.detail));
    window.addEventListener('beforeunload', (e) => { if (this.docs.some(d => d.dirty)) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.installEvt = e; });
    document.addEventListener('keydown', (e) => {
      const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
      const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (mod && k === 'o') { e.preventDefault(); this.openDialog(); return; }
      if (mod && k === 's') { e.preventDefault(); this.save(this.active, e.shiftKey); return; }
      if (mod && k === 'p' && this.active) { e.preventDefault(); this.print(this.active); return; }
      if (mod && k === 'f' && this.active) { e.preventDefault(); this.active.showSide('search'); return; }
      if (mod && k === 'w' && this.active) { e.preventDefault(); this.close(this.active); return; }
      if (k === 'escape' && document.body.classList.contains('focus')) { this.study.toggleFocus(); return; }
      if (typing || !this.active) return;
      if (this.active.annotator.handleKey(e)) return;
      const v = this.active;
      if (mod && (k === '=' || k === '+')) { e.preventDefault(); v.setZoom(v.zoom * 1.2); }
      else if (mod && k === '-') { e.preventDefault(); v.setZoom(v.zoom / 1.2); }
      else if (mod && k === '0') { e.preventDefault(); v.fitWidth(); }
      else if (k === 'pagedown' || (k === 'arrowright' && !mod)) { if (k === 'arrowright') { e.preventDefault(); v.goto(v.current + 1); } }
      else if (k === 'arrowleft' && !mod) { e.preventDefault(); v.goto(v.current - 1); }
      else if (k === 'home' && mod) v.goto(0);
      else if (k === 'end' && mod) v.goto(v.count - 1);
    });
  }

  registerSW() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Ouverture via « Ouvrir avec Folio » (application installée).
  handleLaunchQueue() {
    // « Partager → Folio » (Android) : fichiers déposés par le service worker.
    this.checkShared();
    if (!('launchQueue' in window)) return;
    window.launchQueue.setConsumer(async (params) => {
      for (const h of params.files || []) await this.openFile(await h.getFile(), h);
      if (params.targetURL && /[?&]shared=/.test(params.targetURL)) this.checkShared();
    });
  }

  async checkShared() {
    if (!('caches' in window) || this._sharing) return;
    this._sharing = true;
    try {
      const cache = await caches.open('folio-share');
      const keys = await cache.keys();
      for (const req of keys) {
        const res = await cache.match(req);
        if (!res) continue;
        if (res.headers.get('X-Link')) {
          await cache.delete(req);
          const link = (await res.text()).trim();
          toast(link
            ? 'Un lien a été partagé, pas le fichier. Dans Google Drive, utilisez ⋮ → « Envoyer une copie » puis Folio.'
            : 'Aucun fichier reçu.', 'error', 8000);
          continue;
        }
        const name = decodeURIComponent(res.headers.get('X-Name') || 'document.pdf');
        const blob = await res.blob();
        await this.openFile(new File([blob], name, { type: res.headers.get('Content-Type') || blob.type }));
        await cache.delete(req); // seulement une fois ouvert : rien ne se perd si la page change entre-temps
      }
    } catch (e) { toast('Impossible d\'ouvrir le fichier partagé : ' + e.message, 'error'); }
    finally {
      this._sharing = false;
      if (/[?&]shared=/.test(location.search)) history.replaceState(null, '', location.pathname);
    }
  }
}

const app = new App();
window.folio = app;
app.start();
