import { type AppLanguage, inferPdfLanguage, setAppLanguage } from '../i18n/language';
import type { CourseSyllabusRow } from './syllabusApi';
import { resolveSyllabusVariants } from './syllabusVariant';

export function resolveSyllabusInstructionLanguage(row: CourseSyllabusRow): AppLanguage {
  const stored = (row.instruction_language || '').trim().toLowerCase();
  if (stored === 'uz' || stored === 'en' || stored === 'ru') return stored;

  const parts: string[] = [row.subject_name];
  for (const variant of resolveSyllabusVariants(row)) {
    for (const topic of variant.topics) parts.push(topic.title);
  }
  return inferPdfLanguage(parts.join('\n'));
}

export function applyInstructionLanguage(
  lang: AppLanguage,
  setLanguage: (lang: AppLanguage) => void,
): void {
  setAppLanguage(lang);
  setLanguage(lang);
}

/** The explicitly selected language applies to every new material, not only the home page. */
export function contentLanguageFor(
  _topic: { instructionLanguage?: AppLanguage; title?: string } | null | undefined,
  uiLanguage: AppLanguage,
): AppLanguage {
  return uiLanguage;
}

/** Xalqaro (xorijiy talabalar) guruhi fani: `XT` yo'nalishi yoki nomida "(Xorijiy…)"/"(Xalqaro…)". */
export function isInternationalSyllabus(
  row: Pick<CourseSyllabusRow, 'direction_code' | 'subject_name'>,
): boolean {
  if ((row.direction_code || '').trim().toUpperCase() === 'XT') return true;
  return /\((xorijiy|xalqaro|international)[^)]*\)/i.test(row.subject_name || '');
}

export function instructionLanguageBadge(lang: AppLanguage): string {
  if (lang === 'en') return 'EN';
  if (lang === 'ru') return 'RU';
  return 'UZ';
}
