import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/**
 * HTML → A4 PDF.
 *
 * MUHIM: html2canvas butun blokni BITTA baland rasmga aylantiradi, shuning
 * uchun CSS'dagi `page-break-inside: avoid` hech qanday ta'sir qilmaydi.
 * Avval rasm shunchaki sahifa balandligiga bo'lib tashlanardi va kesish joyi
 * matn qatorining o'rtasiga tushib qolardi — natijada bir qator ikkita
 * sahifada yarim-yarim ko'rinib, "takrorlangandek" bo'lardi.
 *
 * Endi kesish joyi 3 bosqichda tanlanadi:
 *   1) `data-pdf-block` bloklarining pastki chegarasi (savol/javob butunligicha
 *      bitta sahifada qoladi);
 *   2) istalgan ichki element (<p>, <li>, div) pastki chegarasi;
 *   3) ularning hech biri sig'masa — rasmdagi TOZA (fon rangli) piksel qatori,
 *      ya'ni harflar orasidagi bo'shliq.
 */

/** Sahifa chekkalari (mm) — matn varaq qirrasiga yopishib qolmasin. */
export const PAGE_MARGIN_Y_MM = 12;
export const PAGE_MARGIN_X_MM = 8;
/** Sahifaning kamida shuncha qismi to'lsin — juda kalta sahifa chiqmasin. */
const MIN_PAGE_FILL = 0.35;
/** 3-bosqichda toza qator qidiriladigan zona (canvas piksel). */
const CLEAN_ROW_LOOKUP_PX = 260;

type Boundaries = { blocks: number[]; elements: number[] };

/** Blok/element pastki chegaralarini canvas piksellariga o'giradi. */
function collectBoundaries(container: HTMLElement, pxRatio: number): Boundaries {
  const base = container.getBoundingClientRect().top;
  const toCanvasY = (el: Element) =>
    Math.round((el.getBoundingClientRect().bottom - base) * pxRatio);

  const unique = (values: number[]) =>
    Array.from(new Set(values.filter((v) => v > 0))).sort((a, b) => a - b);

  const blocks = unique(Array.from(container.querySelectorAll('[data-pdf-block]')).map(toCanvasY));
  // `data-pdf-keep-next` — sarlavha/yorliq: undan keyin kesilsa, sahifa oxirida
  // yolg'iz "ЛЕЧЕНИЕ" turib qolardi, matni esa keyingi sahifada.
  const elements = unique(
    Array.from(container.querySelectorAll('p, li, h1, h2, h3, div, tr'))
      .filter((el) => !el.hasAttribute('data-pdf-keep-next'))
      .map(toCanvasY),
  );
  return { blocks, elements };
}

/** `start` dan keyingi, `maxEnd` dan oshmaydigan eng pastki chegara. */
function lastBefore(values: number[], min: number, maxEnd: number): number | null {
  let found: number | null = null;
  for (const v of values) {
    if (v > maxEnd) break;
    if (v >= min) found = v;
  }
  return found;
}

/**
 * `maxEnd` atrofidagi butunlay bir xil rangli (fon) piksel qatorini topadi —
 * shunda kesish harf o'rtasidan o'tmaydi.
 */
function findCleanRow(canvas: HTMLCanvasElement, maxEnd: number, minY: number): number | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const from = Math.max(minY, maxEnd - CLEAN_ROW_LOOKUP_PX);
  const height = maxEnd - from;
  if (height <= 1) return null;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, from, canvas.width, height).data;
  } catch {
    return null;
  }
  const step = 4 * 4; // har 4-piksel — tezlik uchun yetarli
  for (let row = height - 1; row >= 0; row -= 1) {
    const rowStart = row * canvas.width * 4;
    const r = data[rowStart];
    const g = data[rowStart + 1];
    const b = data[rowStart + 2];
    let uniform = true;
    for (let i = rowStart; i < rowStart + canvas.width * 4; i += step) {
      if (
        Math.abs(data[i] - r) > 6 ||
        Math.abs(data[i + 1] - g) > 6 ||
        Math.abs(data[i + 2] - b) > 6
      ) {
        uniform = false;
        break;
      }
    }
    if (uniform) return from + row;
  }
  return null;
}

