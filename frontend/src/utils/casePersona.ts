/**
 * Klinik keys bemorini KOD tanlaydi (2026-10-20).
 *
 * Prod tahlili (400 ta oxirgi keys, gpt-4.1-nano): har fokusning bemori
 * mavzudan qat'i nazar bir xil edi — tashxisda doim 68 yoshli "Qodir",
 * davolashda 47 yoshli erkak muhandis, profilaktikada 28 yoshli ayol.
 * Natijada ginekologiya keysida "47 yoshli erkak, qindan ajralma" chiqdi.
 * Promptdagi "Qodir'dan qoching" ro'yxati esa aynan shu ismni ko'paytirdi
 * (67 marta). Endi ism, yosh va jins mavzuga qarab tasodifiy tanlanadi va
 * modelga tayyor holda beriladi.
 */
import type { CaseStudyFocus } from './generationVariety';

export type CasePersona = { name: string; age: number; sex: 'female' | 'male' };

const FEMALE_NAMES = [
  'Dilfuza', 'Mohira', 'Zarina', 'Feruza', 'Sevara', 'Robiya', 'Muhabbat', 'Nodira', 'Lobar', 'Kamola',
  'Dildora', 'Barno', 'Hilola', 'Saodat', 'Yulduz', 'Zulfiya', 'Munisa', 'Charos', 'Oydin', 'Mahliyo',
];
const MALE_NAMES = [
  'Jasur', 'Sardor', 'Farhod', 'Rustam', 'Elyor', 'Javlon', 'Ulug\'bek', 'Akmal', 'Botir', 'Sanjar',
  'Behruz', 'Doniyor', 'Azamat', 'Mirzo', 'Ravshan', 'Hasan', 'Tohir', 'Zafar', 'Asror', 'Islom',
];
const GIRL_NAMES = ['Mohinur', 'Sabina', 'Asal', 'Durdona', 'Imona', 'Robiya', 'Shahzoda', 'Iroda'];
const BOY_NAMES = ['Muhammadali', 'Abdulloh', 'Sarvar', 'Diyorbek', 'Temur', 'Samandar', 'Ibrohim', 'Jahongir'];

const FEMALE_SCOPE_RE =
  /akusher|ginekolog|homilador|tug['‘’ʻʼ]?ruq|bachadon|tuxumdon|hayz|qin\b|vulva|sut\s*bez|mammolog|ayollar|preeklamps|eklamps|endometr|menopauza|акушер|гинеколог|беремен|матк|яичник|менстру|obstetr|gyn[ae]?colog|pregnan|uter|ovar|menstru/i;
const MALE_SCOPE_RE =
  /prostat|moyak|erkaklar\s*jinsiy|androlog|предстат|яичк|андролог|testic|androlog/i;
const CHILD_SCOPE_RE =
  /bola|chaqaloq|neonat|yangi\s*tug['‘’ʻʼ]?ilgan|pediatr(?!iya\s+ishi)|o['‘’ʻʼ]?smir|go['‘’ʻʼ]?dak|детск|ребен|новорожд|неонат|педиатр|child|infant|neonat|paediatr|pediatric/i;

/**
 * Fan nomi ko'pincha yo'nalish bilan boshlanadi: "Pediatriya 2024-2025 (Milliy)
 * 5-semestr Ichki kasalliklar propedevtikasi". Bemor yoshi yo'nalishdan emas,
 * fanning o'zidan aniqlanadi — "semestr" gacha bo'lgan qism olib tashlanadi.
 */
function subjectWithoutProgram(subject: string): string {
  return (subject || '').replace(/^.*?\d+\s*-?\s*(?:semestr|семестр|semester)\s*/i, '');
}

function pick<T>(items: readonly T[], rnd: () => number): T {
  return items[Math.floor(rnd() * items.length) % items.length];
}

function between(lo: number, hi: number, rnd: () => number): number {
  return lo + Math.floor(rnd() * (hi - lo + 1));
}

/** Fokusga mos yosh oralig'i (kattalar uchun). */
const ADULT_AGES: Record<CaseStudyFocus, [number, number]> = {
  tashxis: [52, 78],
  davolash: [36, 62],
  profilaktika: [19, 45],
};

/**
 * Mavzuga mos bemor. `rnd` — sinovlar uchun almashtiriladi.
 *
 * Ayollar mavzusi (ginekologiya, akusherlik) — faqat ayol; homiladorlik
 * mavzusida yosh 19–41. Erkaklar mavzusi — faqat erkak. Bolalar mavzusi —
 * fokusga qarab chaqaloq, kichik yoki katta yoshdagi bola.
 */
export function pickCasePersona(
  focus: CaseStudyFocus,
  topic: string,
  subjectName = '',
  rnd: () => number = Math.random,
): CasePersona {
  const text = `${topic || ''} ${subjectWithoutProgram(subjectName)}`;
  const female = FEMALE_SCOPE_RE.test(text);
  const male = !female && MALE_SCOPE_RE.test(text);
  if (CHILD_SCOPE_RE.test(text)) {
    const sex = female ? 'female' : male ? 'male' : rnd() < 0.5 ? 'female' : 'male';
    const age = focus === 'tashxis' ? between(1, 6, rnd) : focus === 'davolash' ? between(7, 12, rnd) : between(13, 17, rnd);
    return { name: pick(sex === 'female' ? GIRL_NAMES : BOY_NAMES, rnd), age, sex };
  }
  const sex = female ? 'female' : male ? 'male' : rnd() < 0.5 ? 'female' : 'male';
  let [lo, hi] = ADULT_AGES[focus];
  // Sinov (2026-10-20): bepushtlik va rivojlanish nuqsoni keysida 60–77 yoshli bemor chiqdi.
  if (/homilador|tug['‘’ʻʼ]?ruq|preeklamps|eklamps|bepusht|infertil|rivojlanish\s+nuqson|hayz|беремен|бесплод|pregnan/i.test(text)) {
    [lo, hi] = [19, 41];
  } else if (female && /menopauza|klimakter|климакс|menopaus/i.test(text)) {
    [lo, hi] = [45, 62];
  }
  return { name: pick(sex === 'female' ? FEMALE_NAMES : MALE_NAMES, rnd), age: between(lo, hi, rnd), sex };
}

/** Promptga beriladigan qator. */
export function casePersonaLine(p: CasePersona): string {
  const sex = p.sex === 'female' ? 'ayol' : 'erkak';
  const kid = p.age < 18 ? (p.sex === 'female' ? 'qiz bola' : 'o\'g\'il bola') : sex;
  return (
    // 2026-10-20 sinovida "Ism, yosh va jins mosligi saqlangan holda" degan
    // ko'rsatma so'zma-so'z vaziyatga tushdi — qator ko'rsatma ekani aniq aytiladi.
    `BEMOR: ${p.name}, ${p.age} yosh, ${kid}. Kasbi shu yoshga va mavzuga mos bo'lsin. ` +
    '(Bu qavs ichidagi gap faqat siz uchun ko\'rsatma, matnga yozilmaydi: ism, yosh va jins hamma bo\'limda bir xil.)'
  );
}
