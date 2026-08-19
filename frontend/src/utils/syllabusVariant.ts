import type { SyllabusTopic } from '../services/aiService';

export type SyllabusVariant = {
  label: string;
  file_name: string;
  topics: SyllabusTopic[];
};

/** `Falsafa (PI).pdf` → `PI`; `Anatomiya_PI.docx` → `PI`; yo'q bo'lsa qisqa nom */
export function parseVariantLabel(fileName: string): string {
  const base = fileName.replace(/\.(pdf|docx?|xlsx)$/i, '').trim();
  const paren = base.match(/\(([^)]+)\)\s*$/);
  if (paren?.[1]?.trim()) return paren[1].trim().slice(0, 32);

  const suffix = base.match(/[-–_\s]+([A-Za-zА-Яа-яЁё]{2,12})\s*$/u);
  if (suffix?.[1] && /^[A-ZА-ЯЁ]{2,8}$/iu.test(suffix[1].trim())) {
    return suffix[1].trim().toUpperCase().slice(0, 32);
  }

  if (base.length > 48) return 'Asosiy';
  return base.slice(0, 32) || 'Asosiy';
}

export function resolveSyllabusVariants(row: {
  variants?: SyllabusVariant[];
  file_name?: string;
  topics?: SyllabusTopic[];
}): SyllabusVariant[] {
  if (row.variants?.length) return row.variants;
  if (row.topics?.length) {
    return [
      {
        label: parseVariantLabel(row.file_name || 'syllabus.pdf'),
        file_name: row.file_name || 'syllabus.pdf',
        topics: row.topics,
      },
    ];
  }
  return [];
}

export function totalTopicCount(variants: SyllabusVariant[]): number {
  return variants.reduce((n, v) => n + (v.topics?.length ?? 0), 0);
}

export function countTopicsByType(topics: SyllabusTopic[]): {
  lectures: number;
  practicals: number;
  clinicals: number;
  independents: number;
  labs: number;
} {
  return {
    lectures: topics.filter((t) => t.type === 'lecture').length,
    practicals: topics.filter((t) => t.type === 'practical').length,
    clinicals: topics.filter((t) => t.type === 'clinical').length,
    independents: topics.filter((t) => t.type === 'independent').length,
    labs: topics.filter((t) => t.type === 'lab').length,
  };
}
