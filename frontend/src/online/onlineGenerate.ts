/**
 * Online portalda AI bilan material yaratish.
 *
 * Mavjud `aiService` AYNAN o'zgartirilmasdan ishlatiladi — ma'ruza, test va
 * keys promptlari uzoq sozlangan va ikkinchi nusxasini yuritish ularni
 * bir-biridan uzoqlashtirardi.
 *
 * Darslik qidiruvi (RAG) fan kodi bo'yicha ishlaydi: server kodni avval
 * `core_coursesyllabus` da, topmasa `online_syllabus` da qidiradi va
 * kafedrasini aniqlaydi.
 *
 * Bundan tashqari mavzuning O'Z materiallari ham kontekstga qo'shiladi —
 * o'qituvchi yozgan ma'ruza, yuklagan tarqatma va taqdimot matni. Ilgari
 * AI ga faqat mavzu NOMI borardi, shuning uchun savollar mavzu sarlavhasi
 * bo'yicha umumiy va sayoz chiqardi: darslikdagi ta'rifni so'raydigan,
 * bitiruv kursi uchun emas.
 */

import { aiService, type CaseStudySession, type TestSession } from '../services/aiService';
import { makeGenerationScope, type SubjectDomain } from '../utils/subjectDomain';
import { caseFocusLabel } from '../utils/caseFocusLabels';
import type { AppLanguage } from '../i18n/language';
import type { Material } from './onlineTeacherApi';

export type GenerateInput = {
  subjectName: string;
  subjectCode: string;
  departmentName: string;
  topicTitle: string;
  language: AppLanguage;
  /** Mavzuga allaqachon yuklangan materiallar — kontekst shulardan yig'iladi. */
  materials?: Material[];
};

/**
 * Bitiruv kursi darajasi.
 *
 * `aiService` promptlarida "oliy tibbiy ta'lim" darajasi bor, lekin kurs
 * aytilmagan. 6-kurs — davolash amaliyotiga chiqish oldidagi kurs: talaba
 * tashxisni ta'riflab emas, bemorni boshqarib ko'rsatishi kerak.
 */
const CLINICAL_LEVEL = [
  "TALABA DARAJASI: tibbiyot instituti 6-kurs (bitiruv kursi), davolash yo'nalishi.",
  "Savol va vaziyatlar shu darajaga mos bo'lsin:",
  "- Ta'rif, tasnif yoki \"nima deb ataladi\" tipidagi savol TAQIQLANADI.",
  '- Har savol qaror talab qilsin: qaysi tekshiruv, qaysi dori, qaysi doza,',
  '  qaysi holatda kontrendikatsiya, keyingi qadam nima.',
  '- Kamida ikkita variant ishonarli bo\'lsin; farqni faqat mavzuni tushungan',
  '  odam ko\'ra olsin (komorbidlik, dori o\'zaro ta\'siri, yosh, buyrak funksiyasi).',
  '- Raqamlar birligi bilan yozilsin va real oraliqda bo\'lsin.',
].join('\n');

/**
 * Klinik bo'lmagan fanlar uchun daraja (2026-09-25). Ilgari yuqoridagi klinik
 * ko'rsatma HAR fanga qo'shilardi: anatomiya yoki til mavzusiga ham "qaysi
 * dori, qaysi doza" talab qilinardi — domen qoidasiga to'g'ridan-to'g'ri zid.
 */
const BIOMEDICAL_LEVEL = [
  'TALABA DARAJASI: tibbiyot instituti, fundamental (bemorsiz) fan.',
  "Savol va vaziyatlar shu darajaga mos bo'lsin:",
  "- Ta'rif, tasnif yoki \"nima deb ataladi\" tipidagi savol TAQIQLANADI.",
  '- Har savol tushunishni talab qilsin: mexanizm, tuzilma, me\'yordan chetlanish,',
  '  ko\'rsatkich qaysi tomonga va nega siljiydi.',
  '- Individual bemor kartasi (yosh + shikoyat + tashxis + dori) YOZILMASIN.',
  "- Raqamlar birligi bilan yozilsin va real oraliqda bo'lsin.",
].join('\n');

const ACADEMIC_LEVEL = [
  'TALABA DARAJASI: oliy ta\'lim, shu fanning o\'z doirasi.',
  "Savol va vaziyatlar shu darajaga mos bo'lsin:",
  "- Ta'rif, tasnif yoki \"nima deb ataladi\" tipidagi savol TAQIQLANADI.",
  '- Har savol tushunchani aniq vazifaga qo\'llashni talab qilsin.',
  '- Bemor, kasallik, dori va laboratoriya ko\'rsatkichi ISHLATILMASIN.',
].join('\n');

function levelDirective(domain: SubjectDomain): string {
  if (domain === 'clinical') return CLINICAL_LEVEL;
  if (domain === 'biomedical') return BIOMEDICAL_LEVEL;
  return ACADEMIC_LEVEL;
}

function scopeFor(input: GenerateInput) {
  // Fan klinikmi yoki akademikmi — savol va keys uslubini shu hal qiladi.
  return makeGenerationScope({
    topic: input.topicTitle,
    subjectName: input.subjectName,
    departmentName: input.departmentName,
    subjectCode: input.subjectCode,
  });
}

