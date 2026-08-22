import { type AppLanguage, inferPdfLanguage } from '../i18n/language';
import { translate } from '../i18n/translations';
import type { PresentationContent } from '../utils/presentationContentSchema';
import {
  PRESENTATION_JSON_SCHEMA,
  normalizePresentationContent,
  withPresentationReferences,
} from '../utils/presentationContentSchema';
import {
  dedupePresentationBullets,
  dedupePresentationSlides,
  qaPresentationContent,
} from '../utils/presentationQa';
import {
  cyrillicCharCount,
  looksLikeUzbekText,
  outputLanguageLooksWrong,
  strictLanguageDirective,
} from '../utils/outputLanguage';
import { resolvePresentationImages } from '../utils/presentationImages';
import {
  extractTopicsByRegex,
  guessSubjectFromDocumentText,
  isWeakSyllabusExtraction,
  normalizeSyllabusDocumentText,
  normalizeSyllabusTopics,
  scoreSyllabusTopics,
} from '../utils/syllabusTopicParse';
import {
  extractSyllabusDocumentText,
  stripSyllabusFileExtension,
  syllabusFileExtension,
} from '../utils/syllabusDocumentText';
import { parseSyllabusExcel } from '../utils/syllabusExcelParse';
import { readXlsxRows } from '../utils/xlsxRows';
import { parseAiJson } from '../utils/parseAiJson';
import {
  OPENAI_CHAT,
  OPENAI_FAST,
  assertOpenAiApiKey,
  type BookContext,
  openaiJson,
  openaiText,
  openaiTextStream,
} from './openaiClient';
import {
  buildAvoidRepeatsBlock,
  buildCaseClinicalRules,
  buildCaseStructurePrompt,
  buildCaseKeywordsFocusPrompt,
  buildTestVarietyPrompt,
  CASE_STUDY_FOCUS_ORDER,
  GENERATION_UNIQUENESS_RULE,
  summarizeCaseForAvoid,
  summarizeTestForAvoid,
  type CaseStudyFocus,
} from '../utils/generationVariety';
import { listPreparedForTopicSynced, loadPreparedByIdSynced } from '../utils/preparedContentStore';
import { normalizeCaseFocus } from '../utils/caseFocusLabels';
import { type MedicalReference } from '../utils/medicalReferences';
import { stripUnfilledSourceTemplate } from '../utils/sourceTemplate';
import { stripOptionLetterPrefix } from '../utils/testOptionText';
import {
  DEFAULT_TEST_DIFFICULTY,
  buildTestDifficultyPrompt,
  testDifficultyTemperature,
  testExplanationInstruction,
  testStemInstruction,
  type TestDifficulty,
} from '../utils/testDifficulty';
import {
  emptyScope,
  buildScopePrompt,
  academicBundleHasClinicalLeak,
  type GenerationScope,
  type SubjectDomain,
} from '../utils/subjectDomain';
import { ensureBackendAccessToken, getBackendAccessToken } from '../utils/backendAuth';
import { httpJson } from '../api/httpClient';

const SYS_MEDICAL =
  'Siz FJSTI tibbiyot professori va klinik ta\'lim metodistisiz. Javoblar ilmiy, aniq, darsga tayyor.';

const SYS_ACADEMIC =
  'Siz FJSTI professori va berilgan FAN bo\'yicha metodistsiz. Klinik bemor kartasi, kasallik, lab, dori, ' +
  'KROK/USMLE ssenariysi YARATILMASIN — faqat shu kafedra, fan, mavzu va ma\'ruza.';

const ACADEMIC_CLINICAL_RETRY_BAN =
  'OLDINGI NATIJA YAROQSIZ: klinik bemor, diabet, HbA1c, metformin yoki shifokor aralashgan. ' +
  'Butunlay qayta yozing — faqat fan/mavzu/ma\'ruza. Bemor yo\'q.';

function sysRole(domain: SubjectDomain): string {
  return domain === 'academic' ? SYS_ACADEMIC : SYS_MEDICAL;
}

// Hech qachon tashqi (DOI/PubMed/veb) havola yoki "Foydalanilgan adabiyotlar" ro'yxati so'ralmaydi —
// bular ko'pincha AI tomonidan o'ylab topiladi (haqiqiy maqolaga bog'lanmasligi mumkin). Kitob
// konteksti bo'lsa — manba matn ichida (Manba: kitob, sahifa-bet) ko'rinishida ko'rsatiladi;
// bo'lmasa — hech qanday manba/havola ko'rsatilmaydi, faqat mazmun.
const NO_EXTERNAL_REFS_JSON_RULE_BOOK =
  'MAJBURIY: bu fan uchun rasmiy darslik (kitob) manba sifatida berilgan. Tashqi adabiyot/DOI/PubMed ' +
  'havolalari QO\'SHMANG — "references" maydonini bo\'sh massiv [] qoldiring (manbani tizim ' +
  'AVTOMATIK biriktiradi: qaysi darslikning qaysi betlari ishlatilgani serverga aniq ma\'lum). ' +
  'Matn ichida ham "(Manba: ...)" YOZMANG — ayniqsa "kitob nomi", "sahifa-bet" kabi ' +
  'TO\'LDIRILMAGAN shablonni hech qachon qoldirmang. Faqat mazmunni yozing.';
const NO_EXTERNAL_REFS_JSON_RULE_NOBOOK =
  'MAJBURIY: tashqi adabiyot/DOI/PubMed/veb havolalari yoki o\'ylab topilgan manbalar QO\'SHMANG — ' +
  '"references" maydonini bo\'sh massiv [] qoldiring. Hech qanday manba ko\'rsatmasdan, faqat ' +
  'mazmunning o\'ziga tayanib yozing.';
const NO_EXTERNAL_REFS_TEXT_RULE_BOOK =
  'MAJBURIY: bu fan uchun rasmiy darslik (kitob) manba sifatida berilgan. Tashqi (DOI/PubMed/veb) ' +
  'havolalar QO\'SHMANG. Har bir asosiy bo\'limda kamida 1 marta "(Manba: <HAQIQIY kitob nomi>, ' +
  '<HAQIQIY sahifa raqami>)" ko\'rsating — bu FORMAT namunasi, matndagi "<...>" belgilarini berilgan ' +
  'darslik parchasidagi HAQIQIY kitob nomi va sahifa raqami bilan almashtiring. "kitob nomi", ' +
  '"sahifa-bet" kabi TO\'LDIRILMAGAN/umumiy so\'zlarni hech qachon o\'zgarishsiz qoldirmang — agar ' +
  'aniq kitob nomi/sahifa nomalum bo\'lsa, manba qatorini butunlay tashlab keting. Oxirida qisqa ' +
  '"## Manbalar" bo\'limida FAQAT berilgan darsliklardan foydalanilgan kitoblar ro\'yxatini yozing ' +
  '(tashqi adabiyot qo\'shmang).';
const NO_EXTERNAL_REFS_TEXT_RULE_NOBOOK =
  'MAJBURIY: oxirida "## Foydalanilgan adabiyotlar" / "## Manbalar" bo\'limini YOZMANG, tashqi ' +
  '(DOI/PubMed/veb) havolalar yoki o\'ylab topilgan manbalar qo\'shmang — hech qanday link/manba ' +
  'ko\'rsatmasdan, faqat mazmunning o\'ziga tayanib yozing.';

/** Xavfsizlik to'ri: AI ba'zan ko'rsatma ichidagi TO'LDIRILMAGAN namuna
 * matnini ("kitob nomi, sahifa-bet") o'zgarishsiz qaytarib yuboradi — bu
 * haqiqiy manba emas. Promptga qo'shilgan ogohlantirish asosiy himoya,
 * lekin shu funksiya oxirgi chiziq sifatida shunday qatorlarni matndan
 * butunlay olib tashlaydi. */
