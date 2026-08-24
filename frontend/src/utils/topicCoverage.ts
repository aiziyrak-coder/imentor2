import type { SyllabusTopic } from '../services/aiService';
import { parseTopicNormParts } from './syllabusTopicContext';

/**
 * Qaysi mavzuga material yuklanganini bir marta indekslab olamiz.
 *
 * Fanlar soni yuzlab, har birida o'nlab mavzu, fayllar esa minglab. Har bir
 * mavzu uchun butun ro'yxatni qayta izlash sekin bo'lardi, shuning uchun avval
 * to'plam quriladi va tekshiruv O(1) ga tushadi.
 *
 * Kalitlar ikki xil: tilsiz `fan::mavzu` (video uchun) va tilli
 * `fan::mavzu::til` (tarqatma uchun — har bir til alohida ko'rsatiladi).
 */
export type TopicCoverage = Set<string>;

/** Tarqatmalar uchun chiroqcha tartibi. */
export const HANDOUT_LANGS = ['uz', 'ru', 'en'] as const;
export type HandoutLang = (typeof HANDOUT_LANGS)[number];

/** Saqlashdagi bilan bir xil normallashtirish (topicNormForStorage bilan mos). */
export function normalizeTopicCode(topicId: string): string {
  return (topicId || '').replace(/\s+/g, '').trim().toLowerCase().slice(0, 16);
}

export function buildTopicCoverage(
  rows: Array<{ topic_norm: string; language?: string }>,
): TopicCoverage {
  const set: TopicCoverage = new Set();
  for (const row of rows) {
    const parts = parseTopicNormParts(row.topic_norm);
    if (!parts) continue;
    const base = `${parts.syllabusId}::${parts.topicCode}`;
    set.add(base);
    const lang = (row.language || '').trim().toLowerCase();
    if (lang) set.add(`${base}::${lang}`);
  }
  return set;
}

/** Tilga qaramasdan: shu mavzuda umuman material bormi. */
export function topicHasMaterial(
  coverage: TopicCoverage,
  syllabusId: number | string,
  topicId: string,
): boolean {
  const code = normalizeTopicCode(topicId);
  if (!code) return false;
  return coverage.has(`${syllabusId}::${code}`);
}

/** Bitta til bo'yicha: shu mavzuda shu tilda material bormi. */
export function topicHasLang(
  coverage: TopicCoverage,
  syllabusId: number | string,
  topicId: string,
  lang: string,
): boolean {
  const code = normalizeTopicCode(topicId);
  if (!code) return false;
  return coverage.has(`${syllabusId}::${code}::${lang}`);
}

/** Mavzu uchun uchta chiroqcha — UZ / RU / EN tartibida. */
export function topicLangDots(
  coverage: TopicCoverage,
  syllabusId: number | string,
  topicId: string,
): Array<'green' | 'red'> {
  return HANDOUT_LANGS.map((l) =>
    topicHasLang(coverage, syllabusId, topicId, l) ? 'green' : 'red',
  );
}

/**
 * Fan uchun uchta chiroqcha: til yashil bo'lishi uchun fanning HAMMA
 * mavzusida o'sha tilda material bo'lishi kerak — bitta mavzu yetishmasa
 * ham kamchilik ko'rinib tursin.
 */
export function subjectLangDots(
  coverage: TopicCoverage,
  syllabusId: number | string,
  topics: SyllabusTopic[],
): Array<'green' | 'red'> | undefined {
  if (topics.length === 0) return undefined;
  return HANDOUT_LANGS.map((l) =>
    topics.every((tp) => topicHasLang(coverage, syllabusId, tp.id, l)) ? 'green' : 'red',
  );
}

/** Fan bo'yicha (tilsiz): nechta mavzuga yuklangan va jami nechta mavzu bor. */
export function subjectCoverage(
  coverage: TopicCoverage,
  syllabusId: number | string,
  topics: SyllabusTopic[],
): { done: number; total: number; complete: boolean } {
  let done = 0;
  for (const tp of topics) {
    if (topicHasMaterial(coverage, syllabusId, tp.id)) done += 1;
  }
  const total = topics.length;
  return { done, total, complete: total > 0 && done === total };
}
