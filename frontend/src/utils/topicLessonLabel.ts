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
