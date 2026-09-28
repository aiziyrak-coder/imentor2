import type { ContentSlide } from './presentationContentSchema';
import type { AppLanguage } from '../i18n/language';
import { outputLanguageLooksWrong } from './outputLanguage';
function textValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(textValues);
  return [];
}
/** JSON keys and English image queries are not visible teaching text. */
export function slideLanguageWrong(slide: ContentSlide, language: AppLanguage): boolean {
  return outputLanguageLooksWrong([slide.title, slide.subtitle || '', ...textValues(slide.body), slide.speaker_notes || ''].join(' '), language);
}
