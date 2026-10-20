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

/**
 * Baholashni buzadigan nuqsonlar — bunday savol hech qachon ishlatilmaydi.
 *
 * Qolgan nuqsonlar (ikki savol, javob eng uzun, javob stemda) savolni
 * xunuk qiladi, lekin baho to'g'ri qo'yiladi — shuning uchun boshqa savol
 * qolmasa, ular oxirgi chora sifatida ishlatiladi (2026-10-15).
 */
export const UNGRADABLE = new Set(['javob_yoq', 'variant_takror', 'variant_tartib_takror', 'hammasi_togri']);

export type QuestionFlaw =
  | 'ikki_savol'
  | 'manba_savolda'
  | 'javob_savolda'
  | 'javob_eng_uzun'
  | 'variant_takror'
  | 'variant_tartib_takror'
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

  // 2. Savol ichidagi manba havolasi: javobni oshkor qiladi va savolni
  //    kitobdan qidirishga aylantiradi ("(Source: Robbins, 2015, p. 108)").
  if (/\((?:source|manba|источник)\s*:|\bp\.\s*\d+\s*\)/i.test(stem)) {
    out.push('manba_savolda');
  }

  if (typeof idx !== 'number' || idx < 0 || idx >= opts.length) {
    out.push('javob_yoq');
    return out;                                    // qolgan tekshiruvlar javobga tayanadi
  }

  const correct = opts[idx];

  // 2. Javob savolning o'zida aytilgan.
  const needle = core(correct);
  if (needle.length >= 8 && fold(stem).includes(needle)) out.push('javob_savolda');
  else {
    // So'z boshi bo'yicha (o'zbekcha qo'shimchalar: "ishqalanish" ~ "ishqalanishi").
    // Stem "ishqalanish shovqini bor" deb, javob "Plevral ishqalanish shovqini"
    // bo'lgan savollar ushlanmasdi (2026-10-19, 370 savolda 22 ta).
    const answerStems = stemsOf(correct);
    const stemStems = new Set(stemsOf(stem));
    if (answerStems.length >= 2 && answerStems.filter((w) => stemStems.has(w)).length / answerStems.length >= 0.6) {
      out.push('javob_savolda');
    }
  }

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
  else {
    // Bir xil so'zlar, faqat tartibi boshqa: "Sil, emfizem, sarkoidoz" va
    // "Emfizem, sil, sarkoidoz" — talaba uchun bu ikki teng javob (2026-10-19,
    // radiologiya yakuniy testi). Qisqa nomlar (<3 so'z) tasodifan mos kelmasin.
    const bags = opts
      .map((o) => fold(o).split(/[^\p{L}\p{N}]+/u).filter(Boolean).sort())
      .filter((words) => words.length >= 3)
      .map((words) => words.join(' '));
    if (new Set(bags).size !== bags.length) out.push('variant_tartib_takror');
  }

  // 5. "Hammasi to'g'ri" — bitta to'g'ri javob qoidasini buzadi.
  if (opts.some((o) => ALL_OF_THE_ABOVE.test(o))) out.push('hammasi_togri');

  return out;
}

/** 4+ harfli so'zlarning 6 harfli boshi — o'zbekcha qo'shimchalarni tenglashtiradi. */
function stemsOf(value: string): string[] {
  return fold(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4)
    .map((w) => w.slice(0, 6));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/**
 * Test ichidagi takror savollarni olib tashlaydi (2026-10-19).
 *
 * 37 klinik fanda 370 savol tekshirilganda deyarli har testda 1–3 juft savol
 * bir xil narsani so'radi: yetishmagan savollar qayta so'ralganda (`topUp`)
 * model mavjud ro'yxatni ko'rsa ham shu tushunchani boshqa bemor bilan
 * qaytarardi. Ikki belgi:
 *   * to'g'ri javob bir xil (so'z boshi bo'yicha) — 32 juft;
 *   * stem so'zlarining 40% dan ko'pi umumiy — 7 juft.
 * Birinchisi qoladi, keyingisi tashlanadi.
 */
export function dropDuplicateQuestions<T extends TestQuestionLike>(
  questions: T[],
): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  const keys: Set<string>[] = [];
  const stemSets: Set<string>[] = [];
  for (const q of questions || []) {
    const opts = q.options || [];
    const idx = typeof q.correctOptionIndex === 'number' ? q.correctOptionIndex : -1;
    // Kalit: BARCHA so'zlar (rim raqami, son, qisqa so'z ham) — "Blek I sinf" va
    // "Blek II sinf" takror emas (2026-10-19: tor mavzuda test chiqmay qolgan).
    const key = new Set(
      idx >= 0 && idx < opts.length
        ? fold(String(opts[idx] || '')).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => w.slice(0, 4))
        : [],
    );
    const stemSet = new Set(stemsOf(String(q.question || '')));
    // Kalit so'zlari 60% mos — takror ("Past doza aspirin boshlash" ~ "Past dozali aspirin").
    const dup =
      (key.size > 0 && keys.some((other) => jaccard(other, key) >= 0.6)) ||
      stemSets.some((other) => jaccard(other, stemSet) >= 0.5);
    if (dup) {
      dropped.push(q);
      continue;
    }
    kept.push(q);
    keys.push(key);
    stemSets.push(stemSet);
  }
  return { kept, dropped };
}

/**
 * Bir variant butun testda ko'p marta takrorlanadimi (2026-10-19).
 *
 * Model bir testda bir xil 6–8 ta variant iborasini aylantirib ishlatardi
 * ("Temir preparatlari", "Parietal hujayra antitanalari" — 10 savolning
 * 6 tasida). Talaba variantlarni yodlab, savolni o'qimay yechadi. Biror
 * variant 3-marta uchragan savoldan boshlab savol "zaif" hisoblanadi.
 */
export function overusedOptionQuestions<T extends TestQuestionLike>(questions: T[], limit = 2): Set<T> {
  const seen = new Map<string, number>();
  const flagged = new Set<T>();
  for (const q of questions || []) {
    let over = false;
    for (const o of q.options || []) {
      const key = fold(String(o || ''));
      if (!key) continue;
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      if (n > limit) over = true;
    }
    if (over) flagged.add(q);
  }
  return flagged;
}

/** Testda allaqachon ishlatilgan to'g'ri javoblar — qayta so'rovda taqiqlanadi. */
export function usedAnswers(questions: TestQuestionLike[]): string[] {
  return (questions || [])
    .map((q) => (q.options || [])[q.correctOptionIndex ?? -1])
    .filter((a): a is string => Boolean(a && String(a).trim()));
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
    manba_savolda:
      'savol matnida MANBA ko\'rsatilgan ("(Source: ...)", "p. 108") — bu javobni oshkor qiladi; manbani savolga yozmang',
    ikki_savol:
      'bitta savol ichida IKKI savol bo\'lgan — har savolda AYNAN BITTA so\'roq gap va bitta savol belgisi bo\'lsin',
    javob_savolda:
      'to\'g\'ri javob savol matnining o\'zida aytilgan — savolda javobni takrorlamang',
    javob_eng_uzun:
      'to\'g\'ri javob variantlar ichida eng uzuni bo\'lgan — 5 variant uzunligi va tuzilishi bir-biriga yaqin bo\'lsin',
    variant_takror: 'bir xil variant ikki marta yozilgan',
    variant_tartib_takror:
      'ikki variant bir xil so\'zlardan iborat, faqat tartibi boshqa — har variant MAZMUNAN boshqa javob bo\'lsin',
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
