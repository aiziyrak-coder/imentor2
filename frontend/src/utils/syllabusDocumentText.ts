import { undoLetterTracking } from './letterTracking';

const SYLLABUS_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xlsx'] as const;

export const SYLLABUS_UPLOAD_ACCEPT =
  '.pdf,.doc,.docx,.xlsx,application/pdf,application/msword,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function syllabusFileExtension(fileName: string): string {
  const lower = fileName.toLowerCase();
  for (const ext of SYLLABUS_EXTENSIONS) {
    if (lower.endsWith(ext)) return ext;
  }
  return '';
}

export function isSyllabusUploadFile(file: File): boolean {
  return syllabusFileExtension(file.name) !== '';
}

export function filterSyllabusUploadFiles(files: FileList | File[]): File[] {
  return Array.from(files).filter(isSyllabusUploadFile);
}

export function stripSyllabusFileExtension(fileName: string): string {
  return fileName.replace(/\.(pdf|docx?|xlsx)$/i, '').trim();
}

async function extractPdfText(file: File): Promise<string> {
  const { pdfjsLib } = await import('../utils/pdfjsSetup');
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => ('str' in it ? String(it.str) : ''))
      .join(' ');
    pageTexts.push(line);
  }
  return pageTexts.join('\n');
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return (result.value || '').trim();
}

/** Legacy .doc (Word 97–2003) — matn qatlamlarini binary ichidan ajratish. */
function extractLegacyDocText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const parts: string[] = [];

  let ascii = '';
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c >= 32 && c <= 126) {
      ascii += String.fromCharCode(c);
    } else if (ascii.length >= 4) {
      parts.push(ascii);
      ascii = '';
    } else {
      ascii = '';
    }
  }
  if (ascii.length >= 4) parts.push(ascii);

  let run = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if (
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 32 && code < 0xd800) ||
      (code >= 0xe000 && code <= 0xfffd)
    ) {
      run += String.fromCharCode(code);
    } else if (run.trim().length >= 3) {
      parts.push(run.trim());
      run = '';
    } else {
      run = '';
    }
  }
  if (run.trim().length >= 3) parts.push(run.trim());

  const seen = new Set<string>();
  const unique = parts
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= 3 && !seen.has(p) && seen.add(p));

  return unique.join('\n');
}

export async function extractSyllabusDocumentText(file: File): Promise<string> {
  const ext = syllabusFileExtension(file.name);
  // MUHIM: `undoLetterTracking` shu yerda — matn olingan zahoti — chaqiriladi.
  // Parser keyinroq `\s+ -> ' '` qiladi va so'z chegarasini bildiruvchi
  // qo'sh probellar yo'qoladi, o'shandan keyin tiklash imkonsiz bo'lib qoladi.
  if (ext === '.pdf') return undoLetterTracking(await extractPdfText(file));
  if (ext === '.docx') return undoLetterTracking(await extractDocxText(file));
  if (ext === '.xlsx') {
    const { readXlsxRows } = await import('./xlsxRows');
    const { parseSyllabusExcel } = await import('./syllabusExcelParse');
    const rows = await readXlsxRows(await file.arrayBuffer());
    const parsed = parseSyllabusExcel(rows, file.name);
    if (parsed.asText.trim()) return parsed.asText;
    return rows.map((r) => r.join('\t')).join('\n');
  }
  if (ext === '.doc') {
    const text = undoLetterTracking(extractLegacyDocText(await file.arrayBuffer()));
    if (text.trim().length >= 20) return text;
    throw new Error('doc-empty');
  }
  throw new Error('unsupported-format');
}

export async function readSyllabusFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const payload = (reader.result as string)?.split(',')[1];
      if (!payload) reject(new Error('Unable to read file base64'));
      else resolve(payload);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
