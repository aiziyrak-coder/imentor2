/**
 * Keys javobining SHAKLINI tiklash (2026-10-15).
 *
 * Jonli ma'lumot: 14–15 oktabrda saqlangan klinik keyslarning 118/123 tasi
 * uchala savol bilan, biotibbiyot keyslarining esa faqat 84/187 tasi to'liq
 * edi — qolganlarida bir yoki ikki savol "vaziyati bo'sh" deb tashlangan.
 * Model mazmunni yozadi, lekin har doim so'ralgan 11 kalitga emas: vaziyatni
 * ichma-ich obyektga (`{"case": {...}}`), boshqa nomli kalitga ("scenario",
 * "vaziyat") yoki matn o'rniga ro'yxat/obyekt qilib qaytaradi. Biotibbiyotda
 * bu ko'proq: kalitlar klinik nomli ("patient", "complaints"), ko'rsatma esa
 * "bemor kartasi EMAS" deydi.
 *
 * Bu yerda mazmun YO'QOTILMAYDI va o'ylab topilmaydi — faqat to'g'ri joyga
 * qo'yiladi. Baribir bo'sh qolsa, chaqiruvchi bir marta qayta so'raydi.
 */

export const CASE_SCENARIO_KEYS = ['patient', 'complaints', 'history', 'lifestyle', 'examination', 'labs'] as const;
export const CASE_SOLUTION_KEYS = ['diagnosis', 'differential', 'investigations', 'management', 'recommendations'] as const;
const KNOWN = new Set<string>([...CASE_SCENARIO_KEYS, ...CASE_SOLUTION_KEYS, 'focus']);

/** Model vaziyat uchun ishlatadigan boshqa nomlar. */
const SCENARIO_ALIASES = [
  'scenario', 'situation', 'case', 'vignette', 'context', 'background', 'description',
  'vaziyat', 'holat', 'masala', 'shart', 'shartlar', 'ssenariy', 'kazus',
];
/** Yechim uchun boshqa nomlar. */
const SOLUTION_ALIASES = ['answer', 'solution', 'yechim', 'javob', 'analysis', 'tahlil', 'explanation', 'izoh'];

/** Ro'yxat yoki obyekt — o'qiladigan matnga; matn o'zgarmaydi. */
export function caseText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(caseText).filter((s) => s.trim()).join('\n');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const text = caseText(v).trim();
        return text ? `${k}: ${text}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** `{"case": {...11 kalit...}}` kabi o'ralgan javobni ochadi. */
function unwrap(raw: Record<string, unknown>): Record<string, unknown> {
  const hasKnown = Object.keys(raw).some((k) => KNOWN.has(k) && caseText(raw[k]).trim());
  if (hasKnown) return raw;
  for (const value of Object.values(raw)) {
    if (isRecord(value) && Object.keys(value).some((k) => KNOWN.has(k))) return value;
    if (Array.isArray(value) && isRecord(value[0]) && Object.keys(value[0]).some((k) => KNOWN.has(k))) {
      return value[0] as Record<string, unknown>;
    }
  }
  return raw;
}

const blank = (raw: Record<string, unknown>, keys: readonly string[]) =>
  keys.every((k) => !caseText(raw[k]).trim());

/**
 * 11 kalitli, hamma qiymati MATN bo'lgan keysga keltiradi.
 *
 * Vaziyat kalitlari bo'sh bo'lsa, vaziyatga o'xshash boshqa nomli maydon
 * (yoki noma'lum maydonlar) "patient" ga qo'yiladi; yechim bo'sh bo'lsa —
 * yechim nomli maydon "diagnosis" ga.
 */
export function repairCaseShape<T extends Record<string, unknown>>(input: unknown): T {
  if (!isRecord(input)) return {} as T;
  const raw = unwrap(input);
  const out: Record<string, unknown> = {};
  for (const k of [...CASE_SCENARIO_KEYS, ...CASE_SOLUTION_KEYS]) {
    const text = caseText(raw[k]).trim();
    if (text) out[k] = text;
  }
  if (typeof raw.focus === 'string') out.focus = raw.focus;

  const lower = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
  if (blank(out, CASE_SCENARIO_KEYS)) {
    const named = SCENARIO_ALIASES.map((k) => caseText(lower[k]).trim()).filter(Boolean);
    const unknown = named.length
      ? []
      : Object.entries(raw)
          .filter(([k]) => !KNOWN.has(k) && !SOLUTION_ALIASES.includes(k.toLowerCase()))
          .map(([, v]) => caseText(v).trim())
          .filter(Boolean);
    const text = [...named, ...unknown].join('\n\n');
    if (text) out.patient = text;
  }
  if (blank(out, CASE_SOLUTION_KEYS)) {
    const text = SOLUTION_ALIASES.map((k) => caseText(lower[k]).trim()).filter(Boolean).join('\n\n');
    if (text) out.diagnosis = text;
  }
  return out as T;
}

/** Jurnal uchun: qaysi kalit qancha uzun keldi — matnning o'zi emas. */
export function caseShapeSummary(input: unknown): string {
  if (!isRecord(input)) return `turi: ${input === null ? 'null' : typeof input}`;
  return Object.entries(input)
    .map(([k, v]) => `${k}:${Array.isArray(v) ? 'list' : isRecord(v) ? 'obj' : typeof v}/${caseText(v).length}`)
    .join(' ');
}

/** Qayta so'rashda modelga aytiladigan izoh. */
export const CASE_SHAPE_RETRY_NOTE =
  'OLDINGI JAVOB YAROQSIZ: vaziyat yoki yechim maydonlari bo\'sh qolgan yoki boshqa kalitlarga yozilgan. ' +
  'JSON AYNAN 11 kalitdan iborat bo\'lsin: "patient","complaints","history","lifestyle","examination","labs",' +
  '"diagnosis","differential","investigations","management","recommendations". ' +
  'Har birining qiymati MATN (string), ro\'yxat yoki ichma-ich obyekt EMAS, hech biri bo\'sh EMAS. ' +
  'Fan klinik bo\'lmasa ham kalit nomlari o\'zgarmaydi — mazmuni maydon ta\'rifiga mos yoziladi; ' +
  '"scenario", "case", "vaziyat" kabi boshqa kalit QO\'SHILMAYDI.';
