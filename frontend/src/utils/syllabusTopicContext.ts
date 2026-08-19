import type { SyllabusTopic } from '../services/aiService';
import type { AppLanguage } from '../i18n/language';

/** Fan + mavzu konteksti — barcha modullar uchun barqaror kalit (variant ichki, UI da yo'q) */
export interface SyllabusTopicContext extends SyllabusTopic {
  syllabusId: number;
  subjectName: string;
  subjectCode: string;
  /** Ichki storage segmenti (PDF label); UI da ko'rsatilmaydi */
  variantLabel: string;
  /** Fan o'qitilish tili — platforma va AI shu tilga o'tadi */
  instructionLanguage: AppLanguage;
  /** Akademik katalog kafedra nomi — klinik/no-klinik domen uchun */
  departmentName?: string;
}

const SELECTED_TOPIC_KEY = 'imentor-selected-topic-v2';
const VARIANT_BY_SUBJECT_KEY = 'imentor-syllabus-variant-v1';

export function buildTopicContext(
  topic: SyllabusTopic,
  syllabusId: number,
  subjectName: string,
  subjectCode: string,
  variantLabel: string,
  instructionLanguage: AppLanguage,
  departmentName = '',
): SyllabusTopicContext {
  return {
    ...topic,
    syllabusId,
    subjectName,
    subjectCode,
    variantLabel,
    instructionLanguage,
    departmentName,
  };
}

function normTopicSegment(value: string, max: number): string {
  return value.trim().toLowerCase().slice(0, max);
}

/** Handout/presentation/lecture uchun qisqa barqaror kalit — faqat M1/A2 kodi (sarlavha emas) */
export function topicNormForStorage(
  ctx: Pick<SyllabusTopicContext, 'syllabusId' | 'variantLabel' | 'id'>,
): string {
  const variant = normTopicSegment(ctx.variantLabel, 48) || 'asosiy';
  const topicCode = normTopicSegment(ctx.id.replace(/\s+/g, ''), 16);
  if (!topicCode) {
    throw new Error('Mavzu kodi (M1, L2, …) topilmadi.');
  }
  return `${ctx.syllabusId}::${variant}::${topicCode}`;
}

const STRUCTURED_NORM_RE = /^\d+::[^:]*::[a-zа-яё]{1,4}\d{1,3}$/i;

export function isStructuredTopicNorm(value: string): boolean {
  return STRUCTURED_NORM_RE.test((value || '').trim());
}

/** Eski yozuvlar — to'liq mavzu sarlavhasi bilan */
export function topicNormLegacyTitleKey(
  ctx: Pick<SyllabusTopicContext, 'syllabusId' | 'variantLabel' | 'title'>,
): string {
  const variant = normTopicSegment(ctx.variantLabel, 48);
  const title = normTopicSegment(ctx.title, 160);
  return `${ctx.syllabusId}::${variant}::${title}`;
}

/** Faqat tuzilmali kalitlar. Sarlavha bo'yicha qidiruv fanlarni aralashtiradi. */
export function topicNormLookupKeys(topic: SyllabusTopic | SyllabusTopicContext | string): string[] {
  if (typeof topic === 'string') {
    const k = topic.trim().toLowerCase();
    return isStructuredTopicNorm(k) ? [k] : [];
  }
  if (!isTopicContextComplete(topic)) return [];
  const keys = new Set<string>();
  try {
    keys.add(topicNormForStorage(topic));
  } catch {
    return [];
  }
  const variant = normTopicSegment(topic.variantLabel, 48);
  const code = normTopicSegment(topic.id.replace(/\s+/g, ''), 16);
  if (code && (!variant || variant === 'asosiy')) {
    keys.add(`${topic.syllabusId}::::${code}`);
  }
  return [...keys];
}

export function handoutMatchesTopic(
  row: { topic_norm: string },
  topic: SyllabusTopic | SyllabusTopicContext | string,
): boolean {
  const allowed = new Set(topicNormLookupKeys(topic).map((k) => k.toLowerCase()));
  return allowed.has((row.topic_norm || '').trim().toLowerCase());
}

/** Eski mavzular bilan moslik — kontekstsiz title */
export function topicNormLegacy(title: string): string {
  return title.trim().toLowerCase();
}

export function resolveTopicNorm(topic: SyllabusTopic | SyllabusTopicContext | null): string {
  if (!topic?.title) return '';
  if (isTopicContextComplete(topic)) {
    return topicNormForStorage(topic);
  }
  return topicNormLegacy(topic.title);
}

export function isTopicContextComplete(
  topic: SyllabusTopic | SyllabusTopicContext | null,
): topic is SyllabusTopicContext {
  return Boolean(
    topic &&
      topic.id?.trim() &&
      'syllabusId' in topic &&
      topic.syllabusId != null &&
      topic.subjectName,
  );
}

/** useEffect dependency — obyekt o'rniga barqaror kalit */
export function topicContextKey(
  topic: SyllabusTopic | SyllabusTopicContext | null | undefined,
): string {
  if (!topic || !isTopicContextComplete(topic)) {
    return topic?.title?.trim() || '';
  }
  return `${topic.syllabusId}::${topic.variantLabel}::${topic.id}::${topic.type}`;
}

export function topicsMatch(
  a: SyllabusTopic | SyllabusTopicContext | null,
  b: SyllabusTopic | SyllabusTopicContext | null,
): boolean {
  if (!a || !b) return false;
  if (isTopicContextComplete(a) && isTopicContextComplete(b)) {
    return (
      a.syllabusId === b.syllabusId &&
      a.variantLabel === b.variantLabel &&
      a.id === b.id &&
      a.type === b.type
    );
  }
  return a.id === b.id && a.title === b.title && a.type === b.type;
}

export function persistSelectedTopic(topic: SyllabusTopicContext | null): void {
  try {
    if (!topic) {
      localStorage.removeItem(SELECTED_TOPIC_KEY);
      return;
    }
    localStorage.setItem(SELECTED_TOPIC_KEY, JSON.stringify(topic));
  } catch {
    /* quota */
  }
}

export function loadPersistedSelectedTopic(): SyllabusTopicContext | null {
  try {
    const raw = localStorage.getItem(SELECTED_TOPIC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SyllabusTopicContext;
    if (!parsed?.id || !parsed?.title || parsed.syllabusId == null) return null;
    if (!parsed.variantLabel) parsed.variantLabel = '';
    if (!parsed.instructionLanguage) {
      parsed.instructionLanguage = 'uz';
    }
    if (!parsed.subjectCode) {
      parsed.subjectCode = '';
    }
    return parsed;
  } catch {
    return null;
  }
}

export function persistVariantBySubject(map: Record<number, string>): void {
  try {
    localStorage.setItem(VARIANT_BY_SUBJECT_KEY, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

export function loadPersistedVariantBySubject(): Record<number, string> {
  try {
    const raw = localStorage.getItem(VARIANT_BY_SUBJECT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: Record<number, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const id = Number(k);
      if (!Number.isNaN(id) && v) out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}
