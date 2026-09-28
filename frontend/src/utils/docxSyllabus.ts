/**
 * Word (.docx) ishchi dastur / kalendar rejadan mavzular ro'yxati — o'qituvchi
 * Excel'ga ko'chirib o'tirmasin (2026-09-24).
 *
 * Mavzular jadvalda turadi, dars turi esa:
 *  - jadval oldidagi paragrafda ("Mashg‘ulot turi: Amaliy", "Тематический план практических занятий"),
 *  - jadval sarlavhasida ("№ | Ma’ruzalar mavzulari | Soat"),
 *  - yoki jadval ichidagi bo'lim qatorida ("Ma’ruza (M) | 8", "Practical classes (P)").
 * Hujjat boshidan oxirigacha "joriy tur" kuzatiladi, har mavzu qatori shu turga yoziladi.
 */
import type { SyllabusTopic } from '../services/aiService';
import { classifyActivity } from './syllabusExcelParse';
import { unzip } from './xlsxRows';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export type DocxBlock = { kind: 'p'; text: string } | { kind: 'tbl'; rows: string[][] };
type Kind = 'lecture' | 'practical' | 'clinical' | 'independent' | 'lab';

const PREFIX: Record<Kind, string> = { lecture: 'L', practical: 'A', clinical: 'K', independent: 'I', lab: 'B' };
const ORDER: Kind[] = ['lecture', 'practical', 'clinical', 'independent', 'lab'];

/** Bo'lim sarlavhasiga o'xshash matn (oddiy "maʼruzalar" so'zi emas). */
const SECTION_LIKE =
  /mashg|mavzul|занят|тем[аы]|classes|lectures|mustaqil|самостоят|independ|indepent|\([A-ZА-Я]{1,3}\)/i;

/** Mavzu bo'lmagan bo'limlar: shular boshlansa joriy tur bekor qilinadi. */
const NON_TOPIC =
  /^(\d+\.?\s*)?(asosiy\s+|qo'shimcha\s+|main\s+|additional\s+|основная\s+|дополнительная\s+)?(adabiyot|литератур|literature|reference|sources\s+of|baholash|оценк|mezon|критери|criteria|assessment|reyting|рейтинг|internet|интернет|ta'?lim\s+(texnolog|natija)|educational\s+technolog|технолог|результат|learning\s+outcome|kompetens|компетенц|talab|требован|fanning\s+maqsad|цел[иь])/i;

