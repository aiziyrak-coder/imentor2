import type { SyllabusTopic, SyllabusTopicType } from '../services/aiService';

export type TopicSection = 'lecture' | 'practical' | 'clinical' | 'independent' | 'lab' | 'unknown';

const LECTURE_PREFIXES = ['M', 'L', 'Л'];
const PRACTICAL_PREFIXES = ['A', 'P', 'П'];
const CLINICAL_PREFIXES = ['K', 'К'];
const INDEPENDENT_PREFIXES = ['I'];
const LAB_PREFIXES = ['B'];

const LECTURE_SECTION_RE =
  /^(?:ma'?ruza(?:lar)?|maruza|lecture(?:s)?|лекци[яиюеё]?|теоретическ|theor)/iu;
const CLINICAL_SECTION_RE =
  /^(?:klinik\s*mashg|clinical|клиническ)/iu;
const INDEPENDENT_SECTION_RE =
  /^(?:mustaqil|самостоят|independent|\bsrc\b|\bсрс\b)/iu;
const LAB_SECTION_RE =
  /^(?:laborator|лаборатор|\blab\b)/iu;
const PRACTICAL_SECTION_RE =
  /^(?:amaliy(?:\s+mashg'?ulot)?|practical(?:s)?|практик[аиеё]?|seminar|семинар)/iu;

const UNIVERSITY_NOISE_RE =
  /(?:universitet|institut|akademiy|vazirlik|ministry|республик|o[''`]zbekiston|uzbekistan|fakultet|kafedra|department|syllabus|учебн(?:ая|ый)\s+программ)/iu;

const ACADEMIC_YEAR_RE = /^\d{4}\s*[-–/]\s*\d{2,4}$/;

export function detectTopicSection(line: string): TopicSection {
  const trimmed = line.trim();
  if (!trimmed) return 'unknown';
  if (/\bseminar\b|\bсеминар/iu.test(trimmed)) return 'practical';
  if (LECTURE_SECTION_RE.test(trimmed)) return 'lecture';
  if (CLINICAL_SECTION_RE.test(trimmed)) return 'clinical';
  if (INDEPENDENT_SECTION_RE.test(trimmed)) return 'independent';
  if (LAB_SECTION_RE.test(trimmed)) return 'lab';
  if (PRACTICAL_SECTION_RE.test(trimmed)) return 'practical';
  return 'unknown';
}

export function inferTopicTypeFromId(id: string): SyllabusTopicType {
  const first = (id[0] || '').toUpperCase();
  if (first === 'S') return 'practical';
  if (LECTURE_PREFIXES.includes(first)) return 'lecture';
  if (CLINICAL_PREFIXES.includes(first)) return 'clinical';
  if (PRACTICAL_PREFIXES.includes(first)) return 'practical';
  if (INDEPENDENT_PREFIXES.includes(first)) return 'independent';
  if (LAB_PREFIXES.includes(first)) return 'lab';
  return 'lecture';
}

/** Har qanday ID formatini L1/A1/K1 ko'rinishiga keltirish */
export function coerceTopicId(
  rawId: string,
  type: SyllabusTopicType,
  fallbackIndex: number,
): string {
  const compact = String(rawId || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

  const standard = compact.match(/^([MALPKIBSЛПКк])(\d{1,2})$/u);
  if (standard) {
    const letter = standard[1].toUpperCase();
    const num = standard[2];
    if (letter === 'S') return `A${num}`;
    if (
      LECTURE_PREFIXES.includes(letter) ||
      PRACTICAL_PREFIXES.includes(letter) ||
      CLINICAL_PREFIXES.includes(letter) ||
      INDEPENDENT_PREFIXES.includes(letter) ||
      LAB_PREFIXES.includes(letter)
    ) {
      return `${letter}${num}`;
    }
  }

  const labeled = compact.match(
    /^(?:MARUZA|MA'?RUZA|LECTURE|LEKTSIYA|LEKTS|ЛЕКЦИЯ|ЛЕК)(?:№|#)?(\d{1,2})$/u,
  );
  if (labeled) return `L${labeled[1]}`;

  const practicalLabeled = compact.match(
    /^(?:AMALIY|PRACTICAL|PRAKTIK|ПРАКТИК|ПРАК|SEMINAR|СЕМИНАР)(?:№|#)?(\d{1,2})$/u,
  );
  if (practicalLabeled) return `A${practicalLabeled[1]}`;

  const clinicalLabeled = compact.match(
    /^(?:KLINIK|CLINICAL|КЛИНИЧ)(?:№|#)?(\d{1,2})$/u,
  );
  if (clinicalLabeled) return `K${clinicalLabeled[1]}`;

  const numOnly = compact.match(/^(\d{1,2})$/);
  const num = numOnly ? numOnly[1] : String(fallbackIndex);
  const prefix =
    type === 'practical'
      ? 'A'
      : type === 'clinical'
        ? 'K'
        : type === 'independent'
          ? 'I'
          : type === 'lab'
            ? 'B'
            : 'L';
  return `${prefix}${num}`;
}

export function normalizeSyllabusTopics(input: SyllabusTopic[]): SyllabusTopic[] {
  const topics = input
    .filter((t) => t && typeof t.title === 'string')
    .map((t, index) => {
      const title = t.title.trim();
      const inferredType: SyllabusTopicType =
        t.type === 'practical' ||
        t.type === 'lecture' ||
        t.type === 'clinical' ||
        t.type === 'independent' ||
        t.type === 'lab'
          ? t.type
          : inferTopicTypeFromId(String(t.id || ''));
      const id = coerceTopicId(String(t.id || ''), inferredType, index + 1);
      return { id, title, type: inferredType } as SyllabusTopic;
    })
    .filter((t) => t.title.length > 2 && !isWeakTopicTitle(t.title));

  const dedup = new Map<string, SyllabusTopic>();
  for (const t of topics) {
    const existing = dedup.get(t.id);
    if (!existing || t.title.length > existing.title.length) {
      dedup.set(t.id, t);
    }
  }

  const parseOrder = (id: string): [number, number] => {
    const prefix = id[0] || '';
    const num = Number((id.match(/\d+/) || ['0'])[0]);
    const group = LECTURE_PREFIXES.includes(prefix)
      ? 0
      : PRACTICAL_PREFIXES.includes(prefix)
        ? 1
        : CLINICAL_PREFIXES.includes(prefix)
          ? 2
          : INDEPENDENT_PREFIXES.includes(prefix)
            ? 3
            : 4;
    return [group, Number.isFinite(num) ? num : 0];
  };

  return Array.from(dedup.values()).sort((a, b) => {
    const [ga, na] = parseOrder(a.id);
    const [gb, nb] = parseOrder(b.id);
    if (ga !== gb) return ga - gb;
    if (na !== nb) return na - nb;
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });
}

export function scoreSyllabusTopics(topics: SyllabusTopic[]): number {
  if (!topics.length) return 0;
  let score = topics.length * 12;
  const avgTitle =
    topics.reduce((sum, t) => sum + t.title.length, 0) / Math.max(topics.length, 1);
  if (avgTitle > 12) score += 15;
  if (avgTitle > 25) score += 10;
  const ids = new Set(topics.map((t) => t.id));
  if (ids.size === topics.length) score += 20;
  return score;
}

export function isWeakSyllabusExtraction(topics: SyllabusTopic[]): boolean {
  return topics.length < 2 || scoreSyllabusTopics(topics) < 30;
}

/** PDF dan ajratilgan matnda kirill M/A va OCR xatolarini normallashtirish */
export function normalizeSyllabusDocumentText(text: string): string {
  return text
    .replace(/\u041C/g, 'M') // Cyrillic М → Latin M
    .replace(/\u0410/g, 'A') // Cyrillic А → Latin A
    .replace(/\u041B/g, 'L')
    .replace(/\u041F/g, 'P')
    .replace(/\u043C/g, 'm')
    .replace(/\u0430/g, 'a')
    .replace(/^Ml$/gim, 'M1')
    .replace(/^Мl$/gim, 'M1');
}

const STANDALONE_TOPIC_ID_RE = /^([MALPKIB])(\d{1,2})$/i;

const RUBRIC_NOISE_RE =
  /(?:fanning\s+mohiyati|xatolik\s+va\s+chalkashlik|savollarga\s+aniq|aniq\s+tasavvurga|to[''`]liq\s+yorita|meyoriy-huquqiy|baholash\s+mezon|o[''`]zlashtirish\s+darajasi)/iu;

function isNoiseLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 3) return true;
  if (/^TN\d+/i.test(t)) return true;
  if (/^\d+$/.test(t)) return true;
  if (/^\d{1,2}\s*>/.test(t)) return true;
  if (UNIVERSITY_NOISE_RE.test(t)) return true;
  if (RUBRIC_NOISE_RE.test(t)) return true;
  if (LECTURE_SECTION_RE.test(t) || PRACTICAL_SECTION_RE.test(t) || CLINICAL_SECTION_RE.test(t)) return true;
  if (/^mashg['’]?ulotlar\s+shakli:/i.test(t)) return true;
  if (/^fan\s+ma[/\\]?muni$/i.test(t)) return true;
  return false;
}

/**
 * Matn qatlami buzilgan PDF'lardan kelgan "mavzu"larni rad etadi.
 *
 * Ba'zi sillabus PDF'larida shrift kodlanishi buzuq bo'lib, matn o'rniga
 * belgilar to'plami chiqadi:
 *
 *     "N J4 -v ? qt .iO lcg q L & t i;"
 *     "-.6 ol .FP >l Z.e =F e€ J € s Et E F"
 *
 * Bunday yozuvlar o'qituvchiga mavzu bo'lib ko'rinadi va eng yomoni — AI
 * ma'ruza/test generatsiyasiga prompt sifatida ketadi. Haqiqiy mavzu
 * nomida kamida ikkita "so'zga o'xshash" bo'lak (3+ harf) bo'ladi va
 * belgilarning yarmidan ko'pi harf bo'ladi.
 */
function isGibberishTitle(title: string): boolean {
  const nonSpace = [...title].filter((ch) => ch.trim() !== '');
  if (nonSpace.length === 0) return true;
  const letters = nonSpace.filter((ch) => /\p{L}/u.test(ch)).length;
  if (letters / nonSpace.length < 0.5) return true;

  const tokens = title.split(/\s+/).filter(Boolean);
  // Yolg'iz qolgan bitta belgili bo'laklarning ko'pligi — buzuq matn belgisi.
  // Harf-harf ajralgan matn bu bosqichga yetib kelmaydi (u hujjatdan matn
  // olinayotganda `undoLetterTracking` bilan allaqachon yopishtirilgan),
  // shuning uchun bu yerdagi yolg'iz belgilar chinakam axlat.
  const loneChars = tokens.filter((t) => t.length === 1).length;
  if (tokens.length >= 6 && loneChars / tokens.length >= 0.35) return true;

  const wordLike = title.split(/\s+/).filter((token) => {
    // Chekkadagi tinish belgilari olib tashlanadi ("Спирометрия." -> "Спирометрия"),
    // lekin so'z ICHIDAGI begona belgilar saqlanadi — aynan ular buzuq
    // matn belgisi ("C.ll", "Ee-g$ENAr").
    const core = token.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').replace(/['’`]/g, '');
    return core.length >= 3 && /^\p{L}+$/u.test(core);
  });
  return wordLike.length < 2;
}

