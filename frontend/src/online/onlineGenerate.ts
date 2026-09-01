/**
 * Online portalda AI bilan material yaratish.
 *
 * Mavjud `aiService` AYNAN o'zgartirilmasdan ishlatiladi — ma'ruza, test va
 * keys promptlari uzoq sozlangan va ikkinchi nusxasini yuritish ularni
 * bir-biridan uzoqlashtirardi.
 *
 * Darslik qidiruvi (RAG) fan kodi bo'yicha ishlaydi: server kodni avval
 * `core_coursesyllabus` da, topmasa `online_syllabus` da qidiradi va
 * kafedrasini aniqlaydi. Shuning uchun bu yerda qo'shimcha hech narsa
 * uzatilmaydi — online fanga kafedra biriktirilgan bo'lsa, AI o'sha
 * kafedra darsliklaridan yozadi.
 */

import { aiService, type CaseStudySession, type TestSession } from '../services/aiService';
import { makeGenerationScope } from '../utils/subjectDomain';
import type { AppLanguage } from '../i18n/language';

export type GenerateInput = {
  subjectName: string;
  subjectCode: string;
  departmentName: string;
  topicTitle: string;
  language: AppLanguage;
};

function scopeFor(input: GenerateInput) {
  // Fan klinikmi yoki akademikmi — savol va keys uslubini shu hal qiladi.
  return makeGenerationScope({
    topic: input.topicTitle,
    subjectName: input.subjectName,
    departmentName: input.departmentName,
    subjectCode: input.subjectCode,
  });
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
export async function generateTest(
  input: GenerateInput,
  count = 10,
): Promise<TestSession> {
  return aiService.generateTests(
    input.topicTitle,
    count,
    input.language,
    input.subjectCode,
    'hard',
    scopeFor(input),
  );
}

/** Vaziyatli masala — matn va yechim. */
export async function generateCase(input: GenerateInput): Promise<CaseStudySession> {
  return aiService.generateCaseStudy(
    input.topicTitle,
    input.language,
    [],
    input.subjectCode,
    scopeFor(input),
  );
}

/**
 * Keys sessiyasidan talabaga ko'rsatiladigan yaxlit matn yig'adi.
 *
 * Uchta fokus (tashxis / davolash / profilaktika) alohida vaziyat va yechim
 * bo'lib keladi — talaba oynasida ular bitta o'qiladigan matnga birlashadi.
 */
export function caseToText(session: CaseStudySession): string {
  const FOCUS_LABEL: Record<string, string> = {
    tashxis: 'Tashxis',
    davolash: 'Davolash',
    profilaktika: 'Profilaktika',
  };
  const parts: string[] = [];
  for (const q of session.questions || []) {
    const scenario = String(q.scenario || '').trim();
    const answer = String(q.answer || '').trim();
    if (!scenario && !answer) continue;
    const label = FOCUS_LABEL[String(q.focus || '')] || 'Vaziyat';
    parts.push(`### ${label}`);
    if (scenario) parts.push(scenario);
    if (answer) parts.push(`**Yechim:** ${answer}`);
  }
  return parts.join('\n\n').trim();
}
