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
  if (!/fikr\s*yo['’`]?li/i.test(dx)) out.push('fikr_yoli_yoq');

  // 2. Xulosa raqamga tayanmasa — "yuqori/past" bilan o'tib ketgan.
  const vagueHits = (dx.match(VAGUE) || []).length;
  if (!MEASURED.test(dx) && vagueHits > 0) out.push('raqamsiz_xulosa');

  // 3. Qolip iboralar.
  if (FILLER.some((re) => re.test(dx) || re.test(dd))) out.push('qolip_ibora');

  // 4. Differensial yorliqlari: QO'LLAB/RAD juftligi kamida ikki marta.
  const pairs = (dd.match(/qo['’`]?llab\s*:/gi) || []).length;
  const refuted = (dd.match(/\brad\s*:/gi) || []).length;
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
