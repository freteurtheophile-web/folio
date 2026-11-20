// Chargement des bibliothèques PDF (pdf.js pour l'affichage, pdf-lib pour l'écriture).
import * as pdfjs from '../vendor/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

export { pdfjs };
export const CSS_UNITS = 96 / 72;
const CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/';

export function openPdf(bytes, { onPassword } = {}) {
  const task = pdfjs.getDocument({
    data: bytes.slice(0), // pdf.js transfère le tampon : on lui passe une copie
    cMapUrl: CDN + 'cmaps/', cMapPacked: true,
    standardFontDataUrl: CDN + 'standard_fonts/',
    isEvalSupported: false,
    enableXfa: true,
  });
  if (onPassword) task.onPassword = onPassword;
  return task.promise;
}

let pdfLibP;
export function PDFLib() {
  if (!pdfLibP) pdfLibP = new Promise((res, rej) => {
    if (window.PDFLib) return res(window.PDFLib);
    const s = document.createElement('script');
    s.src = new URL('../vendor/pdf-lib.min.js', import.meta.url).href;
    s.onload = () => res(window.PDFLib);
    s.onerror = rej;
    document.head.append(s);
  });
  return pdfLibP;
}

export async function loadLib(bytes, opts = {}) {
  const { PDFDocument } = await PDFLib();
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, ...opts });
}

// Rend une page pdf.js dans un canvas à l'échelle donnée.
export async function renderPageToCanvas(page, scale, { rotation, background = '#fff' } = {}) {
  const vp = page.getViewport({ scale, rotation: rotation ?? page.rotate });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(vp.width));
  c.height = Math.max(1, Math.round(vp.height));
  const ctx = c.getContext('2d');
  ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { canvas: c, viewport: vp };
}

export function canvasToBytes(canvas, type = 'image/jpeg', quality = 0.8) {
  return new Promise((res) => canvas.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), type, quality));
}

export function isEncrypted(bytes) {
  // Recherche rapide de /Encrypt dans la fin du fichier (trailer).
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 4096)));
  return /\/Encrypt\s/.test(tail);
}
