// Moteur d'encre : types de stylos, épaisseur selon la pression, l'inclinaison,
// la direction et la vitesse, contour vectoriel du trait (réutilisé à l'export PDF).
//
// Un trait est stocké en coordonnées PDF (points, origine en bas à gauche) :
//   { type:'ink', id, pen, color, width, opacity, pts:[x,y,p,t, x,y,p,t, ...] }
// p = pression normalisée 0..1, t = inclinaison 0 (stylet vertical) .. 1 (couché).

export const PENS = {
  bic:      { label: 'Bic',          icon: 'ballpen',     width: 1.1, color: '#1f3fae', opacity: 1 },
  plume:    { label: 'Stylo plume',  icon: 'fountain',    width: 2.0, color: '#14204f', opacity: 1 },
  feutre:   { label: 'Feutre',       icon: 'marker',      width: 2.4, color: '#222222', opacity: 1 },
  marqueur: { label: 'Marqueur',     icon: 'marker',      width: 6.0, color: '#c0392b', opacity: 0.95 },
  crayon:   { label: 'Crayon',       icon: 'pencil',      width: 1.6, color: '#3b3b3b', opacity: 0.9 },
  pinceau:  { label: 'Pinceau',      icon: 'brush',       width: 7.0, color: '#1b1b1b', opacity: 1 },
  fluo:     { label: 'Surligneur',   icon: 'highlighter', width: 14,  color: '#ffe14d', opacity: 0.5 },
};

export const PEN_ORDER = ['bic', 'plume', 'feutre', 'marqueur', 'crayon', 'pinceau', 'fluo'];

export const SWATCHES = {
  ink: ['#1b1b1b', '#1f3fae', '#14204f', '#c0392b', '#1e8449', '#7d3c98', '#e67e22', '#7f8c8d', '#ffffff'],
  fluo: ['#ffe14d', '#9cf26b', '#61d4ff', '#ff8fd1', '#ffb347', '#c39bff'],
};

let uid = Date.now() % 1e6;
export const newId = () => (++uid).toString(36) + Math.random().toString(36).slice(2, 6);

// Épaisseur (en pt) au point i.
export function widthAt(s, i, n, pts) {
  const base = s.width;
  const p = pts[i * 4 + 2], t = pts[i * 4 + 3];
  switch (s.pen) {
    case 'bic': return base * (0.6 + 0.8 * p);
    case 'feutre': return base * (0.65 + 0.7 * p);
    case 'marqueur': return base * (0.7 + 0.6 * p);
    case 'fluo': return base;
    case 'crayon': return base * (0.7 + 0.6 * p) * (1 + 2.2 * t);
    case 'plume': {
      // Bec biseauté à 40° : trait fin dans l'axe du bec, épais en travers.
      const j0 = Math.max(0, i - 1), j1 = Math.min(n - 1, i + 1);
      const dx = pts[j1 * 4] - pts[j0 * 4], dy = pts[j1 * 4 + 1] - pts[j0 * 4 + 1];
      const a = Math.atan2(dy, dx), nib = 40 * Math.PI / 180;
      const f = 0.22 + 0.78 * Math.abs(Math.sin(a - nib));
      return base * f * (0.45 + 1.1 * p);
    }
    case 'pinceau': {
      // L'amorce et la fin effilées sont appliquées dans buildOutline (selon la longueur).
      return Math.max(base * (0.08 + 1.5 * Math.pow(p, 1.25)), base * 0.05);
    }
    default: return base;
  }
}

// Contour du trait en coordonnées « SVG » (x, -y) en pt. Mis en cache.
const outlineCache = new WeakMap();
export function outlinePath(s) {
  let c = outlineCache.get(s);
  if (c && c.n === s.pts.length && c.w === s.width) return c.d;
  const d = buildOutline(s);
  outlineCache.set(s, { d, n: s.pts.length, w: s.width });
  return d;
}
export function invalidate(s) { outlineCache.delete(s); bboxCache.delete(s); }

