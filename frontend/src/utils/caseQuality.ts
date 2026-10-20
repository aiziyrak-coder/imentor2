/**
 * Keys yechimining kuchsizligini topish (rektor, 2026-10-13).
 *
 * Jonli keyslarda ko'rilgan kamchiliklar:
 *   * "yuqori EChT va qon bosimi … ko'rsatadi" — raqamsiz, aylanma mantiq;
 *   * "Birinchi farq qilish uchun… Ikkinchi… Uchinchi…" — bir xil gap uch marta;
 *   * "qon analizi tavsiya etiladi" — egasiz, umumiy tavsiya;
 *   * differensialda nozologiya nomi ham, rad etuvchi dalil ham yo'q.
 *
 * Promptda talab qilish yetarli emas: model ba'zan e'tiborsiz qoldiradi.
 * Shuning uchun natija TEKSHIRILADI va kuchsiz bo'lsa bir marta qayta
 * so'raladi — xuddi mavzuga moslik tekshiruvi kabi.
 *
 * Tekshiruv ataylab QO'POL: faqat ochiq-oydin kamchilikni tutadi, aks holda
 * yaxshi keysni ham bekor qilib, token sarfini oshirardi.
 */

/** Qolip iboralar — matn fikrlashdan ko'ra ro'yxatga aylanganini ko'rsatadi. */
const FILLER = [
  /birinchi\s+farq\s+qilish\s+uchun/i,
  /ikkinchi\s+farq\s+qilish\s+uchun/i,
  /uchinchi\s+farq\s+qilish\s+uchun/i,
  /muhim\s+ahamiyatga\s+ega/i,
  /e['’`]tibor\s+qaratish\s+lozim/i,
];

/** Raqamsiz sifatli ta'rif: fikrlash uchun yaroqsiz. */
const VAGUE = /\b(yuqori|past|ko['’`]tarilgan|pasaygan|oshgan|normal)\b/gi;

/** Raqam + birlik (yoki sof raqam) — dalilning borligi. */
const MEASURED =
  /\d+(?:[.,]\d+)?\s*(?:°\s?C|mm\s?Hg|mmHg|mmol\/l|mg\/dl|g\/l|mg|mkg|ml|%|mm\/soat|zarb\/min|nafas\/min|ball|kun|soat|hafta|yil)/i;

export type CaseWeakness =
  | 'fikr_yoli_yoq'
  | 'raqamsiz_xulosa'
  | 'qolip_ibora'
  | 'differensial_yuzaki';

/**
 * Yechimdagi kamchiliklar ro'yxati. Bo'sh massiv — kamchilik topilmadi.
 *
 * @param diagnosis "diagnosis" maydoni (klinik xulosa)
 * @param differential "differential" maydoni
 */
export function caseWeaknesses(diagnosis: string, differential: string): CaseWeakness[] {
  const out: CaseWeakness[] = [];
  const dx = (diagnosis || '').trim();
  const dd = (differential || '').trim();
  if (!dx || !dd) return out;          // bo'sh maydon boshqa joyda ushlanadi

  // 1. Fikr yo'li qatori — promptda AYNAN shu so'z talab qilingan.
  if (!/(?:fikr|фикр)\s*(?:yo['’`ʻ‘]?li|юли|ёли)|ход\s+рассуждения|\breasoning\b/i.test(dx)) out.push('fikr_yoli_yoq');

  // 2. Xulosa raqamga tayanmasa — "yuqori/past" bilan o'tib ketgan.
  const vagueHits = (dx.match(VAGUE) || []).length;
  if (!MEASURED.test(dx) && vagueHits > 0) out.push('raqamsiz_xulosa');

  // 3. Qolip iboralar.
  if (FILLER.some((re) => re.test(dx) || re.test(dd))) out.push('qolip_ibora');

  // 4. Differensial yorliqlari: QO'LLAB/RAD juftligi kamida ikki marta.
  const pairs = (dd.match(/(?:qo['’`ʻ‘]?llab|(?<!\p{L})за|\bfor)\s*:/giu) || []).length;
  const refuted = (dd.match(/(?:\brad|(?<!\p{L})против|\bagainst)\s*:/giu) || []).length;
  if (pairs < 2 || refuted < 2) out.push('differensial_yuzaki');

  return out;
}

/** Qayta urinish uchun izoh: nima aynan noto'g'ri bo'lganini aytadi. */
export function weakCaseRetryNote(found: CaseWeakness[]): string {
  const WHY: Record<CaseWeakness, string> = {
    fikr_yoli_yoq:
      '"diagnosis" maydoni "FIKR YO\'LI: <topilma 1> + <topilma 2> + <muhim YO\'Q belgi> -> <nozologiya>." qatori bilan BOSHLANMAGAN',
    raqamsiz_xulosa:
      'xulosa raqamsiz: "yuqori", "past" kabi sifatli ta\'rif ishlatilgan, qiymat va me\'yor oralig\'i yo\'q',
    qolip_ibora:
      '"Birinchi farq qilish uchun" kabi qolip iboralar ishlatilgan — ular fikrlash emas, ro\'yxat',
    differensial_yuzaki:
      '"differential" da "<Nozologiya> — QO\'LLAB: <topilma+raqam>; RAD: <topilma+raqam>." shakli yo\'q',
  };
  const lines = found.map((k) => `- ${WHY[k]}`).join('\n');
  return [
    'OLDINGI NATIJA YAROQSIZ — klinik fikrlashni o\'rgatmaydi. Topilgan kamchiliklar:',
    lines,
    'Butunlay qayta yozing va FIKRLASH SHARTNOMASINING har bandini bajaring. ',
    'Mazmun aynan shu mavzuga oid qolsin.',
  ].join('\n');
}

/**
 * Matn nuqsonlari (2026-10-20, prod tahlili: 400 keys, 105 savol qo'lda baholandi).
 *
 * gpt-4.1-nano davrida ko'rilgan, lekin `caseWeaknesses` ushlamagan narsalar:
 *   * to'ldirilmagan shablon: "<Muqobil>", "<Nozologiya>", "<standard value>";
 *   * JSON kalit nomi matnda: "patient: ...", "labs: ...";
 *   * takrorlanish halqasi: "qattiq, qattiq, qattiq og'riq" bir maydonda 5–10 marta.
 * Bunday matn talabaga ko'rsatilmasligi kerak — bir marta qayta so'raladi.
 */
export type CaseTextFlaw = 'shablon_qoldi' | 'kalit_nomi' | 'takrorlanish' | 'korsatma_sizdi';

const PLACEHOLDER_RE = /<\s*[\p{L}][\p{L}\s'’ʻ‘`/.-]{1,40}\s*>/u;
const KEY_LEAK_RE =
  /(?:^|\n)\s*(?:patient|complaints|history|lifestyle|examination|labs|diagnosis|differential|investigations|management|recommendations|task)\s*:/i;

/** Prompt ko'rsatmasi matnga ko'chgan (2026-10-20: "Ism, yosh va jins mosligi saqlangan holda"). */
const INSTRUCTION_LEAK_RE =
  /mosligi\s+saqlangan|BEMOR\s+qator|o['’`ʻ‘]zgartirmang|matnga\s+yozilmaydi|user\s+xabar|JSON\s+(?:maydon|kalit)|focus\s*=/i;

/** Matndagi 6 so'zli bo'laklarning necha ulushi takror (0..1). */
export function repetitionShare(text: string): number {
  const ws = (text || '').toLowerCase().match(/[\p{L}\p{N}'’ʻ‘]+/gu) || [];
  if (ws.length < 40) return 0;
  const seen = new Map<string, number>();
  for (let i = 0; i + 6 <= ws.length; i += 1) {
    const g = ws.slice(i, i + 6).join(' ');
    seen.set(g, (seen.get(g) || 0) + 1);
  }
  let dup = 0;
  for (const c of seen.values()) if (c > 1) dup += c - 1;
  return dup / Math.max(1, ws.length - 5);
}

/** Takror chegarasi: yaxshi keysda ~0–3%, nano halqalarida 15–60%. */
const REPETITION_LIMIT = 0.1;

export function caseTextFlaws(fields: Array<string | undefined | null>): CaseTextFlaw[] {
  const parts = fields.map((f) => String(f || ''));
  const all = parts.join('\n');
  const out: CaseTextFlaw[] = [];
  if (PLACEHOLDER_RE.test(all)) out.push('shablon_qoldi');
  if (parts.some((p) => KEY_LEAK_RE.test(p))) out.push('kalit_nomi');
  if (INSTRUCTION_LEAK_RE.test(all)) out.push('korsatma_sizdi');
  if (parts.some((p) => repetitionShare(p) > REPETITION_LIMIT) || repetitionShare(all) > REPETITION_LIMIT) {
    out.push('takrorlanish');
  }
  return out;
}

export function caseTextRetryNote(found: CaseTextFlaw[]): string {
  const WHY: Record<CaseTextFlaw, string> = {
    shablon_qoldi: 'matnda to\'ldirilmagan shablon qolgan (masalan "<Muqobil>", "<Nozologiya>") — o\'rniga aniq nom yozing',
    kalit_nomi: 'matnda JSON kalit nomi qolgan ("patient:", "labs:") — har maydon oddiy matn bo\'lsin',
    takrorlanish: 'bir xil gap yoki ibora qayta-qayta takrorlangan — har gap yangi fakt bersin',
    korsatma_sizdi: 'matnga ko\'rsatma so\'zlari tushgan (masalan "mosligi saqlangan holda") — faqat keys mazmunini yozing',
  };
  return [
    'OLDINGI NATIJA YAROQSIZ:',
    ...found.map((k) => `- ${WHY[k]}`),
    'Butunlay qayta yozing, mazmun shu mavzuda qolsin.',
  ].join('\n');
}

/** HTML qoldiqlari (`<br>`) — mazmun emas, olib tashlanadi. */
export function stripCaseHtml(text: string): string {
  return (text || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(?:b|i|strong|em|p|div|span)>/gi, '');
}

/**
 * Fikrlash yorliqlari promptda o'zbekcha ("FIKR YO'LI", "QO'LLAB", "RAD") —
 * tekshiruv shunga tayanadi. Ruscha/inglizcha keysda ular talabaga chiqish
 * tilida ko'rsatiladi (prodda "ФИКР YO'LI" kabi aralash yozuv uchragan).
 */
const LABELS: Record<'ru' | 'en', Array<[RegExp, string]>> = {
  ru: [
    [/(?:FIKR|ФИКР)\s*(?:YO['’`ʻ‘]?LI|ЙЎЛИ|ЮЛИ|ЁЛИ)/g, 'ХОД РАССУЖДЕНИЯ'],
    [/CHALG['’`ʻ‘]?ITUVCHI/g, 'ОТВЛЕКАЮЩИЙ ПРИЗНАК'],
    [/QO['’`ʻ‘]?LLAB\s*:/g, 'ЗА:'],
    [/\bRAD\s*:/g, 'ПРОТИВ:'],
  ],
  en: [
    [/(?:FIKR|ФИКР)\s*(?:YO['’`ʻ‘]?LI|ЙЎЛИ|ЮЛИ|ЁЛИ)/g, 'REASONING'],
    [/CHALG['’`ʻ‘]?ITUVCHI/g, 'DISTRACTOR'],
    [/QO['’`ʻ‘]?LLAB\s*:/g, 'FOR:'],
    [/\bRAD\s*:/g, 'AGAINST:'],
  ],
};

export function localizeCaseLabels(text: string, language: string): string {
  if (language !== 'ru' && language !== 'en') return text;
  return LABELS[language].reduce((acc, [re, to]) => acc.replace(re, to), text || '');
}
