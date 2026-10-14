/**
 * Test savolining nuqsonlarini topish (rektor, 2026-10-13).
 *
 * Jonli ma'lumotda 31 201 savol tekshirilganda:
 *   * 16 997 (54,5%) savolda BITTA savol ichida ikki savol bor edi
 *     ("...qanday chetga chiqishni ko'rsatadi? Miqdori qanday bo'lishi kerak?");
 *   * 14 916 (47,8%) savolda to'g'ri javob eng uzun variant edi — talaba
 *     o'qimasdan, uzunligidan topadi;
 *   * 1 983 (6,4%) savolda javob savolning o'zida aytilgan edi
 *     ("...1000 CFU/m³ dan oshsa..." -> javob "1000 CFU/m³ dan oshmasligi kerak");
 *   * 485 savolda bir xil variant ikki marta yozilgan.
 *
 * Promptda talab qilish yetarli emas — shuning uchun natija tekshiriladi va
 * nuqsonli savol OLINMAYDI; yetishmagani o'rniga yangisi so'raladi.
 *
 * Tekshiruv ataylab qo'pol: faqat ochiq-oydin nuqsonni tutadi.
 */

export type QuestionFlaw =
  | 'ikki_savol'
  | 'javob_savolda'
  | 'javob_eng_uzun'
  | 'variant_takror'
  | 'hammasi_togri'
  | 'javob_yoq';

export type TestQuestionLike = {
  question?: string;
  options?: string[];
  correctOptionIndex?: number;
};

/** Solishtirish uchun: kichik harf, tutuq belgisiz, bitta bo'sh joy. */
function fold(value: string): string {
  let text = (value || '').toLowerCase();
  for (const ch of '‘’ʻʼ`\'') text = text.split(ch).join('');
  return text.replace(/[^\p{L}\p{N}%/³²°.,<>-]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** "Hammasi to'g'ri" turidagi variantlar — bir savolda bir nechta javob bo'lib qoladi. */
const APOS = "['‘’ʻʼ`]?";
const ALL_OF_THE_ABOVE = new RegExp(
  `(hammasi\\s+to${APOS}g${APOS}ri|barcha\\s+javob|yuqoridagilarning\\s+hammasi` +
    '|hech\\s+biri|все\\s+ответы|all\\s+of\\s+the\\s+above|none\\s+of\\s+the\\s+above)',
  'i',
);

/**
 * Javob variantining mazmunli o'zagi — savolda qidirish uchun.
 *
 * Qo'shimcha so'zlar ("dan", "kerak", "hisoblanadi") olib tashlanadi, aks
 * holda tasodifiy mos kelish ko'payadi.
 */
function core(value: string): string {
  const stop = new Set([
    'dan', 'gan', 'uchun', 'kerak', 'bolishi', 'hisoblanadi', 'oshmasligi',
    'bilan', 'ichida', 'yoki', 'va', 'the', 'and', 'for', 'of',
  ]);
  return fold(value)
    .split(' ')
    .filter((w) => w.length > 2 && !stop.has(w))
    .join(' ');
}

/**
 * Bitta savolning nuqsonlari. Bo'sh massiv — savol yaroqli.
 */
export function questionFlaws(q: TestQuestionLike): QuestionFlaw[] {
  const out: QuestionFlaw[] = [];
  const stem = String(q.question || '').trim();
  const opts = (q.options || []).map((o) => String(o || '').trim());
  const idx = q.correctOptionIndex;

  if (!stem || opts.length < 2) return out;        // bo'sh savol boshqa joyda ushlanadi

  // 1. Bitta savolda ikki savol: ikkita savol belgisi yoki "2)" bilan boshlangan qator.
  if ((stem.match(/\?/g) || []).length > 1 || /(?:^|\n)\s*[2-9][.)]\s/.test(stem)) {
    out.push('ikki_savol');
  }

  if (typeof idx !== 'number' || idx < 0 || idx >= opts.length) {
    out.push('javob_yoq');
    return out;                                    // qolgan tekshiruvlar javobga tayanadi
  }

  const correct = opts[idx];

  // 2. Javob savolning o'zida aytilgan.
  const needle = core(correct);
  if (needle.length >= 8 && fold(stem).includes(needle)) out.push('javob_savolda');

  // 3. To'g'ri javob variantlar ichida ANIQ eng uzuni.
  //    Chegara qo'yilgan: har qanday farq emas, faqat ko'zga tashlanadigani —
  //    aks holda yaxshi savollar ham tashlanib, token sarfi oshardi.
  const others = opts.filter((_, i) => i !== idx).map((o) => o.length);
  const longestOther = Math.max(...others, 0);
  if (correct.length > longestOther * 1.6 && correct.length - longestOther > 25) {
    out.push('javob_eng_uzun');
  }

  // 4. Takrorlangan variant: talaba ikki bir xil javobni ko'radi.
  const flat = opts.map((o) => fold(o)).filter(Boolean);
  if (new Set(flat).size !== flat.length) out.push('variant_takror');

  // 5. "Hammasi to'g'ri" — bitta to'g'ri javob qoidasini buzadi.
  if (opts.some((o) => ALL_OF_THE_ABOVE.test(o))) out.push('hammasi_togri');

  return out;
}

/** Nuqsoni bor savollarni ajratadi. */
export function splitByQuality<T extends TestQuestionLike>(
  questions: T[],
): { clean: T[]; flawed: { question: T; flaws: QuestionFlaw[] }[] } {
  const clean: T[] = [];
  const flawed: { question: T; flaws: QuestionFlaw[] }[] = [];
  for (const q of questions || []) {
    const flaws = questionFlaws(q);
    if (flaws.length) flawed.push({ question: q, flaws });
    else clean.push(q);
  }
  return { clean, flawed };
}

/** Modelga qaytib aytiladigan izoh: nima aynan noto'g'ri bo'lgan. */
export function flawRetryNote(flaws: QuestionFlaw[]): string {
  const WHY: Record<QuestionFlaw, string> = {
    ikki_savol:
      'bitta savol ichida IKKI savol bo\'lgan — har savolda AYNAN BITTA so\'roq gap va bitta savol belgisi bo\'lsin',
    javob_savolda:
      'to\'g\'ri javob savol matnining o\'zida aytilgan — savolda javobni takrorlamang',
    javob_eng_uzun:
      'to\'g\'ri javob variantlar ichida eng uzuni bo\'lgan — 5 variant uzunligi va tuzilishi bir-biriga yaqin bo\'lsin',
    variant_takror: 'bir xil variant ikki marta yozilgan',
    hammasi_togri: '"hammasi to\'g\'ri" turidagi variant ishlatilgan — TAQIQLANADI',
    javob_yoq: 'to\'g\'ri javob raqami yo\'q yoki variantlar sonidan tashqarida',
  };
  const seen = Array.from(new Set(flaws));
  return [
    'OLDINGI SAVOLLARNING BIR QISMI YAROQSIZ. Topilgan nuqsonlar:',
    seen.map((f) => `- ${WHY[f]}`).join('\n'),
    'Yangi savollarda bu nuqsonlar BO\'LMASIN.',
  ].join('\n');
}
