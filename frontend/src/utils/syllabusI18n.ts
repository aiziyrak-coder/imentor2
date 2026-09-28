import { cacheSyllabusRows, getCachedSyllabusRow } from './syllabusRowCache';
import type { AppLanguage } from '../i18n/language';
import type { CourseSyllabusRow } from './syllabusApi';
import { httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';

/**
 * Fan va mavzu nomlarini interfeys tiliga moslash.
 *
 * MUHIM: asl nom hech qachon o'zgarmaydi — u saqlash kaliti (`topic_norm`)
 * va AI promptlari uchun ishlatiladi. Bu yerdagi funksiyalar FAQAT ekranda
 * ko'rsatiladigan matnni almashtiradi.
 */

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

/** Fan nomi — tanlangan tilda (tarjima yo'q bo'lsa asl nom). */
export function localizedSubjectName(
  syllabus: Pick<CourseSyllabusRow, 'subject_name' | 'name_i18n' | 'instruction_language'>,
  lang: AppLanguage,
): string {
  if ((syllabus.instruction_language || 'uz') === lang) return syllabus.subject_name;
  return (syllabus.name_i18n?.[lang] || '').trim() || syllabus.subject_name;
}

/** Mavzu sarlavhasi — tanlangan tilda (tarjima yo'q bo'lsa asl sarlavha). */
export function localizedTopicTitle(
  syllabus: Pick<CourseSyllabusRow, 'topics_i18n' | 'instruction_language'> | null | undefined,
  originalTitle: string,
  lang: AppLanguage,
): string {
  if (!syllabus) return originalTitle;
  if ((syllabus.instruction_language || 'uz') === lang) return originalTitle;
  return (syllabus.topics_i18n?.[lang]?.[originalTitle] || '').trim() || originalTitle;
}

/** Shu til uchun tarjima yetarlimi? (mavzularning kamida 80%i) */
export function hasTranslations(
  syllabus: Pick<CourseSyllabusRow, 'topics_i18n' | 'instruction_language' | 'variants' | 'topics'>,
  lang: AppLanguage,
): boolean {
  if ((syllabus.instruction_language || 'uz') === lang) return true;
  const map = syllabus.topics_i18n?.[lang];
  if (!map) return false;
  const titles = new Set<string>();
  for (const v of syllabus.variants || []) {
    for (const t of v?.topics || []) {
      if (t?.title) titles.add(t.title);
    }
  }
  for (const t of syllabus.topics || []) {
    if (t?.title) titles.add(t.title);
  }
  if (!titles.size) return true;
  let have = 0;
  titles.forEach((t) => {
    if ((map[t] || '').trim()) have += 1;
  });
  return have / titles.size >= 0.8;
}

/** Bir sessiyada bir sillabus+til uchun bir marta so'ralsin. */
const requested = new Set<string>();

/**
 * Yetishmayotgan tarjimani serverda yaratishni so'raydi.
 *
 * Til almashganda chaqiriladi. Server tomonida idempotent, shuning uchun
 * bir necha foydalanuvchi bir vaqtda chaqirsa ham xavfsiz. Natija darhol
 * kerak emas — keyingi yuklashda tayyor bo'ladi.
 */
export async function requestSyllabusTranslation(
  syllabusId: number,
  lang: AppLanguage,
): Promise<boolean> {
  const key = `${syllabusId}:${lang}`;
  if (requested.has(key)) return false;
  requested.add(key);
  try {
    const token = await getBackendAccessToken();
    if (!token) { requested.delete(key); return false; }
    const result = await httpJson<Pick<CourseSyllabusRow, "name_i18n" | "topics_i18n">>(
      `${apiBaseUrl()}/v1/course-syllabuses/${syllabusId}/translate/?lang=${encodeURIComponent(lang)}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        // Tarjima bir necha o'nlab soniya olishi mumkin (169 mavzu ~1 daqiqa).
        timeoutMs: 180_000,
      },
    );
    const row = getCachedSyllabusRow(syllabusId);
    if (row) cacheSyllabusRows([{ ...row, name_i18n: result.name_i18n, topics_i18n: result.topics_i18n }]);
    return true;
  } catch {
    // Tarjima bo'lmasa ham ilova ishlayveradi — asl nom ko'rsatiladi.
    requested.delete(key);
    return false;
  }
}
