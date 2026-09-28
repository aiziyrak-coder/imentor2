export type AppLanguage = 'uz' | 'ru' | 'en';

export const APP_LANGUAGE_STORAGE_KEY = 'imentor-ui-language-v1';

export function getAppLanguage(): AppLanguage {
  try {
    const raw = (localStorage.getItem(APP_LANGUAGE_STORAGE_KEY) || '').trim().toLowerCase();
    if (raw === 'uz' || raw === 'ru' || raw === 'en') return raw;
  } catch {
    // ignore
  }
  return 'uz';
}

export function setAppLanguage(lang: AppLanguage): void {
  try {
    localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // ignore
  }
}

export function localeForLanguage(lang: AppLanguage): string {
  if (lang === 'ru') return 'ru-RU';
  if (lang === 'en') return 'en-US';
  return 'uz-UZ';
}

export function inferPdfLanguage(text: string): AppLanguage {
  const sample = text.slice(0, 8000).toLowerCase();

  const cyr = (sample.match(/[\u0430-\u044f\u0451]/g) || []).length;
  const lat = (sample.match(/[a-z]/g) || []).length;
  // Faqat o'zbek kirilida bor harflar — rus alifbosida yo'q.
  const uzOnlyCyr = (sample.match(/[\u049b\u0493\u04b3\u045e\u04d9\u04e3]/g) || []).length;

  const ruHints = [
    '\u043b\u0435\u043a\u0446\u0438\u044f',
    '\u043f\u0440\u0430\u043a\u0442\u0438\u043a\u0430',
    '\u0442\u0435\u043c\u0430',
    '\u0441\u043e\u0434\u0435\u0440\u0436\u0430\u043d\u0438\u0435',
    '\u0434\u0438\u0441\u0446\u0438\u043f\u043b\u0438\u043d\u0430',
  ];
  const enHints = [
    'lecture',
    'practical',
    'topic',
    'syllabus',
    'course',
    'module',
    'semester',
    'anatomy',
    'physiology',
    'pathology',
    'pharmacology',
    'clinical',
    'discipline',
    'curriculum',
    'objectives',
    'assessment',
    'hours',
    'content',
  ];
  const uzLatinHints = ["ma'ruza", 'amaliy', 'mavzu', 'sillabus', "o'quv", "sog'liq"];
  const uzCyrHints = [
    '\u043c\u0430\u0440\u0443\u0437\u0430', // маруза
    '\u0430\u043c\u0430\u043b\u0438\u0439', // амалий
    '\u043c\u0430\u0432\u0437\u0443', // мавзу
    '\u043a\u0430\u0441\u0430\u043b\u043b\u0438\u043a', // касаллик
    '\u0434\u0430\u0432\u043e\u043b\u0430\u0448', // даволаш
  ];

  const uzScore =
    uzLatinHints.reduce((acc, w) => acc + (sample.includes(w) ? 2 : 0), 0) +
    uzCyrHints.reduce((acc, w) => acc + (sample.includes(w) ? 2 : 0), 0) +
    (uzOnlyCyr > 0 ? 4 : 0);

  const ruScore = ruHints.reduce((acc, w) => acc + (sample.includes(w) ? 2 : 0), 0) + (cyr > lat ? 2 : 0);
  const enScore =
    enHints.reduce((acc, w) => acc + (sample.includes(w) ? 2 : 0), 0) + (lat > cyr + 40 ? 3 : lat > cyr ? 1 : 0);

  // O'zbek (lotin yoki kirill) — rus/inglizdan oldin.
  if (uzScore >= 2 && uzScore >= ruScore) return 'uz';

  // Lotin yozuvidagi o'zbekcha MAVZU NOMLARI (2026-09-26). Yuqoridagi
  // "ma'ruza/amaliy/mavzu" so'zlari hujjat sarlavhasida bo'ladi, mavzu
  // nomlarida emas — "Odam anatomiyasi. Suyaklar tuzilishi" hech qaysi
  // belgiga tushmay, lotin harf ko'pligi uchun INGLIZ deb aniqlanardi va AI
  // o'zbek guruhiga inglizcha material yozardi (20 ta fan shunday edi).
  if (lat > cyr) {
    const uzMarks = latinUzbekMarks(sample);
    const enMarks = (sample.match(/\b(the|of|and|with|in|to|for|by|its|their|from)\b|tion\b|ness\b|ies\b/g) || []).length;
    if (uzMarks >= 3 && uzMarks > enMarks) return 'uz';
  }
  if (ruScore >= enScore + 2) return 'ru';
  if (enScore >= ruScore + 2) return 'en';
  if (uzScore >= 2) return 'uz';

  return cyr > lat ? 'ru' : 'en';
}

/**
 * Lotin o'zbekchaning ishonchli belgilari: o'/g' (har qanday tutuq belgisi
 * bilan), "q" ning "u"siz kelishi (inglizda deyarli yo'q), bog'lovchilar va
 * o'zbekcha qo'shimchalar. "-lar" ataylab yo'q: inglizcha "vascular",
 * "cellular" ham shu bilan tugaydi.
 */
function latinUzbekMarks(sample: string): number {
  const apostrophePairs = (sample.match(/[og][ʻʼ‘’'`]/g) || []).length;
  const bareQ = (sample.match(/q(?!u)/g) || []).length;
  const words = (sample.match(/\b(va|bilan|uchun|hamda|yoki|ham|turlari|usullari)\b/g) || []).length;
  const suffixes = (sample.match(/[a-z](larning|lari|ning|dagi|ligi|lik|lash|ishi|iyasi|inchi)\b/g) || []).length;
  // Kelishik qo'shimchalari: "faniga", "gigiyenasi", "kasallikni". Kamida ikki
  // harfli o'zakdan keyin — inglizcha qisqa so'zlar ("yoga") sanalmasin.
  const cases = (sample.match(/[a-z]{3,}(iga|ga|si|ni|dan)\b/g) || []).length;
  return apostrophePairs + bareQ + words + suffixes + cases;
}

export function languageLabel(lang: AppLanguage): string {
  if (lang === 'ru') return '\u0420\u0443\u0441\u0441\u043a\u0438\u0439';
  if (lang === 'en') return 'English';
  return 'O\'zbek';
}

/** Full language name for AI translation prompts. */
export function aiLanguageName(lang: AppLanguage): string {
  if (lang === 'ru') return 'Russian';
  if (lang === 'en') return 'English';
  return 'Uzbek';
}