function stripPlaceholderManba(text: string): string {
  if (!text) return text;
  return text
    .split('\n')
    .filter((line) => !/\(?(?:Manba|Источник|Source):\s*(?:kitob\s*nomi|название\s*книги|book\s*name)/i.test(line))
    .join('\n');
}

/** Manba bo'limi sarlavhalari — modelning har xil variantlari. */
const SOURCE_HEADING_RE =
  /^(#{1,4})\s*(?:Manbalar|Манбалар|Foydalanilgan\s+adabiyotlar|Фойдаланилган\s+адабиётлар|Источники|Использованная\s+литература|Sources|References(?:\s+used)?)\s*:?\s*$/i;

/** Xavfsizlik to'ri: model ba'zan o'zbekcha "Manbalar" so'zini chiqish tiliga
 * transliteratsiya qiladi ("Манбалар"). Sarlavhani to'g'ri tarjimaga almashtiramiz. */
function normalizeSourceHeading(text: string, language: AppLanguage): string {
  if (!text) return text;
  const heading = sourceWords(language).heading;
  return text
    .split('\n')
    .map((line) => {
      const m = SOURCE_HEADING_RE.exec(line.trim());
      return m ? `${m[1]} ${heading}` : line;
    })
    .join('\n');
}

function jsonReferencesRule(hasBookContext: boolean): string {
  return hasBookContext ? NO_EXTERNAL_REFS_JSON_RULE_BOOK : NO_EXTERNAL_REFS_JSON_RULE_NOBOOK;
}

/** Matn ichidagi manba sarlavhasi/yorlig'i — CHIQISH tilida bo'lishi kerak.
 * Aks holda model o'zbekcha "Manbalar" so'zini rus tiliga transliteratsiya
 * qilib "Манбалар" deb yozib qo'yadi. */
const SOURCE_WORDS: Record<AppLanguage, { heading: string; label: string }> = {
  uz: { heading: 'Manbalar', label: 'Manba' },
  ru: { heading: 'Источники', label: 'Источник' },
  en: { heading: 'Sources', label: 'Source' },
};

function sourceWords(language: AppLanguage) {
  return SOURCE_WORDS[language] ?? SOURCE_WORDS.uz;
}

function textReferencesRule(hasBookContext: boolean, language: AppLanguage = 'uz'): string {
  const w = sourceWords(language);
  const base = hasBookContext ? NO_EXTERNAL_REFS_TEXT_RULE_BOOK : NO_EXTERNAL_REFS_TEXT_RULE_NOBOOK;
  return (
    `${base} Manba sarlavhasi va yorlig'i CHIQISH tilida yozilsin: bo'lim sarlavhasi ` +
    `aynan "## ${w.heading}", matn ichidagi yorliq esa aynan "(${w.label}: ...)". ` +
    'Bu so\'zlarni boshqa tilga transliteratsiya QILMANG.'
  );
}

async function previousCaseAvoidBlock(topic: string): Promise<string> {
  try {
    const summaries = (await listPreparedForTopicSynced('case', topic)).slice(0, 6);
    const sessions = (
      await Promise.all(summaries.map((v) => loadPreparedByIdSynced<CaseStudySession>('case', v.id)))
    ).filter((s): s is CaseStudySession => Boolean(s?.questions?.length));
    return buildAvoidRepeatsBlock(sessions.map(summarizeCaseForAvoid));
  } catch {
    return '';
  }
}

async function previousTestAvoidBlock(topic: string): Promise<string> {
  try {
    // Tezlik: to'liq payload yuklamaymiz — faqat sarlavhalar (mine list).
    const summaries = (await listPreparedForTopicSynced('test', topic)).slice(0, 8);
    if (!summaries.length) return '';
    const lines = summaries.map((s, i) => `${i + 1}. ${s.topic}`).join('\n');
    return (
      `\nAvoid repeating these previously generated test topics / angles:\n${lines}\n` +
      'Create NEW clinical vignettes and distractors.\n'
    );
  } catch {
    return '';
  }
}

export type { MedicalReference };

export interface CaseStudyQuestion {
  scenario: string;
  answer: string;
  focus?: 'profilaktika' | 'davolash' | 'tashxis';
  options?: string[];
  correctOptionIndex?: number;
  explanation?: string;
  references?: MedicalReference[];
}

export interface CaseStudySession {
  topic: string;
  questions: CaseStudyQuestion[];
  references?: MedicalReference[];
  keywords?: string[];
  domain?: SubjectDomain;
}

export interface TestQuestion {
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  /** Har bir variant uchun alohida izoh: nega to'g'ri yoki nega xato (options bilan bir xil uzunlik) */
  optionExplanations?: string[];
  references?: MedicalReference[];
}

/** Bitta tildagi test tarkibi — asosiy TestSession bilan bir xil shakl, faqat translations'siz */
export interface TestSessionContent {
  topic: string;
  questions: TestQuestion[];
  references?: MedicalReference[];
}

export interface TestSession {
  id?: string;
  topic: string;
  questions: TestQuestion[];
  references?: MedicalReference[];
  createdAt?: number;
  authorUid?: string;
  /** Asosiy generatsiya tili — `questions` shu tilda; boshqalari `translations`da. */
  primaryLanguage?: AppLanguage;
  /** Qolgan tillardagi tarjimalar (uz/ru/en to'liq to'plami uchun). */
  translations?: Partial<Record<AppLanguage, TestSessionContent>>;
  /** Oson / o'rta / qiyin — yaratishda tanlangan. */
  difficulty?: TestDifficulty;
  domain?: SubjectDomain;
}

export interface LectureNote {
  id?: string;
  topic: string;
  content: string;
  createdAt?: number;
  authorUid?: string;
}

export interface Exercise {
  title: string;
  description: string;
  tasks: {
    task: string;
    type: 'multiple_choice' | 'true_false' | 'short_answer';
    options?: string[];
    answer: string;
  }[];
}

function parseJSONSafe<T>(text: string | undefined): T {
  return parseAiJson<T>(text);
}

export type SyllabusTopicType =
  | 'lecture'
  | 'practical'
  | 'clinical'
  | 'independent'
  | 'lab';

export interface SyllabusTopic {
  id: string; // L1 / A1 / K1 / I1 / B1 — UI da to'liq nom chiqadi
  title: string;
  type: SyllabusTopicType;
  /** Fan katalogi identifikatori (mavzu konteksti) */
  syllabusId?: number;
  subjectName?: string;
  variantLabel?: string;
}

export interface SyllabusExtractResult {
  subject_name: string;
  topics: SyllabusTopic[];
  instruction_language: AppLanguage;
}

function languageName(lang: AppLanguage): string {
  if (lang === 'ru') return 'Russian';
  if (lang === 'en') return 'English';
  return 'Uzbek';
}

const SYLLABUS_AI_JSON_HINT =
  '{"subject_name":"...","instruction_language":"uz|en|ru","topics":[{"id":"L1","title":"...","type":"lecture|practical|clinical|independent|lab"}]}';

const SYLLABUS_NO_TRANSLATE_RULE =
  'CRITICAL: subject_name and every topic title MUST stay in the original document language. NEVER translate into another language. ' +
  'EXCEPTION for Uzbek: if the document is Uzbek (Latin OR Cyrillic), write EVERY title in Latin Uzbek script only — ' +
  'transliterate Cyrillic Uzbek to Latin (o‘, g‘, sh, ch). Do NOT leave Uzbek Cyrillic letters (ў, қ, ғ, ҳ, …). ' +
  'Russian titles stay Cyrillic Russian; English stays Latin English.';

const SYLLABUS_AI_SYSTEM =
  'You are an academic syllabus parser for university medical courses. Return JSON only. ' +
  `Schema: ${SYLLABUS_AI_JSON_HINT}. ` +
  'Rules: subject_name = ONE course/discipline (fan), NOT university or faculty name. ' +
  'Each topic = one numbered syllabus line (mavzu) in document order. ' +
  'Topic ids: L or M + number for lectures (ma\'ruza/лекция), A or P + number for practicals (amaliy/практика). ' +
  'Include ALL topics; do not skip or merge. If only lectures OR only practicals exist, do NOT invent the other type. ' +
  SYLLABUS_NO_TRANSLATE_RULE;

function pickBetterExtract(a: SyllabusExtractResult, b: SyllabusExtractResult): SyllabusExtractResult {
  const scoreA = scoreSyllabusTopics(a.topics);
  const scoreB = scoreSyllabusTopics(b.topics);
  if (scoreB > scoreA) return b;
  if (scoreA > scoreB) return a;
  if (b.subject_name.length > a.subject_name.length) return b;
  return a;
}

async function extractSyllabusWithAi(
  file: File,
  docText: string,
): Promise<SyllabusExtractResult> {
  const normalizedText = normalizeSyllabusDocumentText(docText);
  const docLang = inferPdfLanguage(normalizedText);
  const docLangName = languageName(docLang);
  let best: SyllabusExtractResult = { subject_name: '', topics: [], instruction_language: docLang };

  try {
    const textRaw = await openaiJson({
      model: OPENAI_CHAT,
      system: SYLLABUS_AI_SYSTEM,
      user:
        `Document language: ${docLangName}. File: "${file.name}". ${SYLLABUS_NO_TRANSLATE_RULE}\n\n` +
        normalizedText.slice(0, 100000),
      maxTokens: 6144,
      parse: (t) => parseJSONSafe<Partial<SyllabusExtractResult>>(t),
    });
    best = normalizeSyllabusExtract(textRaw, file.name, normalizedText);
  } catch (firstAiError) {
    console.warn('Syllabus AI text pass failed:', firstAiError);
  }

  if (isWeakSyllabusExtraction(best.topics)) {
    try {
      const retryRaw = await openaiJson({
        model: OPENAI_FAST,
        system:
          SYLLABUS_AI_SYSTEM +
          ' List every numbered topic line from the syllabus table of contents or topic list.',
        user:
          `Document language: ${docLangName}. Extract ALL topics with correct lecture/practical type.\n\n` +
          normalizedText.slice(0, 100000),
        maxTokens: 6144,
        parse: (t) => parseJSONSafe<Partial<SyllabusExtractResult>>(t),
      });
      best = pickBetterExtract(best, normalizeSyllabusExtract(retryRaw, file.name, normalizedText));
    } catch (retryError) {
      console.warn('Syllabus AI retry failed:', retryError);
    }
  }

  const regexPass = extractTopicsByRegex(normalizedText);
  if (regexPass.length > 0) {
    const regexResult = normalizeSyllabusExtract({ topics: regexPass }, file.name, normalizedText);
    best = pickBetterExtract(best, regexResult);
  }

  if (best.topics.length > 0) {
    return best;
  }

  throw new Error('syllabus-extract-failed');
}

function inferSyllabusInstructionLanguage(
  result: Pick<SyllabusExtractResult, 'subject_name' | 'topics'>,
  pdfText: string,
  explicit?: string,
): AppLanguage {
  const raw = (explicit || '').trim().toLowerCase();
  if (raw === 'uz' || raw === 'en' || raw === 'ru') return raw;
  const blob = [pdfText, result.subject_name, ...result.topics.map((t) => t.title)].filter(Boolean).join('\n');
  return inferPdfLanguage(blob);
}

function finalizeSyllabusExtract(
  result: Omit<SyllabusExtractResult, 'instruction_language'>,
  pdfText: string,
  explicitLang?: string,
): SyllabusExtractResult {
  return {
    ...result,
    instruction_language: inferSyllabusInstructionLanguage(result, pdfText, explicitLang),
  };
}

function normalizeSyllabusExtract(
  data: Partial<SyllabusExtractResult> | SyllabusTopic[] | null | undefined,
  fileName: string,
  pdfText = '',
): SyllabusExtractResult {
  let subject_name = '';
  let rawTopics: SyllabusTopic[] = [];

  if (Array.isArray(data)) {
    rawTopics = data;
  } else if (data && typeof data === 'object') {
    subject_name = String(data.subject_name || '').trim();
    rawTopics = Array.isArray(data.topics) ? data.topics : [];
  }

  const topics = normalizeSyllabusTopics(rawTopics);
  if (!subject_name) {
    subject_name = guessSubjectFromDocumentText(pdfText);
  }
  if (!subject_name) {
    subject_name = stripSyllabusFileExtension(fileName).replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  const base = {
    subject_name: subject_name.slice(0, 255) || 'Fan',
    topics,
  };
  const explicitLang =
    data && !Array.isArray(data) && typeof data === 'object' ? data.instruction_language : undefined;
  return finalizeSyllabusExtract(base, pdfText, explicitLang);
}

function syllabusExtractionErrorMessage(err: unknown, fileName: string, lang: AppLanguage = 'uz'): string {
  const msg = err instanceof Error ? err.message : String(err || '');
  if (msg === 'empty-document') {
    return translate(lang, 'ai.error.syllabusEmpty', { fileName });
  }
  if (msg === 'doc-empty') {
    return translate(lang, 'ai.error.syllabusDocEmpty', { fileName });
  }
  if (msg === 'unsupported-format' || msg === 'xlsx-invalid') {
    return translate(lang, 'ai.error.syllabusUnsupported', { fileName });
  }
  if (msg.startsWith('empty:')) {
    return translate(lang, 'ai.error.syllabusNoTopics', { fileName });
  }
  if (/api|key|401|403/i.test(msg)) {
    return translate(lang, 'ai.error.openai');
  }
  return translate(lang, 'ai.error.syllabusParseFailed', { fileName });
}

export { syllabusExtractionErrorMessage };

const CASE_FOCUS_HINTS_ACADEMIC: Record<CaseStudyFocus, string> = {
  profilaktika:
    'xatolik/xavfsizlik/standartni buzmaslik — oddiy "ehtiyot bo\'ling" EMAS, aniq qaror',
  davolash:
    'yechim tanlovi ikkilamchi: ikkita yaqin usul, cheklov tufayli bittasi mos emas',
  tashxis:
    'ildiz sabab yoki to\'g\'ri model — ta\'rif emas, konkret shartlardan xulosa',
};

const CASE_PERSONA_HINTS_ACADEMIC: Record<CaseStudyFocus, string> = {
  profilaktika:
    'Ishtirokchi: yosh mutaxassis/talaba, aniq vazifa (tizim sozlash, hisob, dars). Kasallik YO\'Q.',
  davolash:
    'Ishtirokchi: o\'rta tajribali muhandis/o\'qituvchi. Birinchi urinish muvaffaqiyatsiz yoki cheklov bor.',
  tashxis:
    'Ishtirokchi: tajribali mutaxassis. Ikki yaqin tushuncha chalkashishi mumkin; bitta fakt kesadi.',
};

const CASE_FOCUS_HINTS: Record<CaseStudyFocus, string> = {
  profilaktika:
    'profilaktika/skrining qarori noaniq: raqobatdosh xavf, kontrendikatsiya yoki o\'tkazib yuborilgan skrining — ' +
    'sog\'lom odamga oddiy maslahat EMAS',
  davolash:
    'davolash tanlovi ikkilamchi: komorbidlik, dori interaksiyasi, buyrak/jigar, birinchi qator samarasiz — ' +
    'birinchi qatorni shunchaki yozib qo\'yish EMAS',
  tashxis:
    'atipik yoki o\'xshash sindromlar, 3 ta ishonchli DDx, hal qiluvchi belgi/tahlil — ' +
    'darslikdagi tipik "oson" kechish EMAS',
};

/** Har fokus uchun MAJBURIY, bir-biriga o'xshamaydigan bemor profili — 3 ta
 * vaziyat parallel generatsiya qilingani uchun (bir-biridan xabarsiz), aynan
 * shu qat'iy demografik farq bo'lmasa, model ko'pincha bir xil ism/yosh/kasb
 * tanlaydi (masalan hammasi "Anvar"). */
const CASE_PERSONA_HINTS: Record<CaseStudyFocus, string> = {
  profilaktika:
    'Bemor: YOSH (20-35 yosh) AYOL, aniq kasbi. Lekin SOG\'LOM emas — mavzuga oid yashirin xavf, ' +
    'o\'tkazib yuborilgan skrining yoki profilaktika uchun kontrendikatsiya bo\'lsin. ' +
    'Ism — kam uchraydigan o\'zbekcha ism (Anvar/Nigora/Shirin/Gulnora dan QOCHING).',
  davolash:
    'Bemor: O\'RTA YOSHLI (40-55 yosh) ERKAK, aniq kasbi. Polifarmasiya, buyrak/jigar cheklovi ' +
    'yoki muvaffaqiyatsiz birinchi davolash bo\'lsin — oddiy "dori yozib berish" holati EMAS. ' +
    'Ism — kam uchraydigan o\'zbekcha ism (Anvar/Nigora/Shirin/Gulnora dan QOCHING).',
  tashxis:
    'Bemor: KEKSA (60-75 yosh), jinsi ixtiyoriy. Belgilari ikki yaqin tashxisni ham qo\'llab-quvvatlasin; ' +
    'bitta topilma hal qiluvchi bo\'lsin. Klassik darslik kechishi EMAS. ' +
    'Kam lab + pastki qorin = appenditsit kabi oson ssenariy YO\'Q. ' +
    'Ism — kam uchraydigan o\'zbekcha ism (Anvar/Nigora/Shirin/Gulnora/Qodir dan QOCHING).',
};

/** Keys yechimi bo'limlarga ajratilgan holda so'raladi — bitta uzun "answer"
 *  so'ralganda model hajm ko'rsatmasini bajarmay qisqarardi. Alohida maydonlar
 *  har biriga o'z ulushini beradi; prompt zich klinik karta (~1400 so'z) ushlab turadi. */
type CaseSections = {
  patient?: string;
  complaints?: string;
  history?: string;
  lifestyle?: string;
  examination?: string;
  labs?: string;
  diagnosis?: string;
  differential?: string;
  investigations?: string;
  management?: string;
  recommendations?: string;
  focus?: string;
};

const CASE_SCENARIO_PARTS: (keyof CaseSections)[] = [
  'patient',
  'complaints',
  'history',
  'lifestyle',
  'examination',
  'labs',
];

const CASE_SCENARIO_TITLES: Record<AppLanguage, string[]> = {
  uz: ['Bemor', 'Shikoyatlar', 'Anamnez', 'Hayot tarzi', "Obyektiv ko'rik", 'Laboratoriya'],
  ru: ['Пациент', 'Жалобы', 'Анамнез', 'Образ жизни', 'Объективный осмотр', 'Лаборатория'],
  en: ['Patient', 'Complaints', 'History', 'Lifestyle', 'Examination', 'Investigations'],
};

const CASE_SCENARIO_TITLES_ACADEMIC: Record<AppLanguage, string[]> = {
  uz: ['Kim ishtirok etadi', 'Muammo', 'Berilgan shartlar', 'Muhit va vositalar', 'Nima kuzatildi', 'Ma\'lumotlar'],
  ru: ['Кто участвует', 'Проблема', 'Условия', 'Среда и средства', 'Что видно', 'Данные'],
  en: ['Who is involved', 'Problem', 'Given conditions', 'Setting and tools', 'What was observed', 'Data'],
};

/** Vaziyatni klinik karta qatorlariga birlashtiradi (`### Sarlavha`). */
function joinCaseScenario(
  raw: CaseSections,
  language: AppLanguage = 'uz',
  domain: SubjectDomain = 'clinical',
): string {
  const table = domain === 'academic' ? CASE_SCENARIO_TITLES_ACADEMIC : CASE_SCENARIO_TITLES;
  const labels = table[language] ?? table.uz;
  return CASE_SCENARIO_PARTS.map((k, i) => {
    const text = String(raw[k] || '').trim();
    return text ? `### ${labels[i]}\n${text}` : '';
  })
    .filter(Boolean)
    .join('\n\n');
}

const CASE_SECTION_KEYS: (keyof CaseSections)[] = [
  'diagnosis',
  'differential',
  'investigations',
  'management',
  'recommendations',
];

/** Yechim bo'limlari sarlavhalari — interfeys tilida ko'rsatiladi. */
const CASE_SECTION_TITLES: Record<AppLanguage, string[]> = {
  uz: [
    'Klinik xulosa',
    'Differensial tahlil',
    'Keyingi tekshiruvlar',
    'Davolash taktikasi',
    'Kuzatuv va ogohlantirish',
  ],
  ru: [
    'Клиническое заключение',
    'Дифференциальный анализ',
    'Следующие обследования',
    'Тактика лечения',
    'Наблюдение и предупреждения',
  ],
  en: [
    'Clinical impression',
    'Differential analysis',
    'Next investigations',
    'Management plan',
    'Follow-up and red flags',
  ],
};

const CASE_SECTION_TITLES_ACADEMIC: Record<AppLanguage, string[]> = {
  uz: ['Asosiy xulosa', 'Boshqa tushuntirishlar', 'Qanday tekshirish', 'Qanday yechish', 'Xatolikni oldini olish'],
  ru: ['Главный вывод', 'Другие объяснения', 'Как проверить', 'Как решить', 'Как не допустить ошибку'],
  en: ['Main conclusion', 'Other explanations', 'How to check', 'How to solve', 'How to prevent the mistake'],
};

const CASE_ACADEMIC_FIELDS =
  'MAYDONLAR (JSON kalitlari o\'sha, mazmuni KLINIK EMAS):\n' +
  '1. Vaziyat (jami 520–720 so\'z) — fan/mavzu bo\'yicha amaliy masala, bemor kartasi EMAS:\n' +
  '   "patient" (55–75 so\'z) — ishtirokchi (talaba/muhandis/o\'qituvchi), kasb, vazifa; kasallik YO\'Q.\n' +
  '   "complaints" (90–120 so\'z) — texnik yoki o\'quv muammo (xato, cheklov, noto\'g\'ri sozlama).\n' +
  '   "history" (110–150 so\'z) — avvalgi urinishlar, berilgan shartlar, standart/protokol.\n' +
  '   "lifestyle" (50–75 so\'z) — vositalar, muhit, dastur/uskuna/qoida (vital belgi YO\'Q).\n' +
  '   "examination" (110–150 so\'z) — o\'lchov, log, hisob, ekran/natija — T/AB/puls YO\'Q.\n' +
  '   "labs" (100–140 so\'z) — raqamli ma\'lumot (hajm, tezlik, formula, sozlama); HbA1c/WBC YO\'Q.\n' +
  '2. Yechim (jami 700–920 so\'z):\n' +
  '   "diagnosis" (130–170 so\'z) — ildiz sabab (nozologiya EMAS) + qaysi 3–4 fakt buni ochadi.\n' +
  '   "differential" (170–220 so\'z) — 3 yaqin muqobil tushuntirish; har birida 1 qo\'llab + 1 rad etuvchi fakt.\n' +
  '   "investigations" (110–150 so\'z) — 2–3 tekshirish qadami (nima o\'lchanadi/qayer qaraladi).\n' +
  '   "management" (160–210 so\'z) — aniq yechim (qadam, sozlama, formula); nima tanlanmadi va nega.\n' +
  '   "recommendations" (80–110 so\'z) — xatolikni oldini olish qoidalari.\n' +
  '3. TAQIQLANGAN: 55 yoshli ayol + diabet + HbA1c + metformin + elektron pochta; bemor vignette; KROK.\n' +
  '4. Bu 3 ta vaziyatdan FAQAT BITTASI. Boshqa ism/kasb.\n';

const CASE_CLINICAL_FIELDS =
  'MAYDONLAR:\n' +
  '1. Vaziyat (jami 520–720 so\'z) — to\'liq, lekin suvsiz klinik karta:\n' +
  '   "patient" (55–75 so\'z) — ism, yosh, jins, BMI yoki tana tuzilishi, kasb, qayerga/qachon kelgan.\n' +
  '   "complaints" (90–120 so\'z) — boshlang\'ich (soat/kun), migratsiya/irradiatsiya, kuchaytiruvchi/yengillatiruvchi, ' +
  'hamroh belgilar (ishtaha, ko\'ngil aynishi, isitma, siydik/najas). Takrorlamang.\n' +
  '   "history" (110–150 so\'z) — kasalliklar, JARROHLIK, DORILAR (nomi+doza+muddat), allergiya, ' +
  'oxirgi 48 soatdagi muhim voqea. Faqat qarorga ta\'sir qiladigan fakt.\n' +
  '   "lifestyle" (50–75 so\'z) — FAQAT qarorni o\'zgartiradigan odat/kasb/epidemiologiya. ' +
  '"Chekmaydi, haftasiga 3 marta yuradi" TAQIQLANADI agar bu taktika o\'zgartirmasa.\n' +
  '   "examination" (110–150 so\'z) — T, AB, puls, RR, SpO2; qorin/o\'pka/yurakdan MAVZUGA OID aniq belgilar ' +
  '(masalan periton simptomlari BOR yoki YO\'Q — bu trap bo\'lishi mumkin). "Hamma tizim me\'yor" YO\'Q.\n' +
  '   "labs" (100–140 so\'z) — 7–10 ko\'rsatkich (raqam+birlik), ulardan KAMIDA 1 tasi raqobatdosh tashxisni ' +
  'qo\'llab-quvvatlasin. Imkon bo\'lsa 1 ta allaqachon qilingan vizualizatsiya (noaniq/chalg\'ituvchi natija).\n' +
  '2. Yechim (jami 700–920 so\'z) — oliy ta\'lim klinik fikr:\n' +
  '   "diagnosis" (130–170 so\'z) — aniq nozologiya + qaysi 3–4 belgi/mezon (yo\'riqnoma/skor) qanoatlanadi; ' +
  'qaysi topilma chalg\'ituvchi va nima uchun e\'tiborsiz qoldirilmaydi.\n' +
  '   "differential" (170–220 so\'z) — 3 ta YAQQOL yaqin DDx (oson rad etiladigan emas). HAR biri: 1 qo\'llab-quvvatlovchi + 1 rad etuvchi ANIQ raqam/belgi.\n' +
  '   "investigations" (110–150 so\'z) — 2–3 tekshiruv: nima uchun USHBU bemorda, kutiladigan aniq natija, ' +
  'nima qilinMASLIGI kerak (masalan oddiy appenditsitda qon ekilmasi).\n' +
  '   "management" (160–210 so\'z) — 1-qator taktika (dori/doza/yo\'l YOKI operatsiya turi); ' +
  'komorbidlik tufayli nima tanlanmadi; asorat xavfi.\n' +
  '   "recommendations" (80–110 so\'z) — qizil bayroqlar (qachon qayta murojaat) + aniq nazorat muddati. Umumiy nasihat YO\'Q.\n' +
  '3. Aniq yozing: nozologiya, mezon, dori, doza, qiymat. "Ehtimol" o\'rniga dalil.\n' +
  '4. Bu 3 ta vaziyatdan FAQAT BITTASI. Boshqa ism/yosh/kasb. Anvar, Nigora, Shirin, Gulnora, Madina, ' +
  'Iskandar, Odil, Otabek, Qodir ismlaridan QOCHING.\n' +
  '5. TAQIQLANGAN ssenariy: kam lab + pastki qorin og\'rig\'i = appenditsit; yoki bitta klassik belgi = tashxis.\n';

/** Bo'limlarni harfsiz klinik fikr matniga birlashtiradi. */
function joinCaseSections(
  raw: CaseSections,
  language: AppLanguage = 'uz',
  domain: SubjectDomain = 'clinical',
): string {
  const table = domain === 'academic' ? CASE_SECTION_TITLES_ACADEMIC : CASE_SECTION_TITLES;
  const labels = table[language] ?? table.uz;
  return CASE_SECTION_KEYS.map((key, i) => {
    const text = String(raw[key] || '').trim();
    return text ? `${labels[i]}\n${text}` : '';
  })
    .filter(Boolean)
    .join('\n\n');
}

async function generateSingleCaseQuestion(
  topic: string,
  focus: CaseStudyFocus,
  language: AppLanguage,
  keywordFocus: string,
  avoid: string,
  contextText: string,
  sources: CaseSource[],
  scope: GenerationScope,
): Promise<CaseStudyQuestion> {
  const domain = scope.domain;
  const outLang = languageName(language);
  const structure = buildCaseStructurePrompt(topic, domain);
  const clinicalRules = buildCaseClinicalRules(domain);
  const hasContext = Boolean(contextText.trim());
  const scopeBlock = buildScopePrompt(scope);
  const focusHint = domain === 'academic' ? CASE_FOCUS_HINTS_ACADEMIC[focus] : CASE_FOCUS_HINTS[focus];
  const personaHint = domain === 'academic' ? CASE_PERSONA_HINTS_ACADEMIC[focus] : CASE_PERSONA_HINTS[focus];
  const request = (strict: boolean, banClinicalLeak = false) =>
    openaiJson<CaseSections>({
      model: OPENAI_CHAT,
      system:
        `${sysRole(domain)} ` +
        (domain === 'academic'
          ? 'Oliy ta\'lim AMALIY keys, klinik bemor EMAS. '
          : 'Oliy tibbiy ta\'lim klinik keysi (KROK / rezidentura), maktab/oson appenditsit EMAS. ') +
        `${GENERATION_UNIQUENESS_RULE} Return ONLY valid JSON object with EXACTLY ` +
        'these keys: {"patient","complaints","history","lifestyle","examination","labs",' +
        '"diagnosis","differential","investigations","management","recommendations"}. ' +
        (domain === 'academic'
          ? 'Har maydon 4–8 dens gap. Kasallik, dori, lab, vital belgi YO\'Q. '
          : 'Zich klinik karta: har maydon 4–8 dens gap, kam ma\'lumotli oson hikoya YO\'Q. ') +
        'Yechimda a) b) c) d) e) harflari YOZILMASIN — bu fikr, test varianti emas. ' +
        `Language: ${outLang}. ${strictLanguageDirective(language)} focus="${focus}". ` +
        (domain === 'academic'
          ? 'Hech qanday [n] iqtibos, PMID yoki klinik manba yozmang.'
          : hasContext
            ? 'MANBALAR (raqamlangan) sizga user xabarida berilgan — yechimda muhim klinik ' +
              'da\'vodan keyin mos manba raqamini [n] qo\'ying. Kamida 2 ta DARSLIK va 2 ta ' +
              'jurnal/PubMed raqami ishlatilsin. Wikipedia iqtibos qilmang. ' +
              'Manbada yo\'q narsani [n] bilan bog\'lamang. PMID/DOI/link o\'ylab topmang. ' +
              '"Foydalanilgan adabiyotlar" yozmang — dastur qo\'shadi.'
            : 'Hech qanday manba berilmagan — hech qanday raqamli iqtibos [n], link yoki "Manba:" degan matn yozmang, faqat umumiy klinik bilim asosida yozing.'),
      user:
        `${banClinicalLeak ? `${ACADEMIC_CLINICAL_RETRY_BAN}\n\n` : ''}` +
        `${scopeBlock}\n\n${structure}${keywordFocus}${avoid}\n\n` +
        `${clinicalRules}\n\n` +
        `Generate ONE case with focus="${focus}" (${focusHint}). ` +
        `${personaHint}\n` +
        (domain === 'academic' ? CASE_ACADEMIC_FIELDS : CASE_CLINICAL_FIELDS) +
        (domain !== 'academic' && hasContext ? `\nMANBALAR:\n${contextText}\n` : '') +
        (strict ? `\nStrict valid JSON only.\n${strictLanguageDirective(language)}` : ''),
      // Zich keys: ~1400 so'z JSON.
      maxTokens: 10000,
      temperature: strict ? 0.32 : 0.42,
      parse: (t) => parseJSONSafe(t),
    });

  let raw: CaseSections;
  try {
    raw = await request(false);
  } catch {
    raw = await request(true);
  }

  // Til nazorati: model so'ralgan til o'rniga o'zbekchani (ko'pincha kirilda)
  // qaytarsa — bir marta qat'iyroq rejimda qayta so'raymiz.
  if (outputLanguageLooksWrong(joinCaseSections(raw, language, domain), language)) {
    console.warn(`Case focus "${focus}": javob ${language} tilida emas, qayta urinilmoqda`);
    try {
      const retry = await request(true);
      if (!outputLanguageLooksWrong(joinCaseSections(retry, language, domain), language)) {
        raw = retry;
      }
    } catch (err) {
      console.warn('Case til bo\'yicha qayta urinish muvaffaqiyatsiz:', err);
    }
  }

  if (domain === 'academic' && academicBundleHasClinicalLeak(Object.values(raw).map((v) => String(v || '')))) {
    try {
      const retry = await request(true, true);
      if (!academicBundleHasClinicalLeak(Object.values(retry).map((v) => String(v || '')))) {
        raw = retry;
      }
    } catch (err) {
      console.warn('Case klinik sizib chiqish bo\'yicha qayta urinish muvaffaqiyatsiz:', err);
    }
  }

  const answer = joinCaseSections(raw, language, domain);
  const usedIndices = new Set(
    Array.from(answer.matchAll(/\[(\d+)\]/g)).map((m) => Number(m[1])),
  );
  // Adabiyotlar HAR DOIM yechim oxirida ko'rsatiladi. Model iqtibos qo'ygan
  // manbalar ustuvor; agar u [n] yozishni unutgan bo'lsa ham, yechim aynan shu
  // manbalar asosida yaratilgani uchun ular ro'yxatda beriladi (bo'sh "Foydalanilgan
  // adabiyotlar" bo'limi chiqmasligi kerak).
  const citedSources = sources.filter((s) => usedIndices.has(s.index) && s.type !== 'wikipedia');
  const books = sources.filter((s) => s.type === 'book');
  const journals = sources.filter((s) => s.type === 'pubmed' || s.type === 'scholar');
  const seen = new Set(citedSources.map((s) => s.index));
  const extras = domain === 'academic' ? [] : [...books, ...journals].filter((s) => !seen.has(s.index));
  const shownSources = domain === 'academic' ? [] : [...citedSources, ...extras].slice(0, 10);
  const referencesSection = buildReferencesSection(shownSources, language);

  return {
    scenario: joinCaseScenario(raw, language, domain),
    answer: answer + referencesSection,
    focus: normalizeCaseFocus(raw.focus, CASE_STUDY_FOCUS_ORDER.indexOf(focus)),
    ...(shownSources.length ? { references: sourcesToMedicalReferences(shownSources) } : {}),
  };
}

function normalizeCaseSession(
  topic: string,
  data: CaseStudySession,
  language: AppLanguage = 'uz',
): CaseStudySession {
  const rawQuestions = [...(data.questions || [])].slice(0, 3);
  while (rawQuestions.length < 3) {
    const focus = CASE_STUDY_FOCUS_ORDER[rawQuestions.length];
    rawQuestions.push({ scenario: '', answer: '', focus });
  }

  const cleanedQuestions = rawQuestions.map((q, i) => {
      const scenario = (q.scenario || '').trim();
      const answer = (q.answer || '').trim();
      // Zaxira matn ham interfeys tilida bo'lsin.
      const fallbackScenario = translate(language, 'case.fallbackScenario', {
        n: String(i + 1),
        topic,
      });
      const fallbackAnswer = translate(language, 'case.fallbackAnswer');
      const focus = normalizeCaseFocus((q as CaseStudyQuestion).focus, i);
      const refs = (q as CaseStudyQuestion).references;
      return {
        scenario: scenario.length >= 120 ? scenario : fallbackScenario,
        answer: answer.length >= 120 ? answer : fallbackAnswer,
        focus,
        ...(refs?.length ? { references: refs } : {}),
      };
    });
  return {
    topic: (data.topic || topic || '').trim() || topic,
    questions: cleanedQuestions,
    references: [],
    ...(data.domain ? { domain: data.domain } : {}),
  };
}

/**
 * Variantlarni aralashtiradi va to'g'ri javob indeksini (bor bo'lsa variant
 * izohlarini ham) yangi tartibga moslaydi. To'g'ri javob har doim bir xil
 * harfda turib qolmasligi uchun — bu testni ma'nosiz qilib qo'yadi.
 */
export function shuffleQuestionOptions(input: {
  options: string[];
  correctOptionIndex: number;
  optionExplanations?: string[];
}): { options: string[]; correctOptionIndex: number; optionExplanations?: string[] } {
  const n = input.options.length;
  if (n < 2) return { ...input };
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const nextCorrect = order.indexOf(input.correctOptionIndex);
  return {
    options: order.map((k) => input.options[k]),
    correctOptionIndex: nextCorrect >= 0 ? nextCorrect : 0,
    ...(input.optionExplanations
      ? { optionExplanations: order.map((k) => input.optionExplanations?.[k] ?? '') }
      : {}),
  };
}

function normalizeTestSession(
  topic: string,
  data: TestSession,
  requestedCount: number,
  bookReferences: MedicalReference[] = [],
): TestSession {
  const questions = (data.questions || [])
    .slice(0, requestedCount)
    .map((q) => {
      const options = (q.options || []).slice(0, 5);
      while (options.length < 5) options.push(`Variant ${options.length + 1}`);
      const correctOptionIndex =
        typeof q.correctOptionIndex === 'number' && q.correctOptionIndex >= 0 && q.correctOptionIndex < 5
          ? q.correctOptionIndex
          : 0;
      const optionExplanations = (q.optionExplanations || [])
        .slice(0, 5)
        .map((e) => stripUnfilledSourceTemplate(e || ''));
      while (optionExplanations.length < 5) optionExplanations.push('');
      const hasOptionExplanations = optionExplanations.some((e) => e.length > 0);
      // Avval savolda bor manba (per-question), keyin umumiy bookReferences.
      const existingRefs = Array.isArray(q.references) ? q.references.filter((r) => r && (r.title || r.url)) : [];
      const refs = existingRefs.length ? existingRefs : bookReferences;
      // Model to'g'ri javobni deyarli DOIM A ga qo'yadi (kuzatilgan test:
      // 10 savoldan 10 tasida correctOptionIndex=0). Bunday testda talaba
      // hammasiga A belgilab 100% oladi. Variantlarni aralashtirib, to'g'ri
      // javob o'rnini shu bilan birga qayta hisoblaymiz.
      const shuffled = shuffleQuestionOptions({
        options: options.map((o, oi) => stripOptionLetterPrefix((o || '').trim(), oi)),
        correctOptionIndex,
        optionExplanations: hasOptionExplanations ? optionExplanations : undefined,
      });
      return {
        question: (q.question || '').trim(),
        options: shuffled.options,
        explanation: stripUnfilledSourceTemplate(q.explanation || ''),
        correctOptionIndex: shuffled.correctOptionIndex,
        ...(shuffled.optionExplanations ? { optionExplanations: shuffled.optionExplanations } : {}),
        ...(refs.length ? { references: refs } : {}),
      };
    });
  const sessionRefs =
    bookReferences.length > 0
      ? bookReferences
      : Array.from(
          new Map(
            questions
              .flatMap((q) => q.references || [])
              .filter((r) => r?.title || r?.url)
              .map((r) => [`${(r.title || '').toLowerCase()}|${r.pages || ''}|${r.url || ''}`, r]),
          ).values(),
        );
  return {
    ...data,
    topic: (data.topic || topic || '').trim() || topic,
    questions,
    references: sessionRefs,
    difficulty: data.difficulty,
    ...(data.domain ? { domain: data.domain } : {}),
  };
}

async function attachPerQuestionBookReferences(
  session: TestSession,
  subjectCode?: string,
): Promise<TestSession> {
  const code = (subjectCode || '').trim();
  const questions = session.questions || [];
  if (!code || !questions.length || session.domain === 'academic') return session;
  try {
    await ensureBackendAccessToken();
    const token = getBackendAccessToken();
    if (!token) return session;
    const data = await httpJson<{ results?: MedicalReference[][] }>(
      `${(import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL?.trim() || '/api'}/v1/education-ai/book-references/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        // MUHIM: httpJson body'ni o'zi JSON.stringify qiladi — bu yerda oldindan
        // stringify qilinsa, backend "string ichida string" qabul qilib 422
        // qaytaradi (shu bug tufayli test uchun per-savol kitob manbalari
        // sukut bo'yicha hech qachon ishlamagan edi).
        body: {
          subject_code: code,
          queries: questions.map((q) => q.question || ''),
          top_k: 3,
        },
      },
    );
    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) return session;
    const nextQuestions = questions.map((q, i) => {
      const refs = Array.isArray(results[i]) ? results[i] : [];
      const cleaned = refs.filter((r) => r && (r.title || r.url));
      return cleaned.length ? { ...q, references: cleaned } : q;
    });
    return normalizeTestSession(session.topic || '', { ...session, questions: nextQuestions }, nextQuestions.length);
  } catch (err) {
    console.warn('Per-question book references failed, keeping session refs', err);
    return session;
  }
}

/** Keys (klinik vaziyat) uchun RAG manba — backend'dan REAL retrieval orqali
 * keladi (kitob chunk'i, PubMed/Semantic Scholar maqolasi yoki Wikipedia
 * maqolasi — ichki VA tashqi internet manbalari). LLM bu ro'yxatni o'zi
 * to'ldirmaydi — faqat shu manbalarni raqami bilan iqtibos qiladi
 * ([1], [2], ...), havolalar esa dasturiy ravishda, real API javobidan
 * biriktiriladi (Vikipediyadagi kabi ishonchli tashqi link'lar). */
export interface CaseSource {
  index: number;
  type: 'book' | 'pubmed' | 'scholar' | 'wikipedia';
  title: string;
  authors?: string;
  meta?: string;
  url?: string;
  text?: string;
}

async function fetchCaseContext(
  topic: string,
  subjectCode: string | undefined,
): Promise<{ sources: CaseSource[]; contextText: string }> {
  try {
    await ensureBackendAccessToken();
    const token = getBackendAccessToken();
    if (!token) return { sources: [], contextText: '' };
    const data = await httpJson<{ sources?: CaseSource[]; context_text?: string }>(
      `${apiBaseUrlForCase()}/v1/education-ai/case-context/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: { topic, subject_code: subjectCode || '' },
        // Bu endpoint bir necha tashqi so'rov qiladi (kalit so'z tarjimasi,
        // PubMed, Semantic Scholar, Wikipedia, kitob RAG). httpJson ning
        // standart 12s timeout'i yetmay, so'rov uzilardi (nginx 499) va keys
        // manbasiz — ya'ni adabiyotlarsiz — yaratilib qolardi.
        timeoutMs: 90000,
      },
    );
    return {
      sources: Array.isArray(data.sources) ? data.sources : [],
      contextText: data.context_text || '',
    };
  } catch (err) {
    console.warn('Case RAG context (book + PubMed/Semantic Scholar) fetch failed:', err);
    return { sources: [], contextText: '' };
  }
}

function apiBaseUrlForCase(): string {
  return (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL?.trim() || '/api';
}

/** `sources` ro'yxatidan haqiqiy metadata asosida (LLM ishtirokisiz) "Foydalanilgan
 * adabiyotlar" bo'limini quradi — havolalar 100% real, chunki API'dan olingan. */
const REFERENCES_HEADING: Record<AppLanguage, string> = {
  uz: 'FOYDALANILGAN ADABIYOTLAR',
  ru: 'ИСПОЛЬЗОВАННАЯ ЛИТЕРАТУРА',
  en: 'REFERENCES USED',
};

function buildReferencesSection(sources: CaseSource[], language: AppLanguage = 'uz'): string {
  if (!sources.length) return '';
  const lines = sources.map((s) => {
    if (s.type === 'book') {
      return `[${s.index}] ${s.title}${s.meta ? `, ${s.meta}` : ''}`;
    }
    const kind = s.type === 'pubmed' ? 'PubMed' : s.type === 'wikipedia' ? 'Wikipedia' : 'Semantic Scholar';
    const authorBit = s.authors ? `${s.authors}. ` : '';
    const metaBit = s.meta ? ` (${s.meta})` : '';
    return `[${s.index}] ${authorBit}${s.title}${metaBit}. ${kind}: ${s.url || ''}`.trim();
  });
  const heading = REFERENCES_HEADING[language] ?? REFERENCES_HEADING.uz;
  return `\n\n${heading}:\n${lines.join('\n')}`;
}

function sourcePublisherLabel(type: CaseSource['type']): string {
  if (type === 'book') return 'Darslik';
  if (type === 'pubmed') return 'PubMed';
  if (type === 'wikipedia') return 'Wikipedia';
  return 'Semantic Scholar';
}

function sourcesToMedicalReferences(sources: CaseSource[]): MedicalReference[] {
  return sources.map((s) => ({
    title: s.title,
    citeIndex: s.index,
    kind: s.type,
    ...(s.authors ? { authors: s.authors } : {}),
    publisher: sourcePublisherLabel(s.type),
    ...(s.url ? { url: s.url } : {}),
    ...(s.type === 'book' && s.meta ? { pages: s.meta.replace(/-bet$/, '') } : {}),
    ...(s.type !== 'book' && s.meta ? { note: s.meta } : {}),
  }));
}

const ALL_TEST_LANGUAGES: AppLanguage[] = ['uz', 'ru', 'en'];

function toTestSessionContent(session: TestSessionContent): TestSessionContent {
  return {
    topic: session.topic,
    questions: session.questions,
    ...(session.references?.length ? { references: session.references } : {}),
  };
}

/**
 * Tarjima sifatini tekshiradi.
 * Eski bug: model yinish/bo'sh qaytarganda original (uz) matn `ru` deb saqlanardi.
 */
function isTestTranslationAcceptable(
  original: TestSessionContent,
  translated: TestSessionContent,
  targetLang: AppLanguage,
): boolean {
  const srcQs = original.questions || [];
  const dstQs = translated.questions || [];
  if (!srcQs.length || dstQs.length !== srcQs.length) return false;

  let identical = 0;
  let uzLooking = 0;
  let cyrillicQs = 0;
  let empty = 0;

  for (let i = 0; i < srcQs.length; i++) {
    const src = (srcQs[i]?.question || '').trim();
    const dst = (dstQs[i]?.question || '').trim();
    const opts = dstQs[i]?.options || [];
    if (!dst || opts.length !== (srcQs[i]?.options || []).length) {
      empty += 1;
      continue;
    }
    if (src && dst === src) identical += 1;
    if (looksLikeUzbekText(dst)) uzLooking += 1;
    if (cyrillicCharCount(dst) >= 8) cyrillicQs += 1;
  }

  const n = srcQs.length;
  if (empty > 0) return false;
  // 30%+ bir xil matn = tarjima amalda bo'lmagan
  if (identical > Math.max(1, Math.floor(n * 0.3))) return false;
  if (targetLang === 'ru') {
    if (cyrillicQs < Math.ceil(n * 0.6)) return false;
    if (uzLooking > Math.floor(n * 0.2)) return false;
  }
  if (targetLang === 'en' && uzLooking > Math.floor(n * 0.2)) return false;
  if (targetLang === 'uz' && cyrillicQs > Math.floor(n * 0.2)) return false;
  return true;
}

/** Bitta so'rovda nechta savolga variant izohi so'raladi. Kichik bo'lak =
 *  qisqaroq javob (JSON kesilish ehtimoli kam) va uzilish sodir bo'lganda
 *  yo'qoladigan savollar soni ham kam. */
const OPTION_EXPLANATION_CHUNK = 4;

/**
 * Har variant uchun qisqa izoh (nega to'g'ri / nega xato) — generate'dan KEYIN,
 * fonda. Asosiy generatsiyada so'ralmaydi: 5 ta izoh savol hajmini ~2 barobar
 * oshiradi va katta partiyalarda (40+ savol) javob token limitiga urilib JSON
 * kesilib qolardi. Alohida, bo'lak-bo'lak so'rov bunday xavfsiz — bir bo'lak
 * yiqilsa qolganlari baribir izohli bo'ladi.
 *
 * Bu maydon OnlineTest natijalarida "Nega xato" qatorini to'ldiradi (tashqi API
 * `optionExplanations` ni o'zgartirmasdan uzatadi) va iMentor test ekranida har
 * variant ostida ko'rinadi.
 */
function optionExplanationSystem(
  domain: SubjectDomain,
  bookContext: BookContext | undefined,
  outLang: string,
  language: AppLanguage,
): string {
  if (domain === 'academic') {
    return (
      `${SYS_ACADEMIC} Har savol uchun IKKITA narsa yoz.\n` +
      '1) `analysis` — to\'g\'ri javob tahlili: 8-12 gap. FAN mantiqi (qoida, formula, protokol, sozlama). ' +
      'Klinik sindrom, dori, lab, patofiziologiya YOZILMASIN.\n' +
      '(a) Qaysi shart/cheklov hal qiluvchi.\n' +
      '(b) Nega aynan shu javob mavzu/ma\'ruzaga mos.\n' +
      '(c) Nega yaqin distraktor xato.\n' +
      '2) `explanations` — HAR BIR variantga bittadan qisqa izoh (1 gap, 20 so\'zgacha).\n' +
      'JSON: {items:[{id:<berilgan id>, analysis:"...", explanations:[{i:<variantning berilgan i raqami>, text:"..."}]}]}. ' +
      (bookContext
        ? 'MANBA: darslik parchalariga tayaning. '
        : 'Faqat shu fan bilimiga tayaning. ') +
      `Til: ${outLang}. ${strictLanguageDirective(language)}`
    );
  }
  return (
    `${SYS_MEDICAL} Har savol uchun IKKITA narsa yoz.\n` +
    '1) `analysis` — to\'g\'ri javob tahlili: KAMIDA 8, KO\'PI BILAN 12 gap (230-330 so\'z). ' +
    'Bu shunchaki javob emas — TALABAGA KLINIK FIKRLASHNI o\'rgatadigan tahlil bo\'lsin, ' +
    'quyidagi ketma-ketlikda:\n' +
    '(a) Kalit ma\'lumotlar: vignettadagi qaysi belgilar/ko\'rsatkichlar hal qiluvchi va ' +
    'qaysilari chalg\'ituvchi ekanini ajrating (yosh, muddat, dinamika, laborator qiymat).\n' +
    '(b) Klinik fikrlash zanjiri: shikoyat → yetakchi sindrom → differensial doira → ' +
    'qaysi belgi qaysi tashxisni kesib tashlaydi → nega aynan shu javob qoladi.\n' +
    '(c) Patofiziologiya: qaysi ferment/retseptor/hujayra/tizim buzilgan va bu belgilarni ' +
    'qanday mexanizm bilan keltirib chiqaradi.\n' +
    '(d) Tasdiqlash: "oltin standart" va birinchi navbatdagi tekshiruv, undan kutiladigan ' +
    'ANIQ natija (ko\'rsatkich nomi va o\'zgarish yo\'nalishi bilan).\n' +
    '(e) Taktika: keyingi qadam va tanlangan usul/dori mexanizmi, nega aynan shu ustuvor.\n' +
    '(f) Xavf va prognoz: kechiktirilsa yuzaga keladigan asorat, "red flag" belgilari.\n' +
    'Har gap YANGI ma\'lumot bersin — bir fikrni boshqacha so\'z bilan takrorlamang; ' +
    'umumiy iboralar ("muhim ahamiyatga ega", "e\'tibor berish kerak") o\'rniga aniq ' +
    'atama, ko\'rsatkich, muddat va doza guruhini yozing. ' +
    'Savol matnini takrorlamang. Boshqa variantlarni bu yerda muhokama qilmang — ular ' +
    'uchun alohida izoh bor. "Shuning uchun ... eng maqsadga muvofiq" kabi xulosa gapini ' +
    'YOZMANG, u hech qanday ma\'lumot qo\'shmaydi.\n' +
    '2) `explanations` — HAR BIR variantga bittadan qisqa izoh: to\'g\'ri variant uchun ' +
    'nega aynan shu to\'g\'ri; qolganlari uchun nega bu klinik vaziyatda noto\'g\'ri. ' +
    'Har izoh 1 ta gap, 20 so\'zgacha.\n' +
    'JSON: {items:[{id:<berilgan id>, analysis:"...", explanations:[{i:<variantning berilgan i raqami>, text:"..."}]}]}. ' +
    'MUHIM: `i` — aynan o\'sha variantning berilgan raqami; izoh SHU variant haqida bo\'lsin. ' +
    'To\'g\'ri variant izohini birinchi o\'ringa ko\'chirmang — har bir variant o\'z `i` si bilan qaytsin. ' +
    'Har variant uchun bittadan yozing, birortasini tashlab ketmang.\n' +
    (bookContext
      ? 'MANBA: yuqoridagi darslik parchalariga TAYANING — ta\'rif, tasnif, ' +
        'ko\'rsatkich va davolash sxemasi imkon qadar o\'sha matndan olinsin. ' +
        'Parchalarda yo\'q narsani o\'ylab topmang; darslikda yo\'q bo\'lsa, umumiy tan ' +
        'olingan klinik amaliyotga tayaning va aniq raqam o\'rniga umumiy qoidani yozing. '
      : 'Faqat umumiy tan olingan klinik bilimga tayaning. ') +
    'HECH QACHON o\'ylab topilgan raqam, doza, statistika yoki havola yozmang. ' +
    'SAFSATA TAQIQLANADI: "muhim ahamiyatga ega", "e\'tibor berish kerak", "to\'g\'ri ' +
    'yondashuv talab etiladi" kabi hech narsa tushuntirmaydigan gaplar YOZMANG — ' +
    'har gapda aniq atama, mexanizm, ko\'rsatkich yoki qadam bo\'lsin.\n' +
    `Til: ${outLang}. ${strictLanguageDirective(language)}`
  );
}

async function attachOptionExplanations(
  session: TestSession,
  language: AppLanguage,
  subjectCode?: string,
): Promise<TestSession> {
  const questions = session.questions || [];
  const pendingIdx = questions
    .map((q, i) => i)
    .filter((i) => !(questions[i].optionExplanations || []).some((e) => (e || '').trim()));
  if (!pendingIdx.length) return session;

  const outLang = languageName(language);
  // MUHIM: eng uzun matn (klinik tahlil) aynan shu yerda yoziladi, shuning
  // uchun DARSLIK parchalari ham shu so'rovga ulanadi. Avval bu chaqiruvda
  // bookContext yo'q edi va tahlil manbasiz, faqat model xotirasidan chiqardi.
  const bookContext: BookContext | undefined =
    session.domain === 'academic' || !subjectCode?.trim()
      ? undefined
      : { subjectCode: subjectCode.trim(), topicQuery: session.topic };
  const merged = [...questions];
  const chunks: number[][] = [];
  for (let start = 0; start < pendingIdx.length; start += OPTION_EXPLANATION_CHUNK) {
    chunks.push(pendingIdx.slice(start, start + OPTION_EXPLANATION_CHUNK));
  }

  const runChunk = async (idxs: number[]) => {
    {
      // Variantlar RAQAMLANGAN holda yuboriladi va model har izohga o'sha
      // raqamni qaytarishi shart. Ilgari oddiy massiv so'ralardi va model
      // ko'pincha TO'G'RI variant izohini birinchi qilib qo'yardi — natijada
      // izohlar boshqa variantlar ostiga tushib qolardi (10 savoldan 5 tasida).
      const source = idxs.map((i) => ({
        id: i,
        question: questions[i].question,
        options: questions[i].options.map((opt, oi) => ({
          i: oi,
          text: stripOptionLetterPrefix(opt, oi),
        })),
        correctOptionIndex: questions[i].correctOptionIndex,
      }));
      try {
        const parsed = await openaiJson<unknown>({
          // Klinik fikrlash zanjiri va darslikka tayanish uchun kuchli model.
          // Avval OPENAI_FAST (mini) edi — u qisqa, umumiy javob berardi.
          // Bo'lak 4 tadan va parallel ketadi, shuning uchun vaqt sezilarli
          // uzaymaydi.
          model: OPENAI_CHAT,
          system: optionExplanationSystem(session.domain || 'clinical', bookContext, outLang, language),
          user: JSON.stringify(source),
          bookContext,
          // ~1800 token/savol: 8-12 gaplik klinik tahlil + 5 ta variant izohi
          // (o'zbek tilida ~3 token/so'z). Bo'lak 4 ta savoldan iborat, ya'ni
          // ~7600 — 16000 limitidan xavfsiz uzoqda. Ishlatilmagan limit hech
          // narsa turmaydi (faqat generatsiya qilingan tokenlar hisoblanadi),
          // kesilish esa butun bo'lakni yo'qotadi.
          maxTokens: Math.min(16000, idxs.length * 1800 + 400),
          temperature: 0.2,
          parse: (t) => parseJSONSafe<unknown>(t),
        });
        // Model javob shaklini turlicha berishi mumkin: {items:[…]}, {questions:[…]}
        // yoki to'g'ridan-to'g'ri massiv. Uchalasini ham qabul qilamiz — aks holda
        // izohlar jimgina yo'qoladi va ekranda hech narsa ko'rinmaydi.
        type OptionExplanationItem = {
          id?: number;
          analysis?: string;
          explanations?: { i?: number; index?: number; text?: string }[];
        };
        const box = (parsed || {}) as { items?: unknown; questions?: unknown };
        const items: OptionExplanationItem[] = (
          Array.isArray(parsed)
            ? parsed
            : Array.isArray(box.items)
              ? box.items
              : Array.isArray(box.questions)
                ? box.questions
                : []
        ) as OptionExplanationItem[];
        items.forEach((item, pos) => {
          // `id` — biz bergan global indeks; yo'q bo'lsa bo'lak ichidagi tartib.
          const rawId = typeof item?.id === 'number' ? item.id : undefined;
          const i = rawId !== undefined ? rawId : (idxs[pos] ?? -1);
          if (!merged[i]) return;
          // Kengaytirilgan tahlil. Generatsiyada `explanation` ataylab 1–2 gap
          // (birinchi ko'rinish tez chiqishi uchun) — bu yerda to'liqrog'i
          // bilan almashtiriladi. Qisqarib ketmasligi uchun faqat mavjudidan
          // uzunroq bo'lsa yoziladi.
          const analysis = stripUnfilledSourceTemplate(String(item?.analysis || '')).trim();
          if (analysis.length > (merged[i].explanation || '').trim().length) {
            merged[i] = { ...merged[i], explanation: analysis };
          }

          const list = Array.isArray(item?.explanations) ? item.explanations : [];
          const sized = new Array<string>(merged[i].options.length).fill('');
          let filled = 0;
          for (const row of list) {
            const at = typeof row?.i === 'number' ? row.i : typeof row?.index === 'number' ? row.index : -1;
            // Raqamsiz izohni ISHLATMAYMIZ: tartibiga ishonib bo'lmaydi, noto'g'ri
            // variant ostida turgan izoh umuman izoh yo'qligidan ko'ra yomonroq.
            if (at < 0 || at >= sized.length) continue;
            const text = stripUnfilledSourceTemplate(String(row?.text || '')).trim();
            if (!text) continue;
            sized[at] = text;
            filled += 1;
          }
          if (!filled) return;
          merged[i] = { ...merged[i], optionExplanations: sized };
        });
      } catch (err) {
        // Izohlar — qo'shimcha qiymat, majburiy emas: testni yiqitmaymiz.
        console.warn('Variant izohlari olinmadi (bo\'lak o\'tkazib yuborildi):', err);
      }
    }
  };

  const stillEmpty = (i: number) =>
    !(merged[i].optionExplanations || []).some((e) => (e || '').trim());

  await Promise.all(chunks.map(runChunk));

  // 2-urinish. Bitta so'rovning uzilishi (tarmoq, model xatosi, buzuq JSON)
  // butun bo'lakni izohsiz qoldiradi — prod'da aynan shu sodir bo'ldi:
  // bir testda 10/10 izoh, keyingisida 0/10. Qolganlarini kichikroq
  // bo'laklarda qayta so'raymiz.
  const retryIdx = pendingIdx.filter(stillEmpty);
  if (retryIdx.length) {
    console.warn(`Variant izohlari ${retryIdx.length} ta savolda kelmadi — qayta urinilmoqda`);
    const retryChunks: number[][] = [];
    for (let start = 0; start < retryIdx.length; start += 2) {
      retryChunks.push(retryIdx.slice(start, start + 2));
    }
    await Promise.all(retryChunks.map(runChunk));
  }

  return { ...session, questions: merged };
}

/** Tayyor testni boshqa tilga tarjima qiladi — faktlar/to'g'ri javob o'zgarmaydi, faqat matn. */
async function translateTestSession(
  content: TestSessionContent,
  targetLang: AppLanguage,
): Promise<TestSessionContent> {
  const outLang = languageName(targetLang);
  const source = {
    topic: content.topic,
    questions: content.questions.map((q) => ({
      question: q.question,
      options: q.options,
      correctOptionIndex: q.correctOptionIndex,
      explanation: q.explanation,
      optionExplanations: q.optionExplanations,
    })),
  };
  const translated = await openaiJson<{ topic?: string; questions?: TestQuestion[] }>({
    model: OPENAI_FAST,
    system:
      'You are a precise medical translator. Translate the given JSON test into ' +
      `${outLang}. Keep the EXACT same JSON structure, keys, array lengths and order. ` +
      'NEVER change correctOptionIndex or any number. Translate every text field ' +
      '(topic, question, options, explanation, optionExplanations) naturally, including any ' +
      'inline citation phrase like "(Manba: kitob, sahifa-bet)" — translate the label word too ' +
      `("Manba" → "Источник" for Russian, "Source" for English), keeping the book title and page number unchanged. ` +
      `CRITICAL: Output MUST be entirely in ${outLang}. Do NOT leave any Uzbek/source-language sentences. ` +
      'NEVER transliterate — do not rewrite Uzbek words in another alphabet. In particular, Russian ' +
      'output must be real Russian medical language ("5-летний ребёнок поступил в больницу с красными ' +
      'папулёзными высыпаниями на коже…"), never Uzbek written in Cyrillic ("5 ёшли бола терисида…") ' +
      'and it must not contain the letters қ ғ ҳ ў. ' +
      'Option texts must contain ONLY the answer itself — no "A.", "B)" or any letter/number prefix. ' +
      'Return ONLY valid JSON, no markdown fences.',
    user: JSON.stringify(source),
    // Savol boshiga token budjeti — pastda `translateBudgetPerQuestion` bilan
    // bir xil hisob: bo'lak kattaligi ham shunga qarab tanlanadi, shunda javob
    // 16000 limitiga urilib o'rtasidan kesilmaydi ("incomplete questions").
    maxTokens: Math.min(16000, content.questions.length * translateBudgetPerQuestion(content) + 500),
    temperature: 0.1,
    parse: (t) => parseJSONSafe(t),
  });

  if (!Array.isArray(translated.questions) || translated.questions.length !== content.questions.length) {
    throw new Error(`Translation to ${targetLang} returned incomplete questions`);
  }

  const questions: TestQuestion[] = content.questions.map((original, i) => {
    const t = translated.questions?.[i];
    const question = (t?.question || '').trim();
    const options = (t?.options || []).map((o) => (o || '').trim());
    const explanation = (t?.explanation || '').trim();
    if (!question || options.length !== original.options.length) {
      throw new Error(`Translation to ${targetLang} missing fields at question ${i + 1}`);
    }
    return {
      question,
      options,
      correctOptionIndex: original.correctOptionIndex,
      explanation,
      ...(original.optionExplanations
        ? {
            optionExplanations: (
              t?.optionExplanations?.length === original.optionExplanations.length
                ? t.optionExplanations
                : original.optionExplanations
            ).map((e) => (e || '').trim()),
          }
        : {}),
      ...(original.references ? { references: original.references } : {}),
    };
  });

  const result: TestSessionContent = {
    topic: (translated.topic || '').trim() || content.topic,
    questions,
    references: content.references,
  };
  if (!isTestTranslationAcceptable(content, result, targetLang)) {
    throw new Error(`Translation to ${targetLang} failed quality check (still source language)`);
  }
  return result;
}

/** Bitta savolni tarjima qilishga ketadigan taxminiy token. */
function translateBudgetPerQuestion(content: TestSessionContent): number {
  const hasOptionExplanations = content.questions.some((q) =>
    (q.optionExplanations || []).some((e) => (e || '').trim()),
  );
  // Izoh 8-12 gapga o'sgach bitta savol tarjimasi ~1200 tokengacha chiqadi.
  return hasOptionExplanations ? 1400 : 800;
}

async function translateChunkWithRetry(
  content: TestSessionContent,
  targetLang: AppLanguage,
): Promise<TestSessionContent> {
  try {
    return await translateTestSession(content, targetLang);
  } catch (err) {
    console.warn(`Test translation to ${targetLang} failed, retrying…`, err);
    return translateTestSession(content, targetLang);
  }
}

/**
 * Tarjimani BO'LAKLARGA bo'lib bajaradi.
 *
 * Avval butun test bitta so'rovda tarjima qilinardi. Klinik tahlil 8-12 gapga
 * uzaygandan keyin 30 ta savolning tarjimasi 16000 token limitiga urilib,
 * javob o'rtasidan kesilardi — natijada ru/en versiyalar butunlay yo'qolardi.
 */
async function translateTestSessionWithRetry(
  content: TestSessionContent,
  targetLang: AppLanguage,
): Promise<TestSessionContent> {
  const perQuestion = translateBudgetPerQuestion(content);
  const maxPerChunk = Math.max(1, Math.floor(14000 / perQuestion));
  if (content.questions.length <= maxPerChunk) {
    return translateChunkWithRetry(content, targetLang);
  }
  const chunks: TestSessionContent[] = [];
  for (let i = 0; i < content.questions.length; i += maxPerChunk) {
    chunks.push({ ...content, questions: content.questions.slice(i, i + maxPerChunk) });
  }
  const parts = await Promise.all(chunks.map((c) => translateChunkWithRetry(c, targetLang)));
  return {
    topic: parts[0]?.topic || content.topic,
    questions: parts.flatMap((p) => p.questions),
    references: content.references,
  };
}

/** Test'ni asosiy tilda generatsiya qilgandan keyin qolgan 2 tilga parallel tarjima qiladi.
 * Har doim 3 til (primary + 2 tarjima) bo'lishiga urinadi. */
async function attachTestTranslations(session: TestSession, primaryLang: AppLanguage): Promise<TestSession> {
  const remaining = ALL_TEST_LANGUAGES.filter((l) => l !== primaryLang);
  const baseContent = toTestSessionContent(session);
  const results = await Promise.allSettled(
    remaining.map((lang) => translateTestSessionWithRetry(baseContent, lang)),
  );
  const translations: Partial<Record<AppLanguage, TestSessionContent>> = {};
  results.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      translations[remaining[i]] = res.value;
    } else {
      console.warn(`Test translation to ${remaining[i]} failed:`, res.reason);
    }
  });
  return {
    ...session,
    primaryLanguage: primaryLang,
    ...(Object.keys(translations).length ? { translations } : {}),
  };
}


