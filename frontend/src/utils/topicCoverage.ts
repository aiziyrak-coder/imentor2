import type { SyllabusTopic } from '../services/aiService';
import { parseTopicNormParts } from './syllabusTopicContext';

/**
 * "fan::mavzu" kalitlari to'plami — qaysi mavzuga material yuklanganini
 * bir marta indekslab olamiz.
 *
 * Fanlar soni yuzlab, har birida o'nlab mavzu bor. Har bir mavzu uchun butun
 * ro'yxatni qayta izlash sekin bo'lardi, shuning uchun avval yozuvlardan
 * to'plam quriladi va tekshiruv O(1) ga tushadi.
 */
export type TopicCoverage = Set<string>;

/** Saqlashdagi bilan bir xil normallashtirish (topicNormForStorage bilan mos). */
export function normalizeTopicCode(topicId: string): string {
  return (topicId || '').replace(/\s+/g, '').trim().toLowerCase().slice(0, 16);
}

export function buildTopicCoverage(rows: Array<{ topic_norm: string }>): TopicCoverage {
  const set: TopicCoverage = new Set();
  for (const row of rows) {
    const parts = parseTopicNormParts(row.topic_norm);
    if (parts) set.add(`${parts.syllabusId}::${parts.topicCode}`);
  }
  return set;
}

export function topicHasMaterial(
  coverage: TopicCoverage,
  syllabusId: number | string,
  topicId: string,
): boolean {
  const code = normalizeTopicCode(topicId);
  if (!code) return false;
  return coverage.has(`${syllabusId}::${code}`);
}

/** Fan bo'yicha: nechta mavzuga yuklangan va jami nechta mavzu bor. */
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
