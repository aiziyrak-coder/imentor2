// Legacy build — Chrome 85 (sinf monitorlari) uchun; sababi `pdfWorkerEntry.ts` da.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
// Worker ataylab o'z kirish nuqtamiz orqali yuklanadi — u pdf.js worker'idan
// oldin `Uint8Array` polifillarini o'rnatadi (eskiroq brauzerlar uchun).
import PdfWorker from './pdfWorkerEntry?worker';
import { installUint8ArrayPolyfills } from './uint8ArrayPolyfill';

// Asosiy oqim uchun ham kerak: pdf.mjs `.toBase64()` / `Uint8Array.fromBase64`
// ishlatadi (rasm ma'lumotlarini data-URL ga o'girishda).
installUint8ArrayPolyfills();

let workerReady = false;

/** pdf.js worker — Vite orqali .js chunk; nginx .mjs MIME muammosidan qochadi */
export function ensurePdfjsWorker(): void {
  if (workerReady || typeof window === 'undefined') return;
  pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();
  workerReady = true;
}

ensurePdfjsWorker();

export { pdfjsLib };