async function requestPresentationDeckFromAi(params: {
  topicTitle: string;
  topicId: string;
  topicType: SyllabusTopicType;
  subjectName: string;
  variantLabel: string;
  language: AppLanguage;
  mode: 'generate' | 'enhance';
  sourceFileName?: string;
  sourceText?: string;
  /** Mavzu bo'yicha tayyor ma'ruza matni — taqdimotning ASOSIY manbasi. */
  lectureText?: string;
  subjectCode?: string;
  onProgress?: (rawTextSoFar: string) => void;
}): Promise<PresentationContent> {
  assertOpenAiApiKey();
  const bookContext: BookContext | undefined = params.subjectCode
    ? { subjectCode: params.subjectCode, topicQuery: params.topicTitle }
    : undefined;
  const kind =
    params.topicType === 'practical'
      ? "amaliy mashg'ulot"
      : params.topicType === 'clinical'
        ? "klinik mashg'ulot"
        : "ma'ruza";
  const fallbackTitle = `${params.topicId} — ${params.topicTitle}`;

  // Taqdimot ma'ruza matni asosida quriladi; yuklangan PDF (bo'lsa) qo'shimcha
  // kontekst sifatida beriladi.
  const lecture = (params.lectureText || '').trim();
  const pdfText = (params.sourceText || '').trim();
  const sourceBlock =
    (lecture
      ? 'ASOSIY MANBA — shu mavzu bo\'yicha tayyorlangan MA\'RUZA MATNI. Taqdimot ' +
        'AYNAN shu matn asosida qurilsin: uning bo\'limlari, atamalari, misollari va ' +
        'mantiqiy ketma-ketligi saqlansin. O\'zingizdan yangi mavzu qo\'shmang.\n' +
        `<MARUZA_MATNI>\n${lecture.slice(0, 24000)}\n</MARUZA_MATNI>\n`
      : '') +
    (pdfText
      ? `QO'SHIMCHA MANBA — o'qituvchi yuklagan fayl ("${params.sourceFileName || 'fayl'}"). ` +
        'Faqat ma\'ruza matnini to\'ldirish uchun ishlating, unga zid bo\'lsa ma\'ruza matni ustun.\n' +
        `<QOSHIMCHA_MANBA>\n${pdfText.slice(0, 6000)}\n</QOSHIMCHA_MANBA>\n`
      : '');

  const system =
    `${SYS_MEDICAL} Sen FAQAT kontent qaytarasan — dizayn, rang, font haqida hech narsa yozma. ` +
    'Akademik ohang: aniq, ilmiy, tibbiy ta\'lim (FJSTI) standartiga mos. ' +
    'Har slaydda MAX 5 bullet. HAR bullet MINIMUM 15, MAXIMUM 36 so\'z: ' +
    'faqat atama emas — nima ekanligi, qanday ishlashi yoki klinik ahamiyati tushuntirilsin. ' +
    'Qisqa 2–4 so\'zli tezislar TAQIQLANGAN. ' +
    'MAJBURIY HAJM: KAMIDA 20, KO\'PI BILAN 25 slayd. Mavzu qanchalik keng bo\'lsa, ' +
    'shuncha ko\'p slayd. 20 tadan kam qaytarish XATO hisoblanadi — ma\'ruza matnini ' +
    'bo\'limlarga bo\'lib, har bir muhim bo\'limga alohida slayd ajrating. ' +
    'SLAYD TURLARI KVOTASI (majburiy, taqdimot bir xil bo\'lib qolmasin): ' +
    '1 ta title, 1 ta agenda, 1 ta summary (oxirgi), KAMIDA 2 ta statistics (body.stats — ' +
    'real raqamlar bilan), KAMIDA 2 ta comparison_table (body.comparison_rows + ' +
    'body.comparison_headers, masalan left="Birlamchi toshma", right="Ikkilamchi toshma" — ' +
    '"chap/o\'ng" kabi ma\'nosiz nom YOZMA), KAMIDA 1 ta process_flow (body.process_steps), ' +
    'KAMIDA 1 ta case_study (real klinik holat), KAMIDA 1 ta two_column (body.columns). ' +
    'Qolganlari content_bullets / image_focus. MUHIM: qaysi turni tanlasang, o\'sha turning ' +
    'body maydonini TO\'LDIR — statistics deb yozib stats\'ni bo\'sh qoldirma. ' +
    'HAR SLAYDDA image_query MAJBURIY va HAR BIRI BOSHQACHA bo\'lsin: inglizcha ANIQ ' +
    'atama — kasallik/anatomik tuzilma/protsedura nomi (masalan "impetigo", "psoriasis plaque", ' +
    '"skin biopsy procedure", "melanoma ABCDE"). Umumiy so\'rovlar ("skin", "medicine", ' +
    '"human anatomy") TAQIQLANGAN — ular butun taqdimotga bitta bir xil rasm keltiradi. ' +
    'summary (xulosa) slaydi FAQAT BITTA va ENG OXIRGI slayd bo\'lsin — o\'rtada xulosa yaratmang. ' +
    'summary bulletlari "Sarlavha: tushuntirish" formatida bo\'lsin. ' +
    'ADABIYOTLAR/MANBALAR SLAYDI KERAK EMAS — references yoki "Foydalanilgan adabiyotlar" ' +
    'slaydini umuman yaratmang va matn ichida havola/iqtibos yozmang. ' +
    'HAR BIR SLAYD NOYOB bo\'lsin: bir xil sarlavhani yoki bir xil bulletlarni ikkinchi ' +
    'marta qaytarmang, oldingi slaydni boshqacha so\'z bilan takrorlamang — har slayd ' +
    'ma\'ruzaning YANGI qismini yoritsin. ' +
    'TAVTOLOGIYA TAQIQLANGAN: bullet sarlavhani boshqa so\'z bilan qaytarmasin ' +
    '("Profilaktika choralarini ko\'rish oldini olishga qaratilgan" kabi bo\'sh jumlalar ' +
    'yozma). Har bullet YANGI fakt bersin: mexanizm, aniq belgi, preparat/doza guruhi, ' +
    'muddat yoki raqam. Bitta jumlani ikki slaydda takrorlash XATO. ' +
    'Agar 5 ta mazmunli bullet chiqmasa — 3-4 ta yozing, "suv quymang". ' +
    `${strictLanguageDirective(params.language)} Bu qoida butun JSON'ga tegishli: ` +
    'presentation_title, sarlavhalar, bulletlar, speaker_notes. ' +
    'image_query esa har doim inglizcha qoladi. ' +
    (bookContext
      ? 'Darslik parchalari qo\'shimcha kontekst; o\'ylab topilgan manba yozma.'
      : "O'ylab topilgan manba/havola qo'shma.");

  const user =
    `Fan: ${params.subjectName}. Yo'nalish: ${params.variantLabel}. ` +
    `Mavzu ${params.topicId} (${kind}): ${params.topicTitle}.\n${sourceBlock}\n` +
    (lecture
      ? 'VAZIFA: yuqoridagi ma\'ruza matnini 20-25 slaydlik dars taqdimotiga aylantiring. ' +
        'Matnni qisqartirib tashlamang — har bo\'lim va kichik bo\'lim slaydlarda aks etsin.\n'
      : 'VAZIFA: mavzu bo\'yicha 20-25 slaydlik dars taqdimoti yarating.\n') +
    'JSON: presentation_title, subject_area, author, slides[]. ' +
    'slides[].slide_type, title, subtitle, body{bullets,key_stat,stats,columns,comparison_headers,comparison_rows,process_steps,quote_text,quote_author}, ' +
    'image_query, speaker_notes. Ishlatilmagan body maydonlari bo\'sh string/array.';

  params.onProgress?.(translate(params.language, 'ai.progress.content'));

  const responseFormat = {
    type: 'json_schema',
    json_schema: PRESENTATION_JSON_SCHEMA,
  };

  let raw: Partial<PresentationContent> | null = null;
  try {
    raw = await openaiJson<Partial<PresentationContent>>({
      model: OPENAI_CHAT,
      system,
      user,
      maxTokens: 16000,
      temperature: 0.35,
      bookContext,
      responseFormat,
      parse: (t) => parseJSONSafe<Partial<PresentationContent>>(t),
    });
  } catch (err) {
    console.warn('Presentation json_schema failed, prompt fallback:', err);
    raw = await openaiJson<Partial<PresentationContent>>({
      model: OPENAI_CHAT,
      system: system + ' Return ONLY valid JSON matching the schema.',
      user,
      maxTokens: 16000,
      temperature: 0.3,
      bookContext,
      parse: (t) => parseJSONSafe<Partial<PresentationContent>>(t),
    });
  }

  params.onProgress?.(translate(params.language, 'ai.progress.normalize'));
  let content = normalizePresentationContent(raw, {
    title: fallbackTitle,
    subject: params.subjectName,
    author: 'iMentor',
  });
  // Adabiyotlar/manbalar slaydi taqdimotda ko'rsatilmaydi (foydalanuvchi so'rovi):
  // AI ni o'zi yaratib qo'ygan bo'lsa ham olib tashlanadi.
  content = {
    ...content,
    slides: content.slides.filter((s) => s.slide_type !== 'references'),
  };
  // Takroriy slaydlarni olib tashlaymiz — model uzun matnda bir slaydni
  // bir necha marta qaytarishi mumkin.
  content = dedupePresentationSlides(content);
  // Bullet darajasidagi takror: bir jumla ikki slaydda yoki sarlavhaning
  // qayta aytilishi (slayd darajasidagi dedupe buni ushlamaydi).
  content = dedupePresentationBullets(content);
  qaPresentationContent(content);
  params.onProgress?.(translate(params.language, 'ai.progress.images'));
  content = await resolvePresentationImages(content);
  return content;
}