/**
 * Sahifalarning kesish nuqtalarini hisoblaydi (toza funksiya — test qilinadi).
 * `findClean` — 3-bosqich (rasmdagi bo'sh qator); testda kerak emas.
 */
export function planPageCuts(params: {
  canvasHeight: number;
  pagePx: number;
  blocks: number[];
  elements: number[];
  findClean?: (maxEnd: number, minEnd: number) => number | null;
}): { start: number; end: number }[] {
  const { canvasHeight, pagePx, blocks, elements, findClean } = params;
  const pages: { start: number; end: number }[] = [];
  if (pagePx <= 0 || canvasHeight <= 0) return pages;
  let start = 0;
  while (start < canvasHeight) {
    const maxEnd = Math.min(start + pagePx, canvasHeight);
    const minEnd = start + Math.floor(pagePx * MIN_PAGE_FILL);
    let end = maxEnd;
    if (maxEnd < canvasHeight) {
      end =
        lastBefore(blocks, minEnd, maxEnd) ??
        lastBefore(elements, minEnd, maxEnd) ??
        findClean?.(maxEnd, minEnd) ??
        maxEnd;
    }
    if (end <= start) end = maxEnd;
    pages.push({ start, end });
    start = end;
  }
  return pages;
}

function sliceToDataUrl(source: HTMLCanvasElement, start: number, end: number): string | null {
  const slice = document.createElement('canvas');
  slice.width = source.width;
  slice.height = end - start;
  const ctx = slice.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, slice.width, slice.height);
  ctx.drawImage(source, 0, start, source.width, end - start, 0, 0, source.width, end - start);
  return slice.toDataURL('image/jpeg', 0.95);
}

export async function renderHtmlToPdf(html: string, filename: string): Promise<void> {
  return renderHtmlDocumentsToPdf([html], filename);
}

/** Draw bounded HTML fragments one at a time so long rosters cannot exceed canvas limits. */
export async function renderHtmlDocumentsToPdf(
  documents: Iterable<string>,
  filename: string,
): Promise<void> {
  const pdf = new jsPDF('p', 'mm', 'a4');
  const contentWidthMm = pdf.internal.pageSize.getWidth() - PAGE_MARGIN_X_MM * 2;
  const usableMm = pdf.internal.pageSize.getHeight() - PAGE_MARGIN_Y_MM * 2;
  let pageIndex = 0;
  for (const html of documents) {
    const container = document.createElement('div');
    Object.assign(container.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: '760px',
      background: '#ffffff',
    });
    container.innerHTML = html;
    document.body.appendChild(container);
    try {
      await document.fonts?.ready;
      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      if (!canvas.width || !canvas.height) throw new Error('PDF canvas is empty');
      const pxPerMm = canvas.width / contentWidthMm;
      const pagePx = Math.floor(usableMm * pxPerMm);
      const pxRatio = canvas.height / container.getBoundingClientRect().height;
      const { blocks, elements } = collectBoundaries(container, pxRatio);
      const pages = planPageCuts({
        canvasHeight: canvas.height,
        pagePx,
        blocks,
        elements,
        findClean: (maxEnd, minEnd) => findCleanRow(canvas, maxEnd, minEnd),
      });
      for (const { start, end } of pages) {
        const imgData = sliceToDataUrl(canvas, start, end);
        if (!imgData) throw new Error('PDF page could not be rendered');
        if (pageIndex > 0) pdf.addPage();
        pdf.addImage(
          imgData,
          'JPEG',
          PAGE_MARGIN_X_MM,
          PAGE_MARGIN_Y_MM,
          contentWidthMm,
          (end - start) / pxPerMm,
        );
        pageIndex += 1;
      }
      canvas.width = 0;
      canvas.height = 0;
    } finally {
      container.remove();
    }
  }
  if (!pageIndex) throw new Error('No PDF pages');
  for (let i = 1; i <= pageIndex; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8);
    pdf.setTextColor(100);
    pdf.text(
      `${i} / ${pageIndex}`,
      pdf.internal.pageSize.getWidth() / 2,
      pdf.internal.pageSize.getHeight() - 5,
      { align: 'center' },
    );
  }
  pdf.save(filename);
}
