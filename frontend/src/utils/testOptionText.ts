/**
 * Variant matnidan takroriy harf prefiksini olib tashlaydi.
 *
 * Interfeys variant harfini o'zi qo'yadi ("A) ..."), lekin AI ba'zan matn
 * ichiga ham yozadi — natijada "A) A. Papula" ko'rinadi. Rus tiliga
 * tarjimada prefiks kirilcha bo'lib qolishi ham mumkin ("А. Папула").
 */

/** Lotin va kirilcha ko'rinishdagi variant harflari (A/А, B/В/Б, C/С, D/Д, E/Е). */
const OPTION_LETTERS: string[][] = [
  ['A', 'А'],
  ['B', 'В', 'Б'],
  ['C', 'С'],
  ['D', 'Д'],
  ['E', 'Е'],
  ['F', 'Ф'],
];

/**
 * @param text  variant matni
 * @param index 0-based variant tartibi; berilsa faqat SHU harf prefiksi
 *              olib tashlanadi (mazmunli "A. Papula" nomlarini buzmaslik uchun).
 */
export function stripOptionLetterPrefix(text: string, index?: number): string {
  const raw = (text ?? '').trim();
  if (!raw) return raw;

  const letters =
    index != null
      ? OPTION_LETTERS[index] ?? []
      : OPTION_LETTERS.flat();
  if (letters.length === 0) return raw;

  const escaped = letters.join('|');
  // "A.", "A)", "A -", "A:" va shu kabilar — orqasidan bo'shliq bilan.
  const re = new RegExp(`^(?:${escaped})\\s*[.):\\-–—]\\s+`, 'i');
  const stripped = raw.replace(re, '').trim();
  // Butun matn faqat prefiksdan iborat bo'lsa, asl matnni qaytaramiz.
  return stripped || raw;
}

/**
 * Variantlar ro'yxatidan harf belgilarini olib tashlaydi — faqat HAMMA
 * variant o'z harfi bilan boshlansa ("A) …", "B) …", "C) …").
 *
 * Bitta variantga qarab qaror qilib bo'lmaydi: "C. difficile" 3-o'rinda,
 * "E. coli" 5-o'rinda turganda harf prefiksiga o'xshaydi va ilgari
 * "difficile", "coli" bo'lib qolardi. Aralashtirilgandan keyin bu tasodifan
 * istalgan savolda yuz berardi. AI belgi qo'ysa — hammasiga qo'yadi.
 */
export function stripOptionLabels(options: string[]): string[] {
  const list = (options || []).map((o) => String(o ?? '').trim());
  if (list.length < 2) return list;
  const stripped = list.map((o, i) => stripOptionLetterPrefix(o, i));
  const allLabelled = stripped.every((s, i) => s !== list[i]);
  return allLabelled ? stripped : list;
}

const LETTERS = 'ABCDE';
// Izohda variantga ishora: "to'g'ri javob — A", "javob: (B)", "A variant",
// "C) noto'g'ri", "(D)". Faqat shu kontekstlarda — "vitamin A" ga tegilmaydi.
const ANSWER_WORD =
  "(?:[Jj]avob\\p{L}*|[Vv]ariant\\p{L}*|[Oo]ption|[Aa]nswer|[Оо]твет\\p{L}*|[Вв]ариант\\p{L}*)";
const LETTER_REF = new RegExp(
  `(${ANSWER_WORD}\\s*[—–:\\-]?\\s*[«"“(]?)([A-E])(?![\\p{L}\\p{N}])` +
    `|(^|[\\s(«"“'])([A-E])(?=\\)|\\s*-?\\s*(?:[Vv]ariant|[Jj]avob|[Вв]ариант|[Oo]ption))`,
  'gu',
);

/**
 * Variantlar aralashtirilganda izoh ichidagi harf ishoralarini yangi
 * tartibga moslaydi.
 *
 * AI to'g'ri javobni deyarli doim A ga qo'yadi va izohga "To'g'ri javob — A"
 * deb yozadi. Aralashtirishdan keyin to'g'ri variant C da turardi, izoh esa
 * hamon A ni ko'rsatardi — o'qituvchilar "tizim A yoki B ni to'g'ri deb
 * oladi" deb shikoyat qilgani shu (2026-10-16).
 *
 * @param newIndexOf eski indeks -> yangi indeks
 */
export function remapOptionLetters(text: string, newIndexOf: number[]): string {
  if (!text) return text;
  const map = (letter: string): string => {
    const next = newIndexOf[LETTERS.indexOf(letter)];
    return next != null && next >= 0 ? LETTERS[next] : letter;
  };
  return text.replace(LETTER_REF, (_m, p1, l1, p2, l2) =>
    l1 != null ? `${p1}${map(l1)}` : `${p2}${map(l2)}`,
  );
}