const HEADER_CELL = /^(№|#|n|t\/?r|mavzu(lar)?|nomi|темы?|topics?|title)$/i;

function norm(s: string): string {
  return s.replace(/[ʼ’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
}

function textOf(el: Element): string {
  let out = '';
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      if (child.localName === 't') out += child.textContent || '';
      else if (child.localName === 'tab' || child.localName === 'br') out += ' ';
      else walk(child);
    }
  };
  walk(el);
  return norm(out);
}

function direct(el: Element, name: string): Element[] {
  return [...el.children].filter((c) => c.localName === name);
}

/** `word/document.xml` tanasi — paragraf va jadvallar ketma-ketligi. */
export function docxBlocks(xml: string): DocxBlock[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  if (!body) return [];
  const out: DocxBlock[] = [];
  const walk = (parent: Element) => {
    for (const el of [...parent.children]) {
      if (el.localName === 'p') out.push({ kind: 'p', text: textOf(el) });
      else if (el.localName === 'tbl') {
        const rows = direct(el, 'tr').map((tr) =>
          direct(tr, 'tc').map((tc) => direct(tc, 'p').map(textOf).filter(Boolean).join(' ')),
        );
        out.push({ kind: 'tbl', rows });
      } else if (el.localName === 'sdt' || el.localName === 'sdtContent') walk(el);
    }
  };
  walk(body);
  return out;
}

/** Matn bo'lim sarlavhasimi: tur (yoki '' — mavzusiz bo'lim), aks holda null. */
export function sectionKind(raw: string): Kind | '' | null {
  const s = norm(raw);
  if (!s || s.length > 110) return null;
  if (NON_TOPIC.test(s)) return '';
  // Yakka so'z ("Lectures" — ta'lim usullari ro'yxatida) bo'lim sarlavhasi emas.
  if (!SECTION_LIKE.test(s) || !s.includes(' ')) return null;
  const lower = s.toLowerCase();
  // "Amaliy mashg‘ulot va laboratoriya ishi mavzulari" — amaliy mashg'ulot.
  if (/amaliy|практич|practic|practcal/.test(lower) && /laborator|лаборатор/.test(lower)) return 'practical';
  if (/\(p\)/i.test(s) || /практич/.test(lower)) return 'practical';
  if (/\(l\)/i.test(s)) return 'lecture';
  if (/\((iw|mt|срс)\)/i.test(s) || /indepent/i.test(s)) return 'independent';
  const kind = classifyActivity(s);
  // "Fan mazmuni va mashg‘ulotlar shakli" — bo'lim boshi, turi keyingi qatorda.
  if (kind === 'unknown') return s.length <= 45 ? '' : null;
  return kind;
}

function cleanTitle(s: string): string {
  return norm(s)
    .replace(/^[.,;:\-–—\s]+/, '')
    .replace(/^\d{1,3}\s*-?\s*(mavzu|тема)\s*[.:]?\s*/i, '')
    .replace(/^(mavzu|тема)\s*\d{1,3}\s*[.:]\s*/i, '')
    .trim();
}

function isCyrillic(s: string): boolean {
  const cyr = (s.match(/[А-Яа-яЁё]/g) || []).length;
  const lat = (s.match(/[A-Za-z]/g) || []).length;
  return cyr > lat;
}

export type DocxSyllabus = {
  topics: SyllabusTopic[];
  subjectName: string;
  /** Ikki tilli hujjatda tashlab yuborilgan ikkinchi til mavzulari soni. */
  otherLanguageDropped: number;
};

export function topicsFromDocxBlocks(blocks: DocxBlock[]): { topics: SyllabusTopic[]; otherLanguageDropped: number } {
  const found: { kind: Kind; title: string }[] = [];
  let current: Kind | '' = '';

  const take = (text: string) => {
    const k = sectionKind(text);
    if (k === null) return false;
    current = k;
    return true;
  };

  for (const block of blocks) {
    if (block.kind === 'p') {
      if (block.text.length <= 110) take(block.text);
      continue;
    }
    for (const row of block.rows) {
      const cells = row.map(norm);
      const filled = cells.filter(Boolean);
      if (!filled.length) continue;
      const longest = [...filled].sort((a, b) => b.length - a.length)[0];
      // Bo'lim yoki sarlavha qatori ("Ma’ruza (M) | 8", "№ | Ma’ruzalar mavzulari | Soat").
      if (longest.length <= 60 && take(longest)) continue;
      if (filled.some((c) => HEADER_CELL.test(c))) continue;
      if (/semest|семест/i.test(longest) && longest.length < 30) continue;
      if (!current) continue;
      const title = cleanTitle(longest);
      if (title.length < 8 || !/[A-Za-zА-Яа-яЁё]{3}/.test(title)) continue;
      if (/^(jami|всего|итого|total)\b/i.test(title)) continue;
      if (/^(\*|note\b|izoh\b|примечание)/i.test(title)) continue;
      // Qolgan kataklar qisqa (raqam, soat, sana) bo'lishi kerak — bu mavzu qatori.
      if (filled.filter((c) => c !== longest).some((c) => c.length > 25)) continue;
      found.push({ kind: current, title });
    }
  }

  // Jadvalsiz dastur: bo'lim sarlavhasi ostidagi raqamlangan paragraflar.
  if (!found.length) {
    current = '';
    for (const block of blocks) {
      if (block.kind !== 'p') continue;
      const m = block.text.match(/^\s*\d{1,3}\s*[.)]\s*(.{8,})$/);
      if (m && current) {
        found.push({ kind: current, title: cleanTitle(m[1].replace(/\s*[-–—]\s*\d+\s*(soat|час\w*|hours?)\.?\s*$/i, '')) });
        continue;
      }
      if (block.text.length <= 110) take(block.text);
    }
  }

  // Ikki tilli hujjat (ruscha + o'zbekcha bir xil reja): birinchi kelgan til qoldiriladi.
  let otherLanguageDropped = 0;
  let kept = found;
  const cyr = found.filter((f) => isCyrillic(f.title)).length;
  const lat = found.length - cyr;
  if (found.length >= 6 && Math.min(cyr, lat) >= found.length * 0.3) {
    const firstCyr = isCyrillic(found[0].title);
    kept = found.filter((f) => isCyrillic(f.title) === firstCyr);
    otherLanguageDropped = found.length - kept.length;
  }

  const buckets: Record<Kind, string[]> = { lecture: [], practical: [], clinical: [], independent: [], lab: [] };
  const seen = new Set<string>();
  for (const f of kept) {
    const key = `${f.kind}::${f.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    buckets[f.kind].push(f.title);
  }
  const topics = ORDER.flatMap((kind) =>
    buckets[kind].map((title, i) => ({ id: `${PREFIX[kind]}${i + 1}`, title, type: kind })),
  );
  return { topics, otherLanguageDropped };
}

/** Fan nomi hujjat boshidan ("Fanning nomi …", "Modulning nomi: …", "Предмет: …"), bo'lmasa fayl nomi. */
export function subjectNameFromDocx(blocks: DocxBlock[], fileName: string): string {
  const patterns = [
    /(?:fan(?:ning)?|modul(?:ning)?)\s+nomi\s*[:\-–]?\s*(.{3,160})/i,
    /(?:предмет|дисциплина|наименование\s+(?:дисциплины|предмета))\s*[:\-–]\s*(.{3,160})/i,
    /(?:name\s+of\s+the\s+(?:course|subject)|(?:course|subject)\s+(?:name|title))\s*[:\-–]?\s*(.{3,160})/i,
    /^[“"«](.{3,160}?)[”"»]\s*fan/i,
  ];
  for (const block of blocks.filter((b) => b.kind === 'tbl' || b.text).slice(0, 80)) {
    const texts = block.kind === 'p' ? [block.text] : block.rows.slice(0, 8).flat();
    for (const text of texts) {
      for (const re of patterns) {
        const m = text.match(re);
        if (m) {
          // "Radiatsion gigiyena Факультет …" kabi yopishib qolgan davomini kesamiz.
          const name = m[1].split(/\s+(?:Факультет|Fakultet|Kafedra|Кафедра|Kurs|Курс|Jami|Yo'nalish)\b/)[0];
          return name.replace(/[«»"“”]/g, '').trim().slice(0, 255);
        }
      }
    }
  }
  return fileName.replace(/\.docx$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 255);
}

export async function readDocxSyllabus(buffer: ArrayBuffer, fileName: string): Promise<DocxSyllabus> {
  const files = await unzip(buffer);
  const xml = files.get('word/document.xml');
  if (!xml) throw new Error('docx-invalid');
  const blocks = docxBlocks(new TextDecoder('utf-8').decode(xml));
  return { ...topicsFromDocxBlocks(blocks), subjectName: subjectNameFromDocx(blocks, fileName) };
}