function isWeakTopicTitle(title: string): boolean {
  const t = title.trim();
  if (t.length < 10) return true;
  if (isGibberishTitle(t)) return true;
  if (RUBRIC_NOISE_RE.test(t)) return true;
  if (/^[''']?smal/i.test(t)) return true;
  if (/^\d{4}\s*й\.?$/u.test(t)) return true;
  if (/^(?:\d{1,2}\s*>)+\s*/.test(t)) return true;
  return false;
}

function parseStandaloneTopicId(line: string): string | null {
  const trimmed = normalizeSyllabusDocumentText(line.trim());
  const m = trimmed.match(STANDALONE_TOPIC_ID_RE);
  if (!m) return null;
  return `${m[1].toUpperCase()}${m[2]}`;
}

function flushPendingTopic(
  pendingId: string,
  titleLines: string[],
  out: SyllabusTopic[],
): void {
  const title = titleLines
    .map((l) => l.trim())
    .filter((l) => l.length >= 4 && !isNoiseLine(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (isWeakTopicTitle(title)) return;
  const type = inferTopicTypeFromId(pendingId);
  out.push({
    id: coerceTopicId(pendingId, type, out.length + 1),
    title: title.slice(0, 500),
    type,
  });
}

function parseTopicFromLine(
  line: string,
  section: TopicSection,
  lectureCounter: { n: number },
  practicalCounter: { n: number },
  clinicalCounter: { n: number },
  independentCounter: { n: number },
  labCounter: { n: number },
): SyllabusTopic | null {
  const trimmed = line.trim();
  if (trimmed.length < 4) return null;

  const standard = trimmed.match(
    /\b([MALPKIBЛПК])\s*[-.):]?\s*(\d{1,2})\b[\s:.)–\-]*(.+)$/iu,
  );
  if (standard) {
    const prefix = standard[1].toUpperCase();
    const id = `${prefix}${standard[2]}`;
    const title = standard[3].trim();
    if (title.length < 3) return null;
    return {
      id,
      title,
      type: inferTopicTypeFromId(id),
    };
  }

  const lectureLine = trimmed.match(
    /^(?:ma'?ruza|maruza|lecture|лекци[яиюеё]?)\s*[#№.]?\s*(\d{1,2})[\s:.)–\-]+(.+)$/iu,
  );
  if (lectureLine) {
    return {
      id: `L${lectureLine[1]}`,
      title: lectureLine[2].trim(),
      type: 'lecture',
    };
  }

  const clinicalLine = trimmed.match(
    /^(?:klinik\s*mashg'?ulot|clinical|клиническ(?:ое)?(?:\s+занятие)?)\s*[#№.]?\s*(\d{1,2})[\s:.)–\-]+(.+)$/iu,
  );
  if (clinicalLine) {
    return {
      id: `K${clinicalLine[1]}`,
      title: clinicalLine[2].trim(),
      type: 'clinical',
    };
  }

  const labLine = trimmed.match(
    /^(?:laborator(?:iya)?|лаборатор(?:ная)?)\s*[#№.]?\s*(\d{1,2})[\s:.)–\-]+(.+)$/iu,
  );
  if (labLine) {
    return {
      id: `B${labLine[1]}`,
      title: labLine[2].trim(),
      type: 'lab',
    };
  }

  const independentLine = trimmed.match(
    /^(?:mustaqil(?:\s+ta'?lim)?|самостоят|independent)\s*[#№.]?\s*(\d{1,2})[\s:.)–\-]+(.+)$/iu,
  );
  if (independentLine) {
    return {
      id: `I${independentLine[1]}`,
      title: independentLine[2].trim(),
      type: 'independent',
    };
  }

  const practicalLine = trimmed.match(
    /^(?:amaliy|practical|практик[аиеё]?|seminar|семинар)\s*[#№.]?\s*(\d{1,2})[\s:.)–\-]+(.+)$/iu,
  );
  if (practicalLine) {
    return {
      id: `A${practicalLine[1]}`,
      title: practicalLine[2].trim(),
      type: 'practical',
    };
  }

  const numbered = trimmed.match(/^(\d{1,2})[\s.)–\-]+(.{4,})$/);
  if (numbered && section !== 'unknown' && Number(numbered[1]) > 0) {
    const type: SyllabusTopicType =
      section === 'practical'
        ? 'practical'
        : section === 'clinical'
          ? 'clinical'
          : section === 'independent'
            ? 'independent'
            : section === 'lab'
              ? 'lab'
              : 'lecture';
    const counter =
      type === 'practical'
        ? practicalCounter
        : type === 'clinical'
          ? clinicalCounter
          : type === 'independent'
            ? independentCounter
            : type === 'lab'
              ? labCounter
              : lectureCounter;
    counter.n += 1;
    const id = coerceTopicId(numbered[1], type, counter.n);
    return {
      id,
      title: numbered[2].trim(),
      type,
    };
  }

  return null;
}

export function extractTopicsByRegex(text: string): SyllabusTopic[] {
  const normalized = normalizeSyllabusDocumentText(text);
  const result: SyllabusTopic[] = [];
  let section: TopicSection = 'unknown';
  const lectureCounter = { n: 0 };
  const practicalCounter = { n: 0 };
  const clinicalCounter = { n: 0 };
  const independentCounter = { n: 0 };
  const labCounter = { n: 0 };

  let pendingId: string | null = null;
  let pendingTitleLines: string[] = [];

  const flushPending = () => {
    if (!pendingId) return;
    flushPendingTopic(pendingId, pendingTitleLines, result);
    pendingId = null;
    pendingTitleLines = [];
  };

  for (const rawLine of normalized.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const sectionHint = detectTopicSection(line);
    if (sectionHint !== 'unknown') {
      flushPending();
      section = sectionHint;
      continue;
    }

    const standaloneId = parseStandaloneTopicId(line);
    if (standaloneId) {
      flushPending();
      pendingId = standaloneId;
      pendingTitleLines = [];
      continue;
    }

    const inlineTopic = parseTopicFromLine(
      line,
      section,
      lectureCounter,
      practicalCounter,
      clinicalCounter,
      independentCounter,
      labCounter,
    );
    if (inlineTopic) {
      flushPending();
      result.push(inlineTopic);
      continue;
    }

    if (pendingId && !isNoiseLine(line)) {
      pendingTitleLines.push(line);
    }
  }

  flushPending();
  return normalizeSyllabusTopics(result);
}

export function guessSubjectFromDocumentText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 80);

  const labelPatterns = [
    /^(?:fan\s+nomi|kurs(?:\s+nomi)?|predmet|subject|course|дисциплина|название\s+предмета|наименование\s+дисциплины)[:\s.\-–]+(.+)$/iu,
    /^syllabus[:\s.\-–]+(.+)$/iu,
    /^учебная\s+программа[:\s.\-–]+(.+)$/iu,
    /^(?:discipline|module)[:\s.\-–]+(.+)$/iu,
  ];

  const cleanSubjectCandidate = (raw?: string): string => {
    if (!raw) return '';
    return raw
      .replace(/\s+TN\d+.*$/iu, '')
      .replace(/\s{2,}\S.*$/, '')
      .trim();
  };

  for (const line of lines) {
    for (const pattern of labelPatterns) {
      const match = line.match(pattern);
      const candidate = cleanSubjectCandidate(match?.[1]);
      if (isPlausibleSubjectName(candidate)) return candidate;
    }
  }

  for (const line of lines) {
    if (!isPlausibleSubjectName(line)) continue;
    if (/^([MALPЛП])\s*[-.):]?\s*\d+/iu.test(line)) continue;
    if (LECTURE_SECTION_RE.test(line) || PRACTICAL_SECTION_RE.test(line)) continue;
    return line;
  }

  return '';
}

function isPlausibleSubjectName(value?: string): boolean {
  if (!value) return false;
  const candidate = value.trim();
  if (candidate.length < 4 || candidate.length > 160) return false;
  if (UNIVERSITY_NOISE_RE.test(candidate)) return false;
  if (ACADEMIC_YEAR_RE.test(candidate)) return false;
  if (/^\d+$/.test(candidate)) return false;
  return true;
}

export function countTopicsByType(topics: SyllabusTopic[]): {
  lectures: number;
  practicals: number;
  clinicals: number;
  independents: number;
  labs: number;
} {
  return {
    lectures: topics.filter((t) => t.type === 'lecture').length,
    practicals: topics.filter((t) => t.type === 'practical').length,
    clinicals: topics.filter((t) => t.type === 'clinical').length,
    independents: topics.filter((t) => t.type === 'independent').length,
    labs: topics.filter((t) => t.type === 'lab').length,
  };
}
