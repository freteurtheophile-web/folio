// Petits utilitaires d'interface : création d'éléments, icônes, toasts, fenêtres.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;
    else if (k in n && typeof v !== 'string') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

// Jeu d'icônes au trait (24×24, trait arrondi), dessinées pour l'app.
const P = {
  open: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  save: 'M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 3v6h9V3M7 21v-7h10v7',
  download: 'M12 3v12m-5-5 5 5 5-5M4 21h16',
  print: 'M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z',
  home: 'M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  cursor: 'M5 3l14 7-6 2-2 6z',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-6.5a1.5 1.5 0 0 1 3 0V12m0-5a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L3.5 14a1.5 1.5 0 0 1 2.5-1.6L8 15',
  textsel: 'M5 4h14M12 4v16M8 20h8',
  ballpen: 'M16 3l5 5L9 20l-6 1 1-6zM14 5l5 5',
  fountain: 'M12 2c3 3 5 6 5 9l-5 11-5-11c0-3 2-6 5-9zM12 11v3M12 22v0',
  marker: 'M9 15l-4 4v2h4l4-4M9 15l8-8 4 4-8 8zM14 6l4 4',
  pencil: 'M4 20l2-6L16 4l4 4L10 18zM14 6l4 4M4 20l4-1',
  brush: 'M18 3l3 3-9 9-3-3zM9 12c-3 0-5 2-5 5 0 1-1 2-2 2 2 2 6 2 8 0 1.5-1.5 2-3 2-4',
  highlighter: 'M15 4l5 5-8 8H7v-5zM7 17l-3 3h6M12 7l5 5',
  laser: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  eraser: 'M8 20h12M4 15l9-9a2 2 0 0 1 3 0l3 3a2 2 0 0 1 0 3l-8 8H8z',
  lasso: 'M7 18c-3-1-5-3-5-6 0-4 4.5-7 10-7s10 3 10 7-4.5 7-10 7c-1 0-2 0-3-.3M7 18a2 2 0 1 0 2 2c0-1-1-2-2-2zm0 0c0 2-1 4-3 4',
  textbox: 'M4 6V4h16v2M12 4v16M9 20h6',
  note: 'M5 3h14a2 2 0 0 1 2 2v10l-6 6H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 21v-6h7',
  shapes: 'M3 3h8v8H3zM17 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M7 14l4 7H3z',
  rect: 'M4 5h16v14H4z',
  ellipse: 'M12 12m-9 0a9 7 0 1 0 18 0a9 7 0 1 0-18 0',
  line: 'M5 19 19 5',
  arrow: 'M5 19 19 5M10 5h9v9',
  sign: 'M3 17c3-6 5-9 7-9s-1 9 1 9 3-4 4-4 1 3 3 3h3M3 21h18',
  stamp: 'M9 3h6v5l3 4H6l3-4zM4 14h16v4H4zM6 21h12',
  image: 'M4 4h16v16H4zM8.5 9.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M20 15l-5-5L5 20',
  underline: 'M7 4v7a5 5 0 0 0 10 0V4M5 21h14',
  strike: 'M4 12h16M16 6c-1-1.5-3-2-4.5-2C9 4 7.5 5.5 7.5 7.3c0 3 9 3 9 6.7 0 2-2 3.5-4.5 3.5-2 0-3.8-.8-4.8-2.4',
  search: 'M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M21 21l-5-5',
  zoomin: 'M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M21 21l-5-5M8 11h6M11 8v6',
  zoomout: 'M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M21 21l-5-5M8 11h6',
  fitw: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
  fitp: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  rotate: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  rotl: 'M4 11a8 8 0 1 1 2.3 5.7M4 4v7h7',
  pages: 'M8 3h10a2 2 0 0 1 2 2v12M6 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z',
  spread: 'M3 5h8v14H3zM13 5h8v14h-8z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  sidebar: 'M4 4h16v16H4zM9 4v16',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  sun: 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  timer: 'M12 13m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 9v4l2 2M9 2h6',
  ruler: 'M3 8h18v8H3zM7 8v3M11 8v4M15 8v3M19 8v4',
  focus: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4',
  translate: 'M4 5h8M8 3v2M10 5c0 4-3 7-6 8M6 9c1 2 3 3.5 5 4M13 21l4-10 4 10M14.5 18h5',
  book: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5zM4 21.5A2.5 2.5 0 0 1 6.5 19H20v3H6.5',
  roots: 'M12 15V9M12 9C12 5 9.5 3 6 3c0 3.5 2.5 6 6 6zM12 11c0-3.5 2.5-5.5 6-5.5 0 3.5-2.5 5.5-6 5.5zM12 15c0 3-2 5-5 6M12 15c0 3 2 5 5 6M12 15v6',
  speak: 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  merge: 'M8 3v5a4 4 0 0 0 4 4 4 4 0 0 1 4 4v5M16 3v5a4 4 0 0 1-4 4M5 18l3 3 3-3',
  split: 'M12 3v6M12 9l-6 6v6M12 9l6 6v6',
  compress: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7',
  organize: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  toimg: 'M4 4h16v16H4zM4 16l4-4 4 4 3-3 5 5M14 8h.01',
  fromimg: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 18v-6M9 15l3-3 3 3',
  watermark: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  numbers: 'M4 6h2v6M4 12h4M14 6h4l-4 6h4M5 18h14',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14',
  info: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 16v-5M12 8h.01',
  form: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h4',
  layers: 'M12 3 2 8l10 5 10-5zM2 16l10 5 10-5M2 12l10 5 10-5',
  nup: 'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z',
  text: 'M4 7V4h16v3M9 20h6M12 4v16',
  redact: 'M3 6h18v5H3zM3 14h12v4H3z',
  wrench: 'M14.7 6.3a4 4 0 0 0 5 5L22 14l-8 8-2.3-2.3a4 4 0 0 0-5-5L4 12l8-8z',
  compare: 'M9 3H4v18h5M15 3h5v18h-5M12 2v20',
  ocr: 'M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M8 9h8M8 12h8M8 15h5',
  sparkle: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM19 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
  check: 'M5 12l5 5L20 7',
  chevl: 'M15 18l-6-6 6-6',
  chevr: 'M9 18l6-6-6-6',
  chevd: 'M6 9l6 6 6-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  palette: 'M12 22a10 10 0 1 1 10-10c0 2-1.5 3-3.5 3H16a2 2 0 0 0-1.5 3.3A2 2 0 0 1 12 22zM7.5 10.5h.01M10.5 7h.01M15 7.5h.01',
  grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  blank: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h8',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  pin: 'M12 17v5M5 17h14l-2-4V5h1V3H6v2h1v8z',
  cards: 'M3 7h14v12H3zM7 7V4h14v12h-4',
};