const f2 = (v) => Math.round(v * 100) / 100;

function buildOutline(s) {
  const pts = s.pts, n = pts.length / 4;
  if (n === 0) return '';
  const X = (i) => pts[i * 4], Y = (i) => -pts[i * 4 + 1];
  const W = [];
  for (let i = 0; i < n; i++) W.push(widthAt(s, i, n, pts) / 2);
  // Lissage léger des largeurs pour éviter les à-coups.
  if (n > 2) for (let k = 0; k < 2; k++) for (let i = 1; i < n - 1; i++) W[i] = (W[i - 1] + 2 * W[i] + W[i + 1]) / 4;
  if (s.pen === 'pinceau' && n > 2) {
    const D = [0];
    for (let i = 1; i < n; i++) D.push(D[i - 1] + Math.hypot(X(i) - X(i - 1), Y(i) - Y(i - 1)));
    const total = D[n - 1], taper = Math.min(s.width * 2, total / 3);
    if (taper > 0) for (let i = 0; i < n; i++) {
      const d = Math.min(D[i], total - D[i]);
      W[i] *= 0.35 + 0.65 * Math.min(1, d / taper);
    }
  }

  if (n === 1 || (n === 2 && Math.hypot(X(1) - X(0), Y(1) - Y(0)) < 0.01)) {
    const r = Math.max(W[0], 0.2), x = X(0), y = Y(0);
    return `M${f2(x - r)} ${f2(y)}A${f2(r)} ${f2(r)} 0 1 0 ${f2(x + r)} ${f2(y)}A${f2(r)} ${f2(r)} 0 1 0 ${f2(x - r)} ${f2(y)}Z`;
  }
  const L = [], R = [], T = [];
  for (let i = 0; i < n; i++) {
    // Tangente sur un voisinage un peu plus large aux extrémités (moins de bruit).
    const span = i === 0 || i === n - 1 ? 2 : 1;
    const a = Math.max(0, i - span), b = Math.min(n - 1, i + span);
    let tx = X(b) - X(a), ty = Y(b) - Y(a);
    const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
    const nx = -ty, ny = tx, w = W[i];
    T.push([tx, ty]);
    L.push([X(i) + nx * w, Y(i) + ny * w]);
    R.push([X(i) - nx * w, Y(i) - ny * w]);
  }
  // Bout arrondi : demi-cercle tracé point par point (indépendant du sens des axes).
  const cap = (i, forward) => {
    const [tx, ty] = T[i], sgn = forward ? 1 : -1;
    const nx = -ty * sgn, ny = tx * sgn, w = W[i];
    let s = '';
    for (let k = 1; k <= 8; k++) {
      const th = (k / 8) * Math.PI, c = Math.cos(th), sn = Math.sin(th);
      s += `L${f2(X(i) + w * (nx * c + tx * sgn * sn))} ${f2(Y(i) + w * (ny * c + ty * sgn * sn))}`;
    }
    return s;
  };
  const flat = s.pen === 'fluo';
  let d = `M${f2(L[0][0])} ${f2(L[0][1])}`;
  const curve = (arr) => {
    for (let i = 1; i < arr.length - 1; i++) {
      const mx = (arr[i][0] + arr[i + 1][0]) / 2, my = (arr[i][1] + arr[i + 1][1]) / 2;
      d += `Q${f2(arr[i][0])} ${f2(arr[i][1])} ${f2(mx)} ${f2(my)}`;
    }
    const last = arr[arr.length - 1];
    d += `L${f2(last[0])} ${f2(last[1])}`;
  };
  curve(L);
  const re = R[n - 1];
  d += flat ? `L${f2(re[0])} ${f2(re[1])}` : cap(n - 1, true);
  curve(R.slice().reverse());
  d += flat ? 'Z' : cap(0, false) + 'Z';
  return d;
}