/** Bitta PDF dan matn oladi. Xato bo'lsa jimgina bo'sh qaytaradi. */
async function pdfText(url: string, limit: number): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) return '';
    const buffer = await res.arrayBuffer();
    // 25 MB dan katta faylni brauzerda ochish sahifani muzlatadi.
    if (buffer.byteLength > 25 * 1024 * 1024) return '';

    const { pdfjsLib } = await import('../utils/pdfjsSetup');
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

    const parts: string[] = [];
    let total = 0;
    // Butun kitobni emas — dastlabki sahifalar mavzuning o'zagini beradi.
    const pages = Math.min(pdf.numPages, 40);
    for (let n = 1; n <= pages && total < limit; n += 1) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const line = (content.items as Array<{ str?: string }>)
        .map((it) => it.str || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (line) {
        parts.push(line);
        total += line.length;
      }
    }
    return parts.join('\n').slice(0, limit);
  } catch {
    return '';
  }
}

const KIND_TITLE: Record<string, string> = {
  lecture: "MA'RUZA MATNI",
  case: 'AVVALGI VAZIYATLI MASALA',
  handout: 'TARQATMA MATERIAL',
  presentation: 'TAQDIMOT',
};

/**
 * Mavzu materiallaridan AI uchun kontekst yig'adi.
 *
 * Ma'ruza va keys matni to'g'ridan-to'g'ri olinadi; tarqatma va taqdimot PDF
 * bo'lgani uchun matni brauzerda ajratib olinadi. Fayl ochilmasa yoki bo'sh
 * bo'lsa — shunchaki o'tkazib yuboriladi, generatsiya to'xtamaydi.
 */
export async function buildTopicContext(
  materials?: Material[],
  domain: SubjectDomain = 'clinical',
): Promise<string> {
  const list = materials || [];
  if (list.length === 0) return '';

  const blocks: string[] = [];

  for (const kind of ['lecture', 'case'] as const) {
    const m = list.find((x) => x.kind === kind);
    const text = String((m?.payload as { text?: string } | undefined)?.text || '').trim();
    if (text) blocks.push(`### ${KIND_TITLE[kind]}\n${text.slice(0, 9000)}`);
  }

  // Fayllar parallel o'qiladi — ketma-ket qilinsa o'qituvchi uzoq kutardi.
  const files = list.filter((m) => m.file && (m.kind === 'handout' || m.kind === 'presentation'));
  const extracted = await Promise.all(
    files.slice(0, 4).map(async (m) => {
      const text = await pdfText(`/media/${m.file}`, 4000);
      if (!text.trim()) return '';
      const name = m.file_name || m.title || '';
      return `### ${KIND_TITLE[m.kind]}${name ? ` — ${name}` : ''}\n${text}`;
    }),
  );
  blocks.push(...extracted.filter(Boolean));

  if (blocks.length === 0) return '';
  return `${levelDirective(domain)}\n\n${blocks.join('\n\n')}`;
}

/** Ma'ruza matni. `onProgress` bilan matn yozilayotgani ko'rinib turadi. */
export async function generateLecture(
  input: GenerateInput,
  onProgress?: (soFar: string) => void,
): Promise<string> {
  const scope = scopeFor(input);
  const note = await aiService.generateLectureNotes(
    input.topicTitle,
    input.subjectName,
    input.language,
    input.subjectCode,
    onProgress,
    scope.domain,
  );
  return note.content || '';
}

/** 10 ta test savoli — to'g'ri javob indeksi bilan. */
export async function generateTest(input: GenerateInput, count = 10): Promise<TestSession> {
  const scope = scopeFor(input);
  const context = await buildTopicContext(input.materials, scope.domain);
  return aiService.generateTests(
    input.topicTitle,
    count,
    input.language,
    input.subjectCode,
    'hard',
    scope,
    context,
  );
}

/** Vaziyatli masala — matn va yechim. */
export async function generateCase(input: GenerateInput): Promise<CaseStudySession> {
  const scope = scopeFor(input);
  const context = await buildTopicContext(input.materials, scope.domain);
  return aiService.generateCaseStudy(
    input.topicTitle,
    input.language,
    [],
    input.subjectCode,
    scope,
    context,
  );
}

/**
 * Keys sessiyasidan talabaga ko'rsatiladigan yaxlit matn yig'adi.
 *
 * Uchta fokus (tashxis / davolash / profilaktika) alohida vaziyat va yechim
 * bo'lib keladi — talaba oynasida ular bitta o'qiladigan matnga birlashadi.
 */
export function caseToText(session: CaseStudySession): string {
  const parts: string[] = [];
  for (const q of session.questions || []) {
    const scenario = String(q.scenario || '').trim();
    const answer = String(q.answer || '').trim();
    if (!scenario && !answer) continue;
    // Sarlavha domenga mos: bemorsiz fanda "Tashxis/Davolash" emas.
    const label = q.focus ? caseFocusLabel(q.focus, 'uz', session.domain) : 'Vaziyat';
    parts.push(`### ${label}`);
    if (scenario) parts.push(scenario);
    if (answer) parts.push(`**Yechim:** ${answer}`);
  }
  return parts.join('\n\n').trim();
}
