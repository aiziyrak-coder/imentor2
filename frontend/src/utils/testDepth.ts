/**
 * Test savolining MAZMUN darajasini tekshirish (rektor, 2026-10-13).
 *
 * `testQuality.ts` savolning SHAKLINI tekshiradi (bitta savol, javob sir,
 * variantlar teng). Lekin shakli to'g'ri savol ham yuzaki bo'lishi mumkin:
 *
 *   "Quyidagilardan qaysi biri gipertoniyaga xos?"  — bitta so'zni eslash;
 *   "Qaysi biri to'g'ri EMAS?"                      — inkor savol, chalkash;
 *   "Bemor keldi. Qaysi tashxis?"                   — ma'lumotsiz vignette.
 *
 * Shuning uchun bu yerda USMLE uslubidagi talablar tekshiriladi:
 *
 *  1. vignette ZICH bo'lsin — kamida ikki aniq ma'lumot (raqam+birlik yoki
 *     vaqt), aks holda fikrlash uchun tayanch yo'q;
 *  2. savol QARORGA olib borsin — "keyingi qadam", "eng ehtimoliy",
 *     "qaysi mexanizm", "nima mumkin emas" kabi;
 *  3. INKOR savol bo'lmasin ("qaysi biri EMAS") — u bilimni emas, diqqatni
 *     tekshiradi;
 *  4. variantlarda MUTLAQ so'z bo'lmasin ("har doim", "hech qachon") —
 *     ular javobni oshkor qiladi;
 *  5. izoh distraktorlarni RAD ETSIN — talaba xatosini shundan o'rganadi.
 *
 * Tekshiruv faqat ochiq-oydin kamchilikni tutadi: har bir rad etilgan savol
 * qayta so'rovga, ya'ni vaqt va token sarfiga olib keladi.
 */

export type DepthFlaw =
  | 'vignette_yuzaki'
  | 'eslash_savoli'
  | 'inkor_savol'
  | 'mutlaq_variant'
  | 'izoh_yuzaki';

export type DepthInput = {
  question?: string;
  options?: string[];
  correctOptionIndex?: number;
  explanation?: string;
};

export type DepthOptions = {
  /** `academic` da bemor ma'lumoti talab qilinmaydi. */
  domain?: 'clinical' | 'biomedical' | 'academic';
  difficulty?: 'easy' | 'medium' | 'hard';
};

/**
 * Fikrlash uchun tayanch bo'ladigan aniq ma'lumot.
 *
 * Ikki shakl sanaladi, chunki klinik matnda birlik har doim yozilmaydi:
 *   * raqam + birlik — "38,6 °C", "130/85 mm Hg", "8,2%";
 *   * ko'rsatkich nomi + raqam — "leykotsit 12 400", "troponin 2,4",
 *     "EChT 68", "HbA1c 8,2".
 *
 * Ilgari faqat birinchisi sanalardi va jonli savollarning 89% i "yuzaki"
 * bo'lib chiqardi — holbuki ularda raqam bor edi, faqat birligi yozilmagan.
 */
const DATA_POINT =
  /\d+(?:[.,]\d+)?\s*(?:°\s?C|mm\s?Hg|mmHg|mmol\/l|mg\/dl|g\/l|mg|mkg|ml|%|mm\/soat|zarb\/min|nafas\/min|ming\/mkl|ball|yosh|kun|soat|hafta|oy|yil)/gi;
const NAMED_VALUE = new RegExp(
  '\\b(?:' +
    // o'zbek / lotin
    'leykotsit\\w*|eritrotsit\\w*|gemoglobin|trombotsit\\w*|echt|esr|crp|troponin|kreatinin|urea' +
    '|glyukoza|hba1c|alt|ast|bilirubin|kaliy|natriy|kalsiy|ph|pco2|po2|spo2|puls|ab|bosim|harorat' +
    '|inr|aptt|ferritin|tsh|t4|amilaza|lipaza|albumin|protein|nitrit\\w*|siydik|titr' +
    // rus tilidagi fanlar uchun — ularni ham ko'rishi kerak, aks holda
    // ruscha savol nohaq "yuzaki" bo'lib chiqadi (2026-10-13 o'lchovi)
    '|лейкоцит\\w*|эритроцит\\w*|гемоглобин|тромбоцит\\w*|соэ|срб|тропонин|креатинин|мочевин\\w*' +
    '|глюкоза|глик\\w*|алт|аст|билирубин|калий|натрий|кальций|рн|пульс|ад|давлени\\w*|температур\\w*' +
    '|сатураци\\w*|фев1|фжел|свинц\\w*|белок|альбумин|титр|моч\\w*' +
    // inglizcha
    '|wbc|rbc|hgb|plt|bun|glucose|sodium|potassium|calcium|temperature|pulse|saturation' +
    ')\\b[^.;]{0,20}?\\d+(?:[.,]\\d+)?',
  'gi',
);

