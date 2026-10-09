/**
 * AI javobining TILINI tekshirish.
 *
 * Eng ko'p uchraydigan xato: rus tili so'ralganda model o'zbekcha matnni
 * tarjima qilmasdan kirilga TRANSLITERATSIYA qiladi ("Беморнинг исми Лайло,
 * 28 ёшда…"). Bunday matn kirilcha bo'lgani uchun oddiy "kirilmi?" tekshiruvidan
 * o'tib ketardi va foydalanuvchiga rus tili sifatida ko'rsatilardi.
 */
import type { AppLanguage } from '../i18n/language';

/** Lotin yozuvidagi o'zbek matni markerlari. */
const UZ_LATIN_MARKERS = [
  'bemor',
  'yoshli',
  'qaysi',
  'ushbu',
  'hisoblanadi',
  'murojaat',
  'aniqlanadi',
  'tavsiya',
  "bo'lib",
  'shifokorga',
  'davosida',
  'maqbul',
];

/** Kiril yozuvidagi o'zbek matni markerlari (rus tilida uchramaydi). */
const UZ_CYRILLIC_MARKERS = [
  'ёшли',
  'бўлиб',
  'бўлган',
  'қайси',
  'ушбу',
  'билан',
  'ҳисобланади',
  'терисида',
  'касаллиги',
  'аниқланади',
  'кузатилади',
  'мустаҳкам',
  'келди',
];

/** Faqat o'zbek kirilida bor harflar — rus alifbosida yo'q: қ ғ ҳ ў */
const UZ_ONLY_CYRILLIC_LETTERS = /[қҚғҒҳҲўЎ]/;

export function looksLikeUzbekText(text: string): boolean {
  const s = (text || '').toLowerCase();
  if (UZ_LATIN_MARKERS.reduce((n, m) => n + (s.includes(m) ? 1 : 0), 0) >= 2) return true;
  if (UZ_ONLY_CYRILLIC_LETTERS.test(s)) return true;
  return UZ_CYRILLIC_MARKERS.reduce((n, m) => n + (s.includes(m) ? 1 : 0), 0) >= 2;
}

export function cyrillicCharCount(text: string): number {
  let n = 0;
  for (const ch of text || '') {
    const code = ch.charCodeAt(0);
    if (code >= 0x0400 && code <= 0x04ff) n += 1;
  }
  return n;
}

/** Matn so'ralgan tilda EMASLIGINI aniqlaydi (qisqa matnlarda tekshirmaydi). */
export function outputLanguageLooksWrong(text: string, targetLang: AppLanguage): boolean {
  const s = (text || '').trim();
  if (s.length < 40) return false;
  const cyrRatio = cyrillicCharCount(s) / s.length;
  if (targetLang === 'ru') {
    if (looksLikeUzbekText(s)) return true;
    return cyrRatio < 0.25; // rus matni asosan kirilcha bo'lishi kerak
  }
  if (targetLang === 'uz') return cyrRatio > 0.2; // o'zbekcha lotinda yoziladi
  return looksLikeUzbekText(s) || cyrRatio > 0.05; // en
}

function languageName(lang: AppLanguage): string {
  if (lang === 'ru') return 'Russian';
  if (lang === 'en') return 'English';
  return 'Uzbek';
}

/**
 * Modelga chiqish tilini qat'iy belgilaydigan, promptga qo'shiladigan ko'rsatma.
 *
 * ATAYLAB INGLIZCHA: ko'rsatmaning o'zi o'zbekcha bo'lsa, model javobni ham
 * o'zbekchaga tortadi. Shu sababli bu yerda o'zbekcha misol ham keltirilmaydi.
 */
export function strictLanguageDirective(targetLang: AppLanguage): string {
  const name = languageName(targetLang);
  const base =
    `LANGUAGE REQUIREMENT: write the ENTIRE output in ${name}. ` +
    'Do not leave any sentence in another language, and never transliterate words ' +
    'from one language into another alphabet. ';
  if (targetLang === 'ru') {
    return (
      base +
      'The output must be genuine Russian medical prose as a Russian physician would write it. ' +
      'Writing Uzbek words in Cyrillic letters is NOT Russian and is forbidden; ' +
      'the letters қ, ғ, ҳ, ў must never appear.'
    );
  }
  if (targetLang === 'uz') {
    return base + 'Use the Latin Uzbek alphabet; do not use Cyrillic letters.';
  }
  return base;
}

const EN_WORDS = /\b(the|is|are|not|no|could|cannot|must|should|file|found|required|invalid|failed|please|too|already|only|this|your|access|denied|error|try|again|session|key|topic|subject|lang)\b/gi;
const UZ_WORDS = /\b(va|yoki|uchun|bilan|emas|yo['‘’ʻ]q|topilmadi|kerak|mumkin|fayl\w*|ruxsat\w*|mavzu\w*|fan\w*|qayta|urinib|bo['‘’ʻ]l\w*|qil\w*|tanlang|kiring|xato\w*|hajmi|juda|katta|saqlan\w*|o['‘’ʻ]chir\w*|tizim\w*)\b/gi;

/**
 * Server xabari (`detail`) interfeys tilidami — QISQA matnlar uchun ham.
 *
 * Server xabarlari asosan o'zbekcha, ba'zilari inglizcha. Interfeys rus yoki
 * ingliz tilida bo'lsa, boshqa tildagi xabar ko'rsatilmaydi — o'rniga
 * chaqiruvchining tarjima qilingan umumiy matni chiqadi.
 */
export function textFitsLanguage(text: string, lang: AppLanguage): boolean {
  const s = (text || '').trim();
  if (!s) return false;
  const letters = (s.match(/[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ]/g) || []).length;
  if (letters < 3) return true; // raqam/kod — tilga bog'liq emas
  const cyr = cyrillicCharCount(s);
  if (cyr / letters > 0.5) return lang === 'ru' && !UZ_ONLY_CYRILLIC_LETTERS.test(s);
  if (lang === 'ru') return false;
  const en = (s.match(EN_WORDS) || []).length;
  const uz = (s.match(UZ_WORDS) || []).length + (s.match(/[og]['‘’ʻ]/gi) || []).length;
  if (lang === 'uz') return uz > 0 && uz >= en;
  return en > uz;
}