// Boîte englobante en coordonnées PDF.
const bboxCache = new WeakMap();
export function strokeBBox(s) {
  let b = bboxCache.get(s);
  if (b && b.n === s.pts.length) return b;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < s.pts.length; i += 4) {
    const x = s.pts[i], y = s.pts[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const m = s.width * 2;
  b = { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m, n: s.pts.length };
  bboxCache.set(s, b);
  return b;
}

// --- Rendu canvas ---------------------------------------------------------
// ctx doit avoir pour transformation : PDF -> pixels (viewport.transform × dpr).
function rng(seed) { let x = seed | 0 || 1; return () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); }
function hashId(id) { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }

export function drawStroke(ctx, s, { selected = false } = {}) {
  if (!s.pts.length) return;
  ctx.save();
  if (s.pen === 'crayon') drawPencil(ctx, s);
  else {
    ctx.transform(1, 0, 0, -1, 0, 0);
    const path = new Path2D(outlinePath(s));
    ctx.globalAlpha = s.opacity ?? 1;
    ctx.fillStyle = s.color;
    ctx.fill(path, 'nonzero');
    if (selected) { ctx.globalAlpha = 1; ctx.strokeStyle = '#F5A623'; ctx.lineWidth = 1.2 / Math.abs(ctx.getTransform().a || 1); ctx.setLineDash([4, 3]); ctx.stroke(path); }
  }
  ctx.restore();
  if (selected && s.pen === 'crayon') { const b = strokeBBox(s); ctx.save(); ctx.strokeStyle = '#F5A623'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.restore(); }
}

// Crayon : grain de graphite obtenu par de petits dépôts aléatoires.
function drawPencil(ctx, s) {
  const pts = s.pts, n = pts.length / 4, rand = rng(hashId(s.id));
  ctx.fillStyle = s.color;
  const tr = ctx.getTransform();
  const pxPerPt = Math.hypot(tr.a, tr.b) || 1;
  const dot = 0.9 / pxPerPt; // ~1 px de grain
  for (let i = 0; i < n; i++) {
    const x0 = pts[i * 4], y0 = pts[i * 4 + 1];
    const x1 = i + 1 < n ? pts[(i + 1) * 4] : x0, y1 = i + 1 < n ? pts[(i + 1) * 4 + 1] : y0;
    const p = pts[i * 4 + 2];
    const w = widthAt(s, i, n, pts) / 2;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / Math.max(w * 0.5, dot)));
    const alpha = (s.opacity ?? 0.9) * (0.25 + 0.75 * p);
    const density = Math.max(3, Math.round(w * w * pxPerPt * pxPerPt * 0.9));
    for (let k = 0; k < steps; k++) {
      const cx = x0 + (x1 - x0) * (k / steps), cy = y0 + (y1 - y0) * (k / steps);
      for (let j = 0; j < Math.min(density, 40); j++) {
        const ang = rand() * 6.283, rr = Math.sqrt(rand()) * w;
        ctx.globalAlpha = alpha * (0.35 + 0.65 * rand());
        ctx.fillRect(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, dot, dot);
      }
    }
  }
}

// --- Géométrie : gomme, lasso ---------------------------------------------
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function strokeHit(s, x, y, r) {
  const b = strokeBBox(s);
  if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) return false;
  const pts = s.pts, n = pts.length / 4;
  if (n === 1) return Math.hypot(pts[0] - x, pts[1] - y) <= r + s.width / 2;
  for (let i = 0; i < n - 1; i++) {
    const w = widthAt(s, i, n, pts) / 2;
    if (distSeg(x, y, pts[i * 4], pts[i * 4 + 1], pts[i * 4 + 4], pts[i * 4 + 5]) <= r + w) return true;
  }
  return false;
}