export function icon(name, size = 20) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('class', 'ic');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', P[name] || P.info);
  s.append(p);
  return s;
}

export function btn(iconName, title, onclick, cls = '') {
  return el('button', { class: 'ibtn ' + cls, title, 'aria-label': title, onclick }, icon(iconName));
}

// --- Toasts ---------------------------------------------------------------
let toastHost;
export function toast(msg, type = 'info', ms = 3200) {
  if (!toastHost) { toastHost = el('div', { class: 'toasts' }); document.body.append(toastHost); }
  const t = el('div', { class: 'toast ' + type }, msg);
  toastHost.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
  return t;
}

// --- Fenêtres modales -----------------------------------------------------
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const back = el('div', { class: 'modal-back' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const box = el('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog' },
    el('div', { class: 'modal-head' }, el('h2', {}, title), btn('close', 'Fermer', close)),
    el('div', { class: 'modal-body' }, body),
    actions.length ? el('div', { class: 'modal-foot' }, actions.map(a =>
      el('button', { class: a.primary ? 'btn primary' : 'btn', onclick: async () => {
        const r = await a.onClick?.();
        if (r !== false) close();
      } }, a.label))) : null);
  back.append(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  return { close, box };
}

export function confirmBox(title, text, okLabel = 'Confirmer') {
  return new Promise((res) => {
    let done = false;
    modal({ title, body: el('p', {}, text), onClose: () => { if (!done) res(false); },
      actions: [{ label: 'Annuler', onClick: () => { done = true; res(false); } },
                { label: okLabel, primary: true, onClick: () => { done = true; res(true); } }] });
  });
}

export function promptBox(title, label, value = '') {
  return new Promise((res) => {
    let done = false;
    const input = el('input', { class: 'input', value });
    modal({ title, body: el('label', { class: 'field' }, el('span', {}, label), input),
      onClose: () => { if (!done) res(null); },
      actions: [{ label: 'Annuler', onClick: () => { done = true; res(null); } },
                { label: 'OK', primary: true, onClick: () => { done = true; res(input.value); } }] });
    setTimeout(() => { input.focus(); input.select(); }, 30);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { done = true; res(input.value); input.closest('.modal-back')?.remove(); } });
  });
}

// --- Menus contextuels ----------------------------------------------------
export function popMenu(anchor, items) {
  document.querySelector('.popmenu')?.remove();
  const m = el('div', { class: 'popmenu' }, items.map(it => it === '-' ? el('hr') :
    el('button', { class: 'popitem', onclick: () => { m.remove(); it.onClick(); } },
      it.icon ? icon(it.icon, 18) : null, el('span', {}, it.label))));
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.left)) + 'px';
  m.style.top = (r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', function h(e) {
    if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', h); }
  }), 0);
  return m;
}

// --- Fichiers -------------------------------------------------------------
export function pickFiles(accept = 'application/pdf', multiple = false) {
  return new Promise((res) => {
    const i = el('input', { type: 'file', accept, multiple });
    i.addEventListener('change', () => res([...i.files]));
    i.click();
  });
}

export function downloadBlob(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}

export function fmtSize(n) {
  if (n < 1024) return n + ' o';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' Ko';
  return (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0).replace('.', ',') + ' Mo';
}

export function baseName(name) { return name.replace(/\.pdf$/i, ''); }

// Parse « 1-3, 5, 8-10 » en indices 0-based.
export function parseRanges(str, count) {
  const out = [];
  for (const part of String(str).split(/[,;]/)) {
    const p = part.trim(); if (!p) continue;
    const m = p.match(/^(\d+)?\s*-\s*(\d+)?$/);
    if (m) {
      const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : count;
      for (let i = Math.max(1, a); i <= Math.min(count, b); i++) out.push(i - 1);
    } else if (/^\d+$/.test(p)) { const n = +p; if (n >= 1 && n <= count) out.push(n - 1); }
  }
  return out;
}

export function busy(msg) {
  const b = el('div', { class: 'busy' }, el('div', { class: 'spinner' }), el('span', {}, msg));
  document.body.append(b);
  return { set: (m) => (b.lastChild.textContent = m), done: () => b.remove() };
}
