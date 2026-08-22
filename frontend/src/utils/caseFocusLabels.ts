import type { AppLanguage } from '../i18n/language';
import { CASE_STUDY_FOCUS_ORDER, type CaseStudyFocus } from './generationVariety';
import type { SubjectDomain } from './subjectDomain';

const LABELS: Record<AppLanguage, Record<CaseStudyFocus, string>> = {
  uz: {
    profilaktika: 'Profilaktika',
    davolash: 'Davolash',
    tashxis: 'Tashxis',
  },
  ru: {
    profilaktika: 'Профилактика',
    davolash: 'Лечение',
    tashxis: 'Диагностика',
  },
  en: {
    profilaktika: 'Prevention',
    davolash: 'Treatment',
    tashxis: 'Diagnosis',
  },
};

const LABELS_ACADEMIC: Record<AppLanguage, Record<CaseStudyFocus, string>> = {
  uz: {
    tashxis: 'Sababni topish',
    davolash: 'Yechim tanlash',
    profilaktika: 'Xatolikning oldini olish',
  },
  ru: {
    tashxis: 'Найти причину',
    davolash: 'Выбрать решение',
    profilaktika: 'Не допустить ошибку',
  },
  en: {
    tashxis: 'Find the cause',
    davolash: 'Choose a solution',
    profilaktika: 'Prevent the mistake',
  },
};

const BADGE_CLASS: Record<CaseStudyFocus, string> = {
  profilaktika: 'bg-teal-500/10 text-teal-800 border-teal-500/25',
  davolash: 'bg-blue-500/10 text-blue-800 border-blue-500/25',
  tashxis: 'bg-violet-500/10 text-violet-800 border-violet-500/25',
};

const ACCENT_BORDER_CLASS: Record<CaseStudyFocus, string> = {
  profilaktika: 'border-l-teal-500/60',
  davolash: 'border-l-blue-500/60',
  tashxis: 'border-l-violet-500/60',
};

const ICON_BG_CLASS: Record<CaseStudyFocus, string> = {
  profilaktika: 'bg-teal-500/12 text-teal-700',
  davolash: 'bg-blue-500/12 text-blue-700',
  tashxis: 'bg-violet-500/12 text-violet-700',
};

export function caseFocusAccentBorderClass(focus: CaseStudyFocus | undefined): string {
  if (!focus) return 'border-l-black/15';
  return ACCENT_BORDER_CLASS[focus];
}

export function caseFocusIconBgClass(focus: CaseStudyFocus | undefined): string {
  if (!focus) return 'bg-black/5 text-black/50';
  return ICON_BG_CLASS[focus];
}

export function caseFocusLabel(
  focus: CaseStudyFocus | undefined,
  lang: AppLanguage = 'uz',
  domain: SubjectDomain = 'clinical',
): string {
  if (!focus) return '';
  const table = domain === 'academic' ? LABELS_ACADEMIC : LABELS;
  return table[lang][focus] || table.uz[focus];
}

export function caseFocusBadgeClass(focus: CaseStudyFocus | undefined): string {
  if (!focus) return 'bg-black/5 text-black/60 border-black/10';
  return BADGE_CLASS[focus];
}

/**
 * Ekranda ko'rsatish tartibi: tashxis → davolash → profilaktika.
 *
 * Saralash generatsiya paytida emas, KO'RSATISHDA bajariladi — shunda eski,
 * boshqa tartibda saqlangan keyslar ham to'g'ri ketma-ketlikda chiqadi.
 * Fokusi noma'lum savollar o'z o'rnida, ro'yxat oxirida qoladi.
 */
export function sortCaseQuestionsByFocus<T extends { focus?: CaseStudyFocus }>(items: T[]): T[] {
  const rank = (focus: CaseStudyFocus | undefined): number => {
    if (!focus) return CASE_STUDY_FOCUS_ORDER.length;
    const i = CASE_STUDY_FOCUS_ORDER.indexOf(focus);
    return i === -1 ? CASE_STUDY_FOCUS_ORDER.length : i;
  };
  // `map`+`sort` — barqaror saralash: bir xil fokusdagilar asl tartibda qoladi.
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item.focus) - rank(b.item.focus) || a.index - b.index)
    .map((x) => x.item);
}

export function normalizeCaseFocus(raw: unknown, index: number): CaseStudyFocus {
  const s = String(raw || '').toLowerCase();
  if (s.includes('profil') || s.includes('prevent') || s.includes('profyl')) return 'profilaktika';
  if (s.includes('davol') || s.includes('lichen') || s.includes('treat') || s.includes('lech')) return 'davolash';
  if (s.includes('tashxis') || s.includes('diagno')) return 'tashxis';
  return CASE_STUDY_FOCUS_ORDER[index] ?? 'tashxis';
}