// Gomme précise : retire les points dans le rayon et découpe le trait.
export function eraseFromStroke(s, x, y, r) {
  const pts = resample(s.pts, Math.max(0.3, r / 3)), n = pts.length / 4, parts = [];
  let cur = [];
  let changed = false;
  for (let i = 0; i < n; i++) {
    const inside = Math.hypot(pts[i * 4] - x, pts[i * 4 + 1] - y) <= r + widthAt(s, i, n, pts) / 2;
    if (inside) { changed = true; if (cur.length) { parts.push(cur); cur = []; } }
    else cur.push(pts[i * 4], pts[i * 4 + 1], pts[i * 4 + 2], pts[i * 4 + 3]);
  }
  if (cur.length) parts.push(cur);
  if (!changed) return null;
  return parts.filter(p => p.length >= 8).map(p => ({ ...s, id: newId(), pts: simplify(p, 0.05) }));
}

// Ajoute des points intermédiaires sur les segments longs (un trait simplifié peut
// n'avoir que deux points : la gomme précise doit pouvoir le couper au milieu).
function resample(pts, step) {
  const out = [];
  const n = pts.length / 4;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    out.push(pts[j], pts[j + 1], pts[j + 2], pts[j + 3]);
    if (i === n - 1) break;
    const dx = pts[j + 4] - pts[j], dy = pts[j + 5] - pts[j + 1];
    const k = Math.floor(Math.hypot(dx, dy) / step);
    for (let m = 1; m < k; m++) {
      const t = m / k;
      out.push(pts[j] + dx * t, pts[j + 1] + dy * t, pts[j + 2] + (pts[j + 6] - pts[j + 2]) * t, pts[j + 3] + (pts[j + 7] - pts[j + 3]) * t);
    }
  }
  return out;
}

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function strokeInPoly(s, poly) {
  const n = s.pts.length / 4;
  let inside = 0;
  for (let i = 0; i < n; i++) if (pointInPoly(s.pts[i * 4], s.pts[i * 4 + 1], poly)) inside++;
  return inside / n > 0.6;
}

export function translateStroke(s, dx, dy) {
  for (let i = 0; i < s.pts.length; i += 4) { s.pts[i] += dx; s.pts[i + 1] += dy; }
  invalidate(s);
}

// --- Capture : lissage et pression ----------------------------------------
export function mapPressure(e, settings) {
  if (e.pointerType === 'mouse') return 0.5;
  let p = e.pressure;
  if (!p && e.pointerType === 'touch') p = 0.5;
  const m = settings.pressureMin || 0;
  p = Math.max(0, (p - m) / (1 - m));
  return Math.min(1, Math.pow(p, settings.pressureCurve || 1));
}

export function tiltOf(e) {
  if (e.pointerType !== 'pen') return 0;
  if (typeof e.altitudeAngle === 'number' && e.altitudeAngle > 0) return Math.max(0, 1 - e.altitudeAngle / (Math.PI / 2));
  const tx = e.tiltX || 0, ty = e.tiltY || 0;
  return Math.min(1, Math.hypot(tx, ty) / 90);
}

// Simplifie un trait (réduit le nombre de points sans changer la forme).
export function simplify(pts, tol = 0.15) {
  const n = pts.length / 4;
  if (n < 3) return pts;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distSeg(pts[i * 4], pts[i * 4 + 1], pts[a * 4], pts[a * 4 + 1], pts[b * 4], pts[b * 4 + 1]);
      const dp = Math.abs(pts[i * 4 + 2] - (pts[a * 4 + 2] + pts[b * 4 + 2]) / 2);
      const score = d + dp * 0.6;
      if (score > md) { md = score; mi = i; }
    }
    if (md > tol && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(f2(pts[i * 4]), f2(pts[i * 4 + 1]), Math.round(pts[i * 4 + 2] * 1000) / 1000, Math.round(pts[i * 4 + 3] * 100) / 100);
  return out;
}

// Points intermédiaires d'un mouvement (jusqu'à 240 Hz avec un stylet).
export function coalesced(e) {
  const c = e.getCoalescedEvents?.();
  return c && c.length ? c : [e];
}
