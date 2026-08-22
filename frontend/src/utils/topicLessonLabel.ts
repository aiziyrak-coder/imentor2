import type { SyllabusTopicType } from '../services/aiService';
import type { UiTextKey } from '../i18n/translations';

export const SYLLABUS_TOPIC_TYPES: SyllabusTopicType[] = [
  'lecture',
  'practical',
  'clinical',
  'independent',
  'lab',
];

export function topicNumberFromId(id: string): number {
  const match = String(id || '').match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

export function topicTypeLabelKey(type: SyllabusTopicType): UiTextKey {
  if (type === 'practical') return 'lecture.typePractical';
  if (type === 'clinical') return 'lecture.typeClinical';
  if (type === 'independent') return 'lecture.typeIndependent';
  if (type === 'lab') return 'lecture.typeLab';
  return 'lecture.typeLecture';
}

/** "Amaliy mashg'ulot 1-mavzu" — ichki kod (A1) UI da ko'rinmaydi. */
export function formatTopicLessonLabel(
  type: SyllabusTopicType,
  id: string,
  t: (key: UiTextKey, vars?: Record<string, string | number>) => string,
): string {
  const n = topicNumberFromId(id) || 1;
  return t('syllabus.lessonItem', { type: t(topicTypeLabelKey(type)), n });
}

/** Sillabus title dagi "3-mavzu." prefiksini olib tashlaydi — label allaqachon raqamni ko'rsatadi. */
export function stripRedundantTopicNumber(title: string, topicId: string): string {
  const raw = String(title || '').trim();
  if (!raw) return raw;
  const n = topicNumberFromId(topicId);
  if (!n) return raw;

  const patterns = [
    new RegExp(`^${n}\\s*[-–—]?\\s*mavzu\\s*[.:;\\-–—]?\\s*`, 'iu'),
    new RegExp(`^mavzu\\s*${n}\\s*[.:;\\-–—]?\\s*`, 'iu'),
    new RegExp(`^(?:тема\\s*${n}|${n}\\s*[-–—]?\\s*тема)\\s*[.:;\\-–—]?\\s*`, 'iu'),
    new RegExp(`^topic\\s*${n}\\s*[.:;\\-–—]?\\s*`, 'iu'),
  ];

  for (const re of patterns) {
    const next = raw.replace(re, '').trim();
    if (next && next !== raw) return next;
  }
  return raw;
}

/** Dropdown va xabarlar: "Mar'uza 1-mavzu · Ortopedik stomatologiyada…" */
export function formatTopicDisplayLabel(
  type: SyllabusTopicType,
  id: string,
  title: string,
  t: (key: UiTextKey, vars?: Record<string, string | number>) => string,
): string {
  const head = formatTopicLessonLabel(type, id, t);
  const body = stripRedundantTopicNumber(title, id);
  if (!body || body === head) return head;
  return `${head} · ${body}`;
}
