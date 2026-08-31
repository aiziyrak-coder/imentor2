/** Design tokens — LLM bu qatlamga aralashmaydi. */

export const THEME = {
  colors: {
    // Chuqur akademik ko'k — universitet taqdimotining asosiy rangi.
    primary: '10395B',
    secondary: '17607D',
    // Iliq mis — faqat urg'u uchun (raqam, chiziq, belgi).
    accent: 'C87941',
    textDark: '15242E',
    textLight: 'FFFFFF',
    // Sof oq emas, sal iliq fon — ekranda ko'z charchatmaydi.
    bgLight: 'F7F5F1',
    bgDark: '0B1F2A',
    muted: '5D6E78',
    card: 'FFFFFF',
    zebra: 'EDEAE4',
    soft: 'D3DDE3',
  },
  fonts: {
    // Calibri butun taqdimotga "standart Office" ko'rinishini berardi.
    // Georgia — akademik, jiddiy sarlavha; Segoe UI — toza va zich matn.
    // Ikkalasi ham Windows va Office bilan birga keladi.
    heading: 'Georgia',
    body: 'Segoe UI',
  },
  spacing: {
    margin: 0.55,
    gutter: 0.28,
  },
  slide: {
    w: 13.333,
    h: 7.5,
  },
} as const;

export type PresentationBuildMeta = {
  subjectName: string;
  topicId: string;
  variantLabel?: string;
  /** Layout ichidagi qat'iy yozuvlar (jadval sarlavhasi va h.k.) shu tilda. */
  language?: 'uz' | 'ru' | 'en';
};

/** Design Layer'ning o'z yozuvlari — AI matniga aloqasi yo'q. */
const BUILD_LABELS = {
  uz: { criteria: 'Mezon', left: 'A variant', right: 'B variant', caseStudy: 'Klinik holat' },
  ru: { criteria: 'Критерий', left: 'Вариант A', right: 'Вариант B', caseStudy: 'Клинический случай' },
  en: { criteria: 'Criterion', left: 'Option A', right: 'Option B', caseStudy: 'Case study' },
} as const;

export function buildLabels(meta: PresentationBuildMeta) {
  return BUILD_LABELS[meta.language || 'uz'] || BUILD_LABELS.uz;
}
