/** Minimal .xlsx o'quvchi — tashqi kutubxona yo'q (zip + XML). */

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function decoder(): TextDecoder {
  return new TextDecoder('utf-8');
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('xlsx-invalid');
  }
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(
    new DecompressionStream('deflate-raw'),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findEocd(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (u32(view, i) === EOCD) return i;
  }
  throw new Error('xlsx-invalid');
}

async function unzip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes);
  const count = u16(view, eocd + 10);
  let offset = u32(view, eocd + 16);
  const out = new Map<string, Uint8Array>();
  const text = decoder();

  for (let i = 0; i < count; i++) {
    if (u32(view, offset) !== CENTRAL) throw new Error('xlsx-invalid');
    const method = u16(view, offset + 10);
    const compSize = u32(view, offset + 20);
    const nameLen = u16(view, offset + 28);
    const extraLen = u16(view, offset + 30);
    const commentLen = u16(view, offset + 32);
    const localOff = u32(view, offset + 42);
    const name = text.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    const localNameLen = u16(view, localOff + 26);
    const localExtra = u16(view, localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtra;
    const compressed = bytes.subarray(dataStart, dataStart + compSize);
    let raw: Uint8Array;
    if (method === 0) raw = compressed;
    else if (method === 8) raw = await inflateRaw(compressed);
    else throw new Error('xlsx-invalid');
    out.set(name, raw);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

// `ParentNode` da `getElementsByTagName` yo'q - chaqiruvchilar doim
// `Document` yoki `Element` beradi, shuning uchun tur shu ikkisi.
function localAll(root: Document | Element, name: string): Element[] {
  return [...root.getElementsByTagName('*')].filter((el) => el.localName === name);
}

function colIndex(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/i) || [''])[0].toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

function readSharedStrings(xml: string): string[] {
  const doc = parseXml(xml);
  const out: string[] = [];
  for (const si of localAll(doc, 'si')) {
    out.push(localAll(si, 't').map((t) => t.textContent || '').join('').trim());
  }
  return out;
}

function cellText(cell: Element, shared: string[]): string {
  const type = cell.getAttribute('t') || '';
  if (type === 'inlineStr') {
    return localAll(cell, 't').map((t) => t.textContent || '').join('').trim();
  }
  const v = localAll(cell, 'v')[0];
  const raw = (v?.textContent || '').trim();
  if (!raw) return '';
  if (type === 's') {
    const idx = Number(raw);
    return Number.isFinite(idx) ? (shared[idx] || '').trim() : '';
  }
  return raw;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const doc = parseXml(xml);
  const rows: string[][] = [];
  for (const row of localAll(doc, 'row')) {
    const cells: Record<number, string> = {};
    for (const c of [...row.children].filter((el) => el.localName === 'c')) {
      const ref = c.getAttribute('r') || '';
      const idx = ref ? colIndex(ref) : Object.keys(cells).length;
      cells[idx] = cellText(c, shared);
    }
    const keys = Object.keys(cells).map(Number);
    if (!keys.length) continue;
    const width = Math.max(...keys) + 1;
    rows.push(Array.from({ length: width }, (_, i) => cells[i] || ''));
  }
  return rows;
}

function pickSheetPath(files: Map<string, Uint8Array>): string {
  const names = [...files.keys()];
  const sheet1 = names.find((n) => /^xl\/worksheets\/sheet1\.xml$/i.test(n));
  if (sheet1) return sheet1;
  const any = names
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];
  if (!any) throw new Error('xlsx-invalid');
  return any;
}

/** Birinchi varaqni qatorlar (matn kataklar) sifatida qaytaradi. */
export async function readXlsxRows(buffer: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buffer);
  const text = decoder();
  const sharedXml = files.get('xl/sharedStrings.xml');
  const shared = sharedXml ? readSharedStrings(text.decode(sharedXml)) : [];
  const sheetPath = pickSheetPath(files);
  const sheet = files.get(sheetPath);
  if (!sheet) throw new Error('xlsx-invalid');
  return parseSheet(text.decode(sheet), shared);
}

export { colIndex as xlsxColIndex };
