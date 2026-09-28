/**
 * Portal dasturi: 6-kurs masofaviy ta'lim yoki malaka oshirish.
 *
 * Ikkalasi bitta bundle va bitta konteynerdan xizmat qiladi, backend ham
 * bitta — farq fanning `program` ustunida. Brauzerda qaysi dastur ekanini
 * DOMEN hal qiladi: `onlinetalim.fermi.uz` yoki `malaka.fermi.uz`.
 *
 * `?online=1` / `?malaka=1` — faqat ishlab chiqish va tez tekshirish uchun.
 */

export type Program = 'online' | 'malaka';

function envValue(key: string): string | undefined {
  try {
    return (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.[key];
  } catch {
    return undefined;
  }
}

/** Qaysi portal ochilgan; iMentor'ning o'zi bo'lsa — `null`. */
export function detectProgram(): Program | null {
  try {
    const host = window.location.hostname.toLowerCase();
    const params = new URLSearchParams(window.location.search);
    const malakaHost = (envValue('VITE_MALAKA_HOST') || 'malaka.fermi.uz').toLowerCase();
    const onlineHost = (envValue('VITE_ONLINE_HOST') || 'onlinetalim.fermi.uz').toLowerCase();
    if (host === malakaHost || params.get('malaka') === '1') return 'malaka';
    if (host === onlineHost || params.get('online') === '1') return 'online';
    return null;
  } catch {
    return null;
  }
}

let cached: Program | null = null;

/** Portal ichida joriy dastur (aniqlanmasa — online). */
export function currentProgram(): Program {
  if (!cached) cached = detectProgram() || 'online';
  return cached;
}

export type ProgramBrand = {
  title: string;
  subtitle: string;
  /** O'quvchining nomi: 6-kursda — talaba, malakada — tinglovchi. */
  learner: string;
  learners: string;
};

export const BRAND: Record<Program, ProgramBrand> = {
  online: {
    title: "Online ta'lim",
    subtitle: "6-kurs masofaviy ta'lim portali",
    learner: 'Talaba',
    learners: 'Talabalar',
  },
  malaka: {
    title: 'Malaka oshirish',
    subtitle: 'Malaka oshirish va qayta tayyorlash fakulteti',
    learner: 'Tinglovchi',
    learners: 'Tinglovchilar',
  },
};