/** Qaror so'raydigan savol boshlanmalari. */
const DECISION =
  /(keyingi\s+(?:eng\s+)?(?:to['’`]?g['’`]?ri\s+)?qadam|eng\s+ehtimoliy|eng\s+to['’`]?g['’`]?ri|qaysi\s+mexanizm|qaysi\s+tuzilma|nima\s+(?:uchun\s+)?mumkin\s+emas|kontrendikatsiya|qaysi\s+(?:topilma|ko['’`]?rsatkich)|qanday\s+o['’`]?zgaradi|eng\s+yaxshi\s+tushuntiradi|birinchi\s+navbatda|most\s+likely|next\s+best\s+step)/i;

/** Yuzaki eslash savollari. */
const RECALL =
  /(quyidagilardan\s+qaysi\s+biri|qaysi\s+biri\s+(?:to['’`]?g['’`]?ri|xos|mos)|nima\s*\?|nimadan\s+iborat|ta['’`]?rifi|qaysi\s+javob)/i;

/** Inkor savol. */
const NEGATIVE =
  /(\bemas\b|\bnoto['’`]?g['’`]?ri\b|\bbo['’`]?lmaydi\b|\bistisno\b|\bexcept\b|\bnot\s+true\b)/i;

/** Mutlaq so'zlar — variantni oshkor qiladi. */
const ABSOLUTE = /(\bhar\s+doim\b|\bhech\s+qachon\b|\bfaqat\s+shu\b|\bhamma\s+hollarda\b|\balways\b|\bnever\b)/i;

function fold(value: string): string {
  let text = (value || '').toLowerCase();
  for (const ch of '‘’ʻʼ`\'') text = text.split(ch).join('');
  return text;
}

/** Variantning tanib olinadigan o'zagi — izohda qidirish uchun. */
function keyword(option: string): string {
  const words = fold(option)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 4);
  return words.sort((a, b) => b.length - a.length)[0] || '';
}

export function depthFlaws(q: DepthInput, opts: DepthOptions = {}): DepthFlaw[] {
  const out: DepthFlaw[] = [];
  const stem = String(q.question || '').trim();
  const options = (q.options || []).map((o) => String(o || ''));
  const explanation = String(q.explanation || '');
  if (!stem || options.length < 2) return out;

  const domain = opts.domain || 'clinical';
  const difficulty = opts.difficulty || 'hard';
  const words = stem.split(/\s+/).filter(Boolean).length;

  // 1. Vignette zichligi. `academic` fanlarda raqam har doim bo'lmaydi,
  //    shuning uchun u yerda faqat uzunlik talab qilinadi.
  const dataPoints =
    (stem.match(DATA_POINT) || []).length + (stem.match(NAMED_VALUE) || []).length;
  const needData = domain !== 'academic' && difficulty !== 'easy';
  // Klinik bo'lmagan fanda vazifa qisqaroq bo'lishi tabiiy (raqam ham shart
  // emas), lekin bir qatorlik ta'rif savoli bo'lib qolmasligi kerak.
  const minWords = domain === 'academic' ? 20 : difficulty === 'easy' ? 18 : 30;
  if (words < minWords || (needData && dataPoints < 2)) out.push('vignette_yuzaki');

  // 2. Savol qarorga olib borsinmi.
  if (!DECISION.test(stem) && RECALL.test(stem)) out.push('eslash_savoli');

  // 3. Inkor savol — faqat savolning SO'ROQ qismida qaraladi.
  const tail = stem.slice(stem.lastIndexOf('.') + 1);
  if (NEGATIVE.test(tail)) out.push('inkor_savol');

  // 4. Mutlaq so'zli variant.
  if (options.some((o) => ABSOLUTE.test(o))) out.push('mutlaq_variant');

  // 5. Izoh distraktorlarni rad etsinmi: noto'g'ri variantlarning kamida
  //    yarmi izohda eslansin. Qisqa izoh darhol yuzaki.
  const idx = q.correctOptionIndex;
  if (typeof idx === 'number' && idx >= 0 && idx < options.length) {
    const wrong = options.filter((_, i) => i !== idx);
    const mentioned = wrong.filter((o) => {
      const key = keyword(o);
      return key.length > 4 && fold(explanation).includes(key);
    }).length;
    if (explanation.trim().length < 120 || mentioned * 2 < wrong.length) {
      out.push('izoh_yuzaki');
    }
  }

  return out;
}

/** Modelga qaytib aytiladigan izoh. */
export function depthRetryNote(flaws: DepthFlaw[]): string {
  const WHY: Record<DepthFlaw, string> = {
    vignette_yuzaki:
      'savol YUZAKI: vignette qisqa yoki ichida aniq ma\'lumot yo\'q — kamida IKKI aniq topilma (raqam+birlik) va vaqt bo\'lsin',
    eslash_savoli:
      'savol ESLASHNI tekshiradi ("quyidagilardan qaysi biri...", "X nima?") — o\'rniga QAROR so\'rang: keyingi eng to\'g\'ri qadam, eng ehtimoliy holat, qaysi mexanizm, nima mumkin emas',
    inkor_savol:
      'INKOR savol ishlatilgan ("qaysi biri to\'g\'ri EMAS") — bu bilimni emas, diqqatni tekshiradi; savolni to\'g\'ri shaklda bering',
    mutlaq_variant:
      'variantda MUTLAQ so\'z bor ("har doim", "hech qachon", "faqat shu") — bunday variant javobni oshkor qiladi',
    izoh_yuzaki:
      'izoh YUZAKI: u faqat to\'g\'ri javobni takrorlagan — har bir NOTO\'G\'RI variant nega jalb qiladi va nega xato ekanini yozing',
  };
  const seen = Array.from(new Set(flaws));
  return [
    'OLDINGI SAVOLLARNING SAVIYASI YETARLI EMAS. Topilgan kamchiliklar:',
    seen.map((f) => `- ${WHY[f]}`).join('\n'),
    'Yangi savollar oliy tibbiy ta\'lim (USMLE Step 2 CK / rezidentura) darajasida bo\'lsin.',
  ].join('\n');
}
