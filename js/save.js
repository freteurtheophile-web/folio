// Enregistrement : les annotations sont dessinées dans le PDF (visibles dans tous les
// lecteurs) et une copie modifiable est intégrée au fichier. À la réouverture dans
// Folio, le dessin est retiré et les annotations redeviennent modifiables.
import { PDFLib, loadLib, isEncrypted, renderPageToCanvas, canvasToBytes, CSS_UNITS } from './pdf.js';
import { outlinePath, drawStroke } from './ink.js';

const MARK = '/FolioData';

function findBytes(hay, needle) {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = hay.length - n.length; i >= 0; i--) {
    if (hay[i] !== n[0]) continue;
    for (let k = 1; k < n.length; k++) if (hay[i + k] !== n[k]) continue outer;
    return i;
  }
  return -1;
}

async function deflate(str) {
  const cs = new Blob([str]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(cs).arrayBuffer());
}
async function inflate(bytes) {
  const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return await new Response(ds).text();
}

const hex = (c) => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(c || '#000000');
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0, 0, 0];
};

// --- Relecture ---------------------------------------------------------------
export async function extractFolioData(bytes) {
  if (findBytes(bytes, MARK) < 0) return null;
  const L = await PDFLib();
  const doc = await loadLib(bytes);
  const key = L.PDFName.of('FolioData');
  const ref = doc.catalog.get(key);
  if (!ref) return null;
  const stream = doc.context.lookup(ref);
  const raw = stream.getContents ? stream.getContents() : stream.contents;
  const data = JSON.parse(await inflate(raw));
  const pages = doc.getPages();
  for (const [pi, num] of data.refs || []) {
    const contents = pages[pi]?.node.Contents();
    if (!(contents instanceof L.PDFArray)) continue;
    for (let k = contents.size() - 1; k >= 0; k--) {
      const r = contents.get(k);
      if (r instanceof L.PDFRef && r.objectNumber === num) contents.remove(k);
    }
  }
  pages.forEach((p, pi) => {
    const annots = p.node.Annots();
    if (annots) for (let k = annots.size() - 1; k >= 0; k--) {
      const d = doc.context.lookup(annots.get(k));
      if (d instanceof L.PDFDict && d.get(L.PDFName.of('FolioId'))) annots.remove(k);
    }
    if (data.origRot && data.origRot[pi] != null) p.setRotation(L.degrees(data.origRot[pi]));
  });
  doc.catalog.delete(key);
  const cleanBytes = await doc.save({ useObjectStreams: false });
  return { cleanBytes, data };
}

// --- Écriture ----------------------------------------------------------------
export async function buildAnnotatedPdf(view, { embed = true, onProgress } = {}) {
  if (isEncrypted(view.bytes)) return rasterExport(view, { onProgress });
  const L = await PDFLib();
  const doc = await loadLib(view.bytes);
  const pages = doc.getPages();
  const fonts = {};
  const font = async (name, bold) => {
    const key = name + (bold ? 'B' : '');
    const map = { Helvetica: bold ? 'HelveticaBold' : 'Helvetica', Times: bold ? 'TimesRomanBold' : 'TimesRoman', Courier: bold ? 'CourierBold' : 'Courier' };
    return (fonts[key] ??= await doc.embedFont(L.StandardFonts[map[name] || map.Helvetica]));
  };
  const images = new Map();
  const refs = [];
  const origRot = view.base.map(b => b.rot);

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const list = view.ann[i] || [];
    if (view.pageRot[i]) page.setRotation(L.degrees((origRot[i] + view.pageRot[i]) % 360));
    if (!list.length) continue;
    onProgress?.(i, pages.length);
    for (const a of list) {
      try { await drawAnn(L, doc, page, a, font, images); } catch (e) { console.warn('Annotation ignorée', a.type, e); }
    }
    if (page.contentStreamRef) refs.push([i, page.contentStreamRef.objectNumber, page.contentStreamRef.generationNumber]);
  }

  if (embed) {
    const json = JSON.stringify({ v: 1, app: 'Folio', ann: view.ann, pageRot: view.pageRot, origRot, bookmarks: view.bookmarks, refs });
    const z = await deflate(json);
    const stream = doc.context.stream(z, { Filter: 'FlateDecode', Type: 'FolioData' });
    doc.catalog.set(L.PDFName.of('FolioData'), doc.context.register(stream));
  }
  doc.setProducer('Folio');
  doc.setModificationDate(new Date());
  return await doc.save({ useObjectStreams: false });
}