function presentationReferencesTitle(language: AppLanguage): string {
  if (language === 'ru') return 'Использованные источники';
  if (language === 'en') return 'References';
  return 'Foydalanilgan manbalar';
}

function dedupePresentationRefs(refs: MedicalReference[]): MedicalReference[] {
  const out: MedicalReference[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!ref?.title?.trim()) continue;
    const key = `${ref.title.trim().toLowerCase()}|${ref.pages || ''}|${ref.url || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out.slice(0, 12);
}

/** Ichki (kitob+bet) + tashqi (PubMed/Scholar/Wikipedia) + rasm kreditlari. */

export const aiService = {
  async extractSyllabusFromDocument(file: File): Promise<SyllabusExtractResult> {
    try {
      if (syllabusFileExtension(file.name) === '.xlsx') {
        const rows = await readXlsxRows(await file.arrayBuffer());
        const parsed = parseSyllabusExcel(rows, file.name);
        if (!parsed.topics.length) {
          throw new Error('empty-document');
        }
        return normalizeSyllabusExtract(
          { topics: parsed.topics },
          file.name,
          parsed.asText,
        );
      }
      const docText = await extractSyllabusDocumentText(file);
      if (!docText.trim()) {
        throw new Error('empty-document');
      }
      return await extractSyllabusWithAi(file, docText);
    } catch (error) {
      console.error('Syllabus extraction failed:', error);
      throw error;
    }
  },

  async extractSyllabusTopics(file: File): Promise<SyllabusTopic[]> {
    const result = await aiService.extractSyllabusFromDocument(file);
    return result.topics;
  },

  async generateCaseStudy(
    topic: string,
    language: AppLanguage = 'uz',
    keywords: string[] = [],
    subjectCode?: string,
    scope: GenerationScope = emptyScope(topic),
  ): Promise<CaseStudySession> {
    try {
      assertOpenAiApiKey();
      const avoid = await previousCaseAvoidBlock(topic);
      const keywordFocus = buildCaseKeywordsFocusPrompt(keywords);
      // RAG: kitob chunk'lari + PubMed/Semantic Scholar'dan REAL manbalar — bir marta
      // olinadi va 3 ta fokus (profilaktika/davolash/tashxis) uchun baravar ishlatiladi.
      // RAG: kitob + PubMed — faqat klinik fanlar. Akademik fanda PubMed klinik
      // vignette'ni kuchaytiradi, shuning uchun o'tkazib yuboriladi.
      const { sources: caseSources, contextText: caseContextText } =
        scope.domain === 'academic'
          ? { sources: [] as CaseSource[], contextText: '' }
          : await fetchCaseContext(topic, subjectCode);

      // Har bir fokus MUSTAQIL urinadi — bittasi vaqtinchalik xato bersa ham
      // (tarmoq/JSON parse), qolgan ikkitasi qisqa/manbasiz eski rejimga
      // qaytarilmaydi (avval shunday edi: Promise.all bittasi rad etsa,
      // HAMMASI eski, manbasiz, qisqa promptga tushib qolardi — aynan shu
      // sabab foydalanuvchi qisqa/manbasiz javob ko'rgan edi). Endi shu
      // fokus alohida, o'sha boy/manbali prompt bilan yana bir marta uriniladi.
      const questions: CaseStudyQuestion[] = await Promise.all(
        CASE_STUDY_FOCUS_ORDER.map(async (focus) => {
          try {
            return await generateSingleCaseQuestion(
              topic,
              focus,
              language,
              keywordFocus,
              avoid,
              caseContextText,
              caseSources,
              scope,
            );
          } catch (err) {
            console.warn(`Case focus "${focus}" birinchi urinishda muvaffaqiyatsiz, qayta urinilmoqda:`, err);
            return generateSingleCaseQuestion(
              topic,
              focus,
              language,
              keywordFocus,
              avoid,
              caseContextText,
              caseSources,
              scope,
            );
          }
        }),
      );

      const data: CaseStudySession = {
        topic,
        questions,
        references: [],
        domain: scope.domain,
      };
      const normalized = normalizeCaseSession(topic, data, language);
      return keywords.length ? { ...normalized, keywords } : normalized;
    } catch (error) {
      console.error("Case study generation failed:", error);
      throw error;
    }
  },

  /**
   * Tez yo‘l: faqat asosiy tilda 1 ta AI so‘rov.
   * Tarjima + kitob manbalari — `enrichTestSession` (fonda, UI kutmaydi).
   */
  async generateTests(
    topic: string,
    count: number = 10,
    language: AppLanguage = 'uz',
    subjectCode?: string,
    difficulty: TestDifficulty = DEFAULT_TEST_DIFFICULTY,
    scope: GenerationScope = emptyScope(topic),
  ): Promise<TestSession> {
    assertOpenAiApiKey();
    const domain = scope.domain;
    const scopeBlock = buildScopePrompt(scope);
    const safeCount = Math.min(90, Math.max(10, Math.round(count) || 10));
    const outLang = languageName(language);
    const bookContext: BookContext | undefined =
      domain === 'academic' || !subjectCode?.trim()
        ? undefined
        : { subjectCode: subjectCode.trim(), topicQuery: topic };
    // Avoid-list ixtiyoriy — timeout bilan, generate’ni ushlab turmasin
    const avoid = await Promise.race([
      previousTestAvoidBlock(topic),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 800)),
    ]);

    const generate = async (requestedCount: number, extraUser = ''): Promise<TestSession> => {
      const variety = buildTestVarietyPrompt(topic, requestedCount, difficulty, domain);
      const levelBlock = buildTestDifficultyPrompt(difficulty, domain);
      // ~640 token/savol: 3 zich jumla + 5–7 gaplik klinik explanation.
      const scaledMaxTokens = Math.min(16000, Math.ceil(requestedCount * 640) + 500);
      // OpenAI + server RAG: book_references completion javobidan olinadi.
      let bookReferences: MedicalReference[] = [];
      const parsed = await openaiJson({
        model: OPENAI_CHAT,
        system:
          `${sysRole(domain)} ` +
          (domain === 'academic'
            ? 'Oliy ta\'lim testlari SHU FAN bo\'yicha. Klinik bemor, KROK/USMLE vignette YO\'Q. '
            : 'Oliy tibbiy ta\'lim testlari (KROK / USMLE Step 2 CK), maktab/kollej emas. ') +
          `${GENERATION_UNIQUENESS_RULE} ${jsonReferencesRule(Boolean(bookContext))} ` +
          `${requestedCount} ta test JSON: ` +
          `{topic, references:[], questions:[{question, options[5], correctOptionIndex, explanation, references:[]}]}. ` +
          `${testExplanationInstruction(difficulty, domain)} ` +
          (domain === 'academic'
            ? 'Uydirma foiz, PMID, maqola yoki havola YOZILMASIN. Bemor+kasallik+dori vignette TAQIQLANADI. '
            : 'Stemda kamida IKKITA realistik vital/lab qiymat (birlik bilan) bo\'lsin. Uydirma foiz, PMID, ' +
              'maqola yoki havola YOZILMASIN. Oliy tibbiy ta\'lim saviyasi: klassik bitta ABG/lab = tashxis TAQIQLANADI. ') +
          `${levelBlock} ` +
          'optionExplanations YOZMANG. ' +
          `Til: ${outLang}. ${strictLanguageDirective(language)}`,
        user:
          `${extraUser}${scopeBlock}\n\n${variety}${avoid}\n\n${requestedCount} ta NOYOB, QIYIN, ZICH savol. ${testStemInstruction(difficulty, domain)} ` +
          (domain === 'academic'
            ? 'Klinik vignette (yoshli bemor + kasallik + lab) yozilsa — butunlay almashtiring. ' +
              'Har savolni yozishdan oldin: "to\'g\'ri javob shu fan/mavzu/ma\'ruzadami? Bemor yo\'qmi?" — yo\'q bo\'lsa almashtiring. ' +
              'explanation — 5-7 gaplik FAN tahlili, klinik patofiziologiya emas. Faqat valid JSON.'
            : 'Maktab darajasidagi qisqa vignette ("yosh + 1 lab + qaysi tashxis ehtimoliy?") yozilsa — butunlay almashtiring. ' +
              'Har savolni yozishdan oldin: "to\'g\'ri javob mavzudami? Stemdan IKKITA belgi kerakmi? ' +
              'Komorbidlik/dori/trap bormi? Ikkinchi variant ham to\'g\'rimi? 3 zich jumlami?" — yo\'q bo\'lsa almashtiring. ' +
              'explanation — 5-7 gaplik klinik tahlil. Faqat valid JSON.'),
        maxTokens: scaledMaxTokens,
        temperature: testDifficultyTemperature(difficulty),
        bookContext,
        onBookReferences: (refs) => {
          bookReferences = refs;
        },
        parse: (t) => parseJSONSafe<TestSession>(t),
      });
      return { ...normalizeTestSession(topic, { ...parsed, difficulty, domain }, requestedCount, bookReferences) };
    };

    /** Savol matnlari so'ralgan tilda ekanini tekshiradi. */
    const sessionLanguageWrong = (s: TestSession): boolean =>
      outputLanguageLooksWrong((s.questions || []).map((q) => q.question).join(' '), language);

    const sessionHasClinicalLeak = (s: TestSession): boolean =>
      academicBundleHasClinicalLeak(
        (s.questions || []).flatMap((q) => [q.question, q.explanation, ...(q.options || [])]),
      );

    try {
      let data = await generate(safeCount);
      // Faqat juda buzilgan bo‘lsa qayta urin (kam savol) — weak sifat uchun ikkinchi to‘liq generate yo‘q
      if (!data.questions?.length || data.questions.length < Math.min(6, safeCount)) {
        data = await generate(Math.min(safeCount, 10));
      }
      // Til nazorati: model boshqa tilda (ko'pincha kirilcha o'zbekchada)
      // qaytarsa — bir marta qayta so'raymiz.
      if (sessionLanguageWrong(data)) {
        console.warn(`Test ${language} tilida emas, qayta urinilmoqda`);
        try {
          const retry = await generate(safeCount);
          if (retry.questions?.length && !sessionLanguageWrong(retry)) data = retry;
        } catch (err) {
          console.warn('Test tili bo\'yicha qayta urinish muvaffaqiyatsiz:', err);
        }
      }
      if (domain === 'academic' && sessionHasClinicalLeak(data)) {
        try {
          const retry = await generate(safeCount, `${ACADEMIC_CLINICAL_RETRY_BAN}\n\n`);
          if (retry.questions?.length && !sessionHasClinicalLeak(retry)) data = retry;
        } catch (err) {
          console.warn('Test klinik sizib chiqish bo\'yicha qayta urinish muvaffaqiyatsiz:', err);
        }
      }
      return { ...normalizeTestSession(topic, data, safeCount), primaryLanguage: language, difficulty, domain };
    } catch (error) {
      console.warn('Test generation failed, compact retry…', error);
      const data = await generate(Math.min(safeCount, 10));
      return { ...normalizeTestSession(topic, data, safeCount), primaryLanguage: language, difficulty, domain };
    }
  },

  /** Tarjima (ru/en) + kitob manbalari — generate’dan KEYIN fonda. */
  async enrichTestSession(
    session: TestSession,
    language: AppLanguage = 'uz',
    subjectCode?: string,
  ): Promise<TestSession> {
    const primary = session.primaryLanguage || language;
    // MUHIM tartib: variant izohlari TARJIMADAN OLDIN qo'shiladi — aks holda
    // tarjima manbasida ular bo'lmaydi va ru/en versiyalar izohsiz qolardi.
    const withOptionExplanations = await attachOptionExplanations(session, primary, subjectCode);
    const [withRefs, translated] = await Promise.all([
      attachPerQuestionBookReferences(withOptionExplanations, subjectCode),
      attachTestTranslations(withOptionExplanations, primary),
    ]);
    const translations = translated.translations
      ? Object.fromEntries(
          Object.entries(translated.translations).map(([lang, content]) => [
            lang,
            {
              ...content,
              questions: content.questions.map((q, i) => ({
                ...q,
                ...(withRefs.questions[i]?.references?.length
                  ? { references: withRefs.questions[i].references }
                  : {}),
              })),
              ...(withRefs.references?.length ? { references: withRefs.references } : {}),
            },
          ]),
        )
      : undefined;

    return {
      ...withRefs,
      primaryLanguage: primary,
      ...(translations && Object.keys(translations).length
        ? { translations: translations as TestSession['translations'] }
        : {}),
    };
  },

  async generateLectureNotes(
    topic: string,
    description: string = '',
    language: AppLanguage = 'uz',
    subjectCode?: string,
    /** Matn generatsiya bo'lgan sari chaqiriladi — foydalanuvchi darhol
     * ko'rishi uchun (kutish tuyg'usini yo'qotadi, umumiy vaqt bir xil). */
    onProgress?: (textSoFar: string) => void,
    domain: SubjectDomain = 'clinical',
  ): Promise<LectureNote> {
    try {
      assertOpenAiApiKey();
      const outLang = languageName(language);
      const bookContext: BookContext | undefined = subjectCode ? { subjectCode, topicQuery: topic } : undefined;
      const applyBlock = domain === 'academic' ? '## Amaliy qo\'llash' : '## Klinik / amaliy qo\'llash';
      const domainGuard =
        domain === 'academic'
          ? 'DOMEN: klinik BO\'LMAGAN fan (informatika, matematika, elektronika, til, ijtimoiy fan va h.k.). ' +
            'BEMOR, kasallik, tashxis, dori-darmon, KROK/USMLE uslubidagi klinik misollar TAQIQLANADI — ' +
            'faqat shu fanga xos amaliy misol va qo\'llanmalar keltiring. '
          : '';
      const requestLecture = () => openaiTextStream({
        model: OPENAI_CHAT,
        system: `${sysRole(domain)} DARAJA: bu OLIY TA'LIM (universitet, 3-6 kurs yoki rezidentura) ma\'ruzasi — ` +
          'maktab yoki 1-kurs kirish darsi EMAS. O\'quvchi allaqachon asosiy fanlarni bilishini hisobga oling: ' +
          'soddalashtirilgan ta\'riflar bilan boshlamang, darhol chuqur ilmiy-nazariy tahlilga o\'ting. ' +
          domainGuard +
          'Ma\'ruza faqat Markdown. HAJM: qisqa konspekt EMAS — real 60-90 daqiqalik ' +
          'universitet ma\'ruzasi (taxminan 3500-6000 so\'z yoki undan ko\'p). ' +
          'Tuzilma majburiy: # sarlavha; ## Kirish (ahamiyat, maqsad, reja — kamida 3-4 paragraf); ' +
          'kamida 7-9 ta ## asosiy bo\'lim (har birida kamida 4-6 to\'liq paragraf + kerak bo\'lsa ### ' +
          `va ro\'yxatlar; ta\'rif, mexanizm, tasnif, misol); ${applyBlock} (kamida 3-4 ` +
          'paragraf); ## Xulosa (asosiy xulosalar). ' +
          'CHUQURLIK MAJBURIY (bu eng muhim talab): har bir tushuncha uchun NIMA emas, NEGA va QANDAY ' +
          'ekanini tushuntiring — molekulyar/hujayraviy/fiziologik mexanizmlarni bosqichma-bosqich ' +
          'yoritilsin (masalan reseptor→signal yo\'li→hujayra javobi, yoki sabab→patofiziologik ' +
          'zanjir→klinik natija), aniq raqamlar/qiymatlar/tasniflar (masalan ICD, WHO, standart ' +
          'shkalalar) keltiring, o\'xshash holatlarni bir-biridan farqlang (differensial jihatlar), ' +
          'ziddiyatli/munozarali qarashlar bo\'lsa ularni ham ko\'rsating. HAR BIR paragrafda kamida ' +
          'bitta aniq dalil, mexanizm, raqam yoki misol bo\'lsin — umumiy ta\'riflarni qayta ' +
          'ifodalovchi "suvli" jumlalar taqiqlanadi. Sayoz umumiy gaplar bilan cheklanmang — chuqur ' +
          'tushuntiring, ta\'rif va misollarni ochib yozing. ' +
          (bookContext
            ? 'Berilgan darslik parchalaridagi BARCHA tegishli tafsilotlardan to\'liq foydalaning — ' +
              'qisqartirmasdan, kengaytirib tushuntiring. HAR BIR ## bo\'limda kamida bitta ' +
              '"(Manba: <HAQIQIY kitob nomi>, <HAQIQIY sahifa raqami>)" ko\'rsating — "<...>" ' +
              'belgilarini haqiqiy nom/raqam bilan almashtiring, "kitob nomi"/"sahifa-bet" so\'zlarini ' +
              'o\'zgarishsiz qoldirmang; aniq bilmasangiz manba qatorini butunlay tashlab keting.'
            : 'Tashqi havola yoki o\'ylab topilgan manba qo\'shmang.'
          ) + ` ${textReferencesRule(Boolean(bookContext), language)} Til: ${outLang}. ${strictLanguageDirective(language)}`,
        user:
          `Mavzu: "${topic}". Qo'shimcha: ${description || '—'}. ` +
          'UZUN va BATAFSIL, OLIY TA\'LIM darajasidagi ma\'ruza matni yozing — qisqa xulosa, ' +
          'tezislar yoki maktab darsligidagi soddalashtirilgan bayon emas. Universitet talabasi ' +
          'darsdan keyin mustaqil o\'qib, mexanizmni to\'liq tushunib olishi kerak bo\'lgan darajada ' +
          'yozing. Kamida 7 ta asosiy bo\'lim, har biri bir necha to\'liq paragraf, har bir paragrafda ' +
          'aniq mexanizm/raqam/misol. ' +
          (bookContext
            ? `Darslik manbalarini matn ichida (${sourceWords(language).label}: ...) ko'rsating va ` +
              `oxirida "## ${sourceWords(language).heading}" bo'limini qo'shing.`
            : ''),
        maxTokens: 16000,
        temperature: 0.4,
        bookContext,
        onDelta: onProgress ?? (() => {}),
      });

      let content = await requestLecture();
      // Til nazorati: model so'ralgan til o'rniga o'zbekchani (ko'pincha kirilda)
      // qaytarsa — bir marta qayta so'raymiz.
      if (outputLanguageLooksWrong(content || '', language)) {
        console.warn(`Ma'ruza matni ${language} tilida emas, qayta urinilmoqda`);
        try {
          const retry = await requestLecture();
          if (!outputLanguageLooksWrong(retry || '', language)) content = retry;
        } catch (err) {
          console.warn('Ma\'ruza tili bo\'yicha qayta urinish muvaffaqiyatsiz:', err);
        }
      }

      return {
        topic: topic,
        content: normalizeSourceHeading(stripPlaceholderManba(content || ''), language)
      };
    } catch (error) {
      console.error("Lecture Note generation failed:", error);
      throw error;
    }
  },

  async generateImagePrompt(title: string, content: string[]): Promise<string> {
    try {
      const text = await openaiText({
        model: OPENAI_FAST,
        system: 'One English image prompt for medical slide. Output prompt only, no quotes.',
        user: `Title: ${title}\nBullets:\n${content.join('\n')}`,
        maxTokens: 200,
        temperature: 0.5,
      });
      return text.trim();
    } catch (error) {
      console.error(error);
      return `Professional medical illustration for: ${title}`;
    }
  },

  async generateExercises(topic: string): Promise<Exercise> {
    try {
      return openaiJson({
        model: OPENAI_CHAT,
        system: `${SYS_MEDICAL} JSON: {title, description, tasks:[{task, type, options?, answer}]}. Til: O'zbek.`,
        user: `Mavzu: "${topic}". Interaktiv mashqlar.`,
        maxTokens: 2048,
        parse: (t) => parseJSONSafe<Exercise>(t),
      });
    } catch (error) {
      console.error("Exercise generation failed:", error);
      throw error;
    }
  },

  async generatePresentationDeck(params: {
    topicTitle: string;
    topicId: string;
    topicType: SyllabusTopicType;
    subjectName: string;
    variantLabel: string;
    language: AppLanguage;
    mode: 'generate' | 'enhance';
    sourceFileName?: string;
    sourceText?: string;
    /** Mavzu bo'yicha tayyor ma'ruza matni — taqdimotning asosiy manbasi. */
    lectureText?: string;
    subjectCode?: string;
    onProgress?: (rawTextSoFar: string) => void;
  }): Promise<PresentationContent> {
    return requestPresentationDeckFromAi(params);
  },

  async generateImage(_prompt: string): Promise<string | null> {
    // Maxfiylik: tashqi rasm generatsiya servislari o‘chirilgan (pollinations.ai).
    return null;
  },
};
