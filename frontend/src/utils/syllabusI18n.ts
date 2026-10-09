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
  // Tarjima bor bo'lsa — doim u. `instruction_language` ba'zan xato (PDF'dan
  // aniqlangan) va server shunday fanni ham o'girib qo'yadi.
  const translated = (syllabus.name_i18n?.[lang] || '').trim();
  if (translated) return translated;
  return syllabus.subject_name;
}

/** Mavzu sarlavhasi — tanlangan tilda (tarjima yo'q bo'lsa asl sarlavha). */
export function localizedTopicTitle(
  syllabus: Pick<CourseSyllabusRow, 'topics_i18n' | 'instruction_language'> | null | undefined,
  originalTitle: string,
  lang: AppLanguage,
): string {
  if (!syllabus) return originalTitle;
  return (syllabus.topics_i18n?.[lang]?.[originalTitle] || '').trim() || originalTitle;
}

/** Mavzu nomining shu tildagi tarjimasi yetishmayaptimi (asl tilda emas va tarjima yo'q). */
export function topicTitleMissing(
  syllabus: Pick<CourseSyllabusRow, 'topics_i18n' | 'instruction_language'> | null | undefined,
  originalTitle: string,
  lang: AppLanguage,
): boolean {
  if (!syllabus || !originalTitle) return false;
  if ((syllabus.instruction_language || 'uz') === lang) return false;
  return !(syllabus.topics_i18n?.[lang]?.[originalTitle] || '').trim();
}

/** Fan nomining tarjimasi yetishmayaptimi. */
export function subjectNameMissing(
  syllabus: Pick<CourseSyllabusRow, 'name_i18n' | 'instruction_language'> | null | undefined,
  lang: AppLanguage,
): boolean {
  if (!syllabus) return false;
  if ((syllabus.instruction_language || 'uz') === lang) return false;
  return !(syllabus.name_i18n?.[lang] || '').trim();
}

/** Shu til uchun tarjima to'liqmi? (barcha mavzular) */
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
  // Bitta mavzu ham tarjimasiz qolmasin — ilgari 80% yetarli hisoblanardi va
  // qolgan 20% mavzu nomi asl tilda ko'rinib turardi.
  return have === titles.size;
}

/** Bir sessiyada bir sillabus+til uchun bir marta so'ralsin. */
const requested = new Set<string>();

/**
 * Tarjima holati — ekran "Tarjima qilinmoqda…" yoki "qayta urinish"ni
 * ko'rsatishi uchun. `pending` — server ishlayapti; `failed` — yiqildi.
 */
export type SyllabusTranslationState = 'pending' | 'failed';
const states = new Map<string, SyllabusTranslationState>();
const stateListeners = new Set<() => void>();

function setState(key: string, state: SyllabusTranslationState | null): void {
  if (state) states.set(key, state);
  else states.delete(key);
  stateListeners.forEach((fn) => fn());
}

export function syllabusTranslationState(
  syllabusId: number | null | undefined,
  lang: AppLanguage,
): SyllabusTranslationState | null {
  if (syllabusId == null) return null;
  return states.get(`${syllabusId}:${lang}`) ?? null;
}

export function subscribeSyllabusTranslationState(fn: () => void): () => void {
  stateListeners.add(fn);
  return () => {
    stateListeners.delete(fn);
  };
}

/** "Qayta urinish" — yiqilgan tarjimani yana so'raydi. */
export function retrySyllabusTranslation(syllabusId: number, lang: AppLanguage): Promise<boolean> {
  const key = `${syllabusId}:${lang}`;
  requested.delete(key);
  return requestSyllabusTranslation(syllabusId, lang);
}

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
  setState(key, 'pending');
  try {
    const token = await getBackendAccessToken();
    if (!token) { requested.delete(key); setState(key, null); return false; }
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
    setState(key, null);
    return true;
  } catch {
    // Tarjima yiqildi — ekranda "qayta urinish" chiqadi.
    requested.delete(key);
    setState(key, 'failed');
    return false;
  }
}