function sanitizeFor(font, text) {
  let out = '';
  for (const ch of text) {
    if (ch === '\n') { out += ch; continue; }
    try { font.encodeText(ch); out += ch; }
    catch { out += ({ '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...', '–': '-', '—': '-', ' ': ' ' })[ch] ?? '?'; }
  }
  return out;
}

async function imageFor(doc, src, cache) {
  if (cache.has(src)) return cache.get(src);
  let img;
  if (src.startsWith('data:image/png')) img = await doc.embedPng(src);
  else if (src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg')) img = await doc.embedJpg(src);
  else {
    const im = new Image(); im.src = src; await im.decode();
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    c.getContext('2d').drawImage(im, 0, 0);
    img = await doc.embedPng(c.toDataURL('image/png'));
  }
  cache.set(src, img);
  return img;
}

function addTextAnnot(L, doc, page, x, y, text, color, id) {
  const ctx = doc.context;
  const d = ctx.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [x, y, x + 20, y + 20], Name: 'Comment', F: 4,
    C: hex(color), FolioId: id || 'note',
  });
  d.set(L.PDFName.of('Contents'), L.PDFHexString.fromText(text || ''));
  d.set(L.PDFName.of('T'), L.PDFHexString.fromText('Folio'));
  page.node.addAnnot(ctx.register(d));
}

async function drawAnn(L, doc, page, a, font, images) {
  const col = (c) => L.rgb(...hex(c));
  switch (a.type) {
    case 'ink': {
      const d = outlinePath(a);
      if (!d) return;
      page.drawSvgPath(d, {
        x: 0, y: 0, color: col(a.color), borderWidth: 0,
        opacity: a.pen === 'crayon' ? (a.opacity ?? 0.9) * 0.8 : (a.opacity ?? 1),
        blendMode: a.pen === 'fluo' ? L.BlendMode.Multiply : undefined,
      });
      break;
    }
    case 'markup':
      for (const [x0, y0, x1, y1] of a.rects) {
        const h = y1 - y0;
        if (a.kind === 'highlight') page.drawRectangle({ x: x0, y: y0, width: x1 - x0, height: h, color: col(a.color), opacity: 0.42, blendMode: L.BlendMode.Multiply });
        else {
          const y = a.kind === 'underline' ? y0 + h * 0.06 : y0 + h * 0.45;
          page.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness: Math.max(0.7, h * 0.07), color: col(a.color) });
        }
      }
      if (a.comment) { const r = a.rects[0]; addTextAnnot(L, doc, page, r[2], r[3] - 10, a.comment, a.color, a.id); }
      break;
    case 'shape': {
      const x = Math.min(a.x1, a.x2), y = Math.min(a.y1, a.y2), w = Math.abs(a.x2 - a.x1), h = Math.abs(a.y2 - a.y1);
      const o = { borderColor: col(a.color), borderWidth: a.width, color: a.fill ? col(a.fill) : undefined };
      if (a.kind === 'rect') page.drawRectangle({ x, y, width: w, height: h, ...o });
      else if (a.kind === 'ellipse') page.drawEllipse({ x: x + w / 2, y: y + h / 2, xScale: w / 2, yScale: h / 2, ...o });
      else {
        const ln = (sx, sy, ex, ey) => page.drawLine({ start: { x: sx, y: sy }, end: { x: ex, y: ey }, thickness: a.width, color: col(a.color), lineCap: L.LineCapStyle.Round });
        ln(a.x1, a.y1, a.x2, a.y2);
        if (a.kind === 'arrow') {
          const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), Lh = Math.max(6, a.width * 4);
          ln(a.x2, a.y2, a.x2 - Lh * Math.cos(ang - 0.45), a.y2 - Lh * Math.sin(ang - 0.45));
          ln(a.x2, a.y2, a.x2 - Lh * Math.cos(ang + 0.45), a.y2 - Lh * Math.sin(ang + 0.45));
        }
      }
      break;
    }
    case 'text': {
      if (!a.text?.trim()) return;
      const f = await font(a.font || 'Helvetica', a.bold);
      if (a.bg) page.drawRectangle({ x: a.x, y: a.y, width: a.w, height: a.h, color: col(a.bg) });
      const pad = 2;
      page.drawText(sanitizeFor(f, a.text), {
        x: a.x + pad, y: a.y + a.h - a.size - pad + a.size * 0.12, size: a.size, font: f, color: col(a.color),
        maxWidth: a.w - pad * 2, lineHeight: a.size * 1.2, wordBreaks: [' ', '-'],
      });
      break;
    }
    case 'note':
      addTextAnnot(L, doc, page, a.x, a.y, a.text, a.color, a.id);
      break;
    case 'image': {
      const img = await imageFor(doc, a.src, images);
      page.drawImage(img, { x: a.x, y: a.y, width: a.w, height: a.h });
      break;
    }
  }
}

// --- Rendu d'une page avec ses annotations dans un canvas (export image, impression,
// documents chiffrés) --------------------------------------------------------------
export async function renderAnnotatedPage(view, i, scale) {
  const page = await view.getPage(i);
  const rot = (view.base[i].rot + (view.pageRot[i] || 0)) % 360;
  const { canvas, viewport } = await renderPageToCanvas(page, scale, { rotation: rot });
  const ctx = canvas.getContext('2d');
  const list = view.ann[i] || [];
  // Surlignages en mode « produit », puis encre
  for (const pass of ['hl', 'ink']) {
    ctx.save();
    if (pass === 'hl') ctx.globalCompositeOperation = 'multiply';
    ctx.setTransform(...viewport.transform);
    for (const a of list) {
      const isHl = (a.type === 'ink' && a.pen === 'fluo') || (a.type === 'markup' && a.kind === 'highlight');
      if ((pass === 'hl') !== isHl) continue;
      if (a.type === 'ink' || a.type === 'markup' || a.type === 'shape') view.annotator.drawOne(ctx, a, false);
    }
    ctx.restore();
  }
  for (const a of list) {
    if (!['text', 'image', 'note'].includes(a.type)) continue;
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([a.x, a.y, a.x + a.w, a.y + a.h]);
    const L = Math.min(x1, x2), T = Math.min(y1, y2), W = Math.abs(x2 - x1), H = Math.abs(y2 - y1);
    if (a.type === 'image') {
      const im = new Image(); im.src = a.src; await im.decode().catch(() => {});
      ctx.drawImage(im, L, T, W, H);
    } else if (a.type === 'note') {
      ctx.fillStyle = a.color; ctx.fillRect(L, T, W, H);
      ctx.strokeStyle = '#0005'; ctx.strokeRect(L, T, W, H);
    } else {
      const fs = a.size * scale;
      if (a.bg) { ctx.fillStyle = a.bg; ctx.fillRect(L, T, W, H); }
      ctx.fillStyle = a.color;
      ctx.font = `${a.bold ? 700 : 400} ${fs}px ${a.font === 'Times' ? 'Georgia, serif' : a.font === 'Courier' ? 'Courier New, monospace' : 'Helvetica, Arial, sans-serif'}`;
      ctx.textBaseline = 'top';
      let y = T + 2 * scale;
      for (const para of a.text.split('\n')) {
        let line = '';
        for (const w of para.split(' ')) {
          const t = line ? line + ' ' + w : w;
          if (ctx.measureText(t).width > W - 4 * scale && line) { ctx.fillText(line, L + 2 * scale, y); y += fs * 1.2; line = w; }
          else line = t;
        }
        ctx.fillText(line, L + 2 * scale, y); y += fs * 1.2;
      }
    }
  }
  return canvas;
}

// Export par images (documents chiffrés que pdf-lib ne peut pas réécrire).
export async function rasterExport(view, { scale = 2, quality = 0.85, onProgress } = {}) {
  const L = await PDFLib();
  const out = await L.PDFDocument.create();
  for (let i = 0; i < view.count; i++) {
    onProgress?.(i, view.count);
    const c = await renderAnnotatedPage(view, i, scale);
    const img = await out.embedJpg(await canvasToBytes(c, 'image/jpeg', quality));
    const w = c.width / scale, h = c.height / scale;
    out.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    c.width = c.height = 0;
  }
  return await out.save();
}

// --- Impression ---------------------------------------------------------------------
export async function printDoc(view, onProgress) {
  const root = document.getElementById('print-root');
  root.innerHTML = '';
  for (let i = 0; i < view.count; i++) {
    onProgress?.(i, view.count);
    const c = await renderAnnotatedPage(view, i, 2);
    const url = URL.createObjectURL(await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92)));
    const img = document.createElement('img');
    img.src = url;
    await img.decode().catch(() => {});
    root.append(img);
    c.width = c.height = 0;
  }
  await new Promise(r => setTimeout(r, 100));
  window.print();
  setTimeout(() => { for (const im of root.querySelectorAll('img')) URL.revokeObjectURL(im.src); root.innerHTML = ''; }, 2000);
}

export { CSS_UNITS };
