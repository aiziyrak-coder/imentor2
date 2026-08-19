import type { SubjectDomain } from './subjectDomain';

/** O‘qituvchi testdagi qiyinlik. Default — qiyin (1 qatorlik oson savol emas). */
export type TestDifficulty = 'easy' | 'medium' | 'hard';

export const DEFAULT_TEST_DIFFICULTY: TestDifficulty = 'hard';
export const DEFAULT_TEST_QUESTION_COUNT = 10;

export function isTestDifficulty(value: unknown): value is TestDifficulty {
  return value === 'easy' || value === 'medium' || value === 'hard';
}

export function testDifficultyTemperature(level: TestDifficulty): number {
  if (level === 'easy') return 0.25;
  if (level === 'hard') return 0.38;
  return 0.32;
}

const QUALITY_RULES = [
  'SAVOL SIFATI — OLIY TIBBIY TA\'LIM (6-kurs / KROK / USMLE Step 2 CK), MAKTAB EMAS:',
  'Har savol 3 zich klinik jumla (55–95 so\'z): yosh + asosiy shikoyat;',
  'komorbidlik YOKI hozirgi dori YOKI anamnezdagi muhim fakt;',
  'kamida IKKITA ob\'ektiv topilma (vital/lab/instrumental — raqam + birlik), ulardan BIRI chalg\'ituvchi;',
  'so\'ng BITTA qaror savoli (keyingi qadam / kontrendikatsiya / qaysi topilma tashxisni kesadi).',
  '1–2 qatorlik oson vignette TAQIQLANADI. Ta\'rif ("X nima?", "qaysi belgi xos?") TAQIQLANADI.',
  'TAQIQLANGAN NAMUNA (bunday savol YARATILMASIN): "45 yoshli erkak nafas qisilishi... pH 7.28, PaCO2 60, PaO2 55. Qaysi tashxis ehtimoliy?" —',
  'bu bitta klassik ABG = bitta darslik tashxisi; oliy ta\'lim uchun yaroqsiz.',
  'Yana taqiqlanadi: yolg\'iz lab/ABG/EKG dan darhol tashxis; "ehtimoliy tashxis" 10 savolning hammasi;',
  'shoshilinch yordam ssenariysi mavzuga bog\'lanmagan; oldi-qochdi, bo\'sh so\'zlar.',
  'Har savolda ANIQ bitta to\'g\'ri javob; ikkinchi variant ham to\'g\'ri bo\'lishi mumkin emas.',
  'Stem bitta narsani so\'rasin (tashxis YOKI dori YOKI keyingi qadam — aralashtirmang).',
  '5 ta variant bir xil turda; hammasi SHU MAVZUDAGI yaqin tushuncha (yaqin DDx/dori/tekshiruv).',
  '"Hammasi to\'g\'ri", "hech biri", "A va B" TAQIQLANADI.',
  'To\'g\'ri javob stemdagi IKKITA yoki undan ortiq belgidan mantiqan kelib chiqsin, bitta raqamdan emas.',
  'Uydirma foiz, PMID, "tadqiqotga ko\'ra" YO\'Q. Kitob parchasi bo\'lsa — nozologiya/dori undan.',
].join(' ');

const LEVEL_RULES: Record<TestDifficulty, string> = {
  easy:
    'DARAJASI: OSONROQ, lekin TA\'RIF EMAS. 2–3 qatorlik tipik vignette (yosh + shikoyat + 1 aniq belgi/tahlil). ' +
    'Talaba tipik tashxis yoki birinchi qator davolashni tanlasin. 1 qatorlik "X nima?" TAQIQLANADI.',
  medium:
    'DARAJASI: O\'RTA. 3 qator vignette: asosiy belgi + bitta chalg\'ituvchi topilma, lekin to\'g\'ri javob aniq. ' +
    'Tashxis yoki keyingi qadam. Ta\'rif savoli YO\'Q.',
  hard:
    'DARAJASI: QIYIN — rezidentura/KROK. 3 zich jumla: komorbidlik yoki dori + 2 topilma (biri trap) + qaror. ' +
    'Savol turi: keyingi eng to\'g\'ri qadam, USHBU bemorda qaysi dori mumkin emas, qaysi belgi yaqin DDx ni kesadi, ' +
    'ikki ko\'rsatkichni birga talqin. "Bitta ABG/lab = tashxis" va "qaysi tashxis ehtimoliy?" (yolg\'iz) TAQIQLANADI. ' +
    'To\'g\'ri javob BITTA va aniq; distraktorlar mavzudagi yaqin, lekin stem uchun xato.',
};

export function buildTestDifficultyPrompt(level: TestDifficulty, domain: SubjectDomain = 'clinical'): string {
  if (domain === 'academic') {
    return [
      'SAVOL SIFATI — oliy ta\'lim, SHU FAN bo\'yicha, klinik vignette EMAS:',
      'Har savol konkret vazifa: shart + cheklov/raqam + qaror.',
      'Bemor, kasallik, HbA1c, dori, vital belgi TAQIQLANADI (fan klinik bo\'lmasa).',
      'Ta\'rif ("X nima?") TAQIQLANADI. 5 variant bir xil turda, to\'g\'ri javob BITTA.',
      '"Hammasi to\'g\'ri" TAQIQLANADI.',
    ].join(' ');
  }
  return `${LEVEL_RULES[level]} ${QUALITY_RULES}`;
}

export function testStemInstruction(level: TestDifficulty, domain: SubjectDomain = 'clinical'): string {
  if (domain === 'academic') {
    if (level === 'easy') {
      return 'HAR savol 2 qatorlik fan vazifasi (30–50 so\'z), 5 ta variant. Bemor hikoyasi yo\'q.';
    }
    return (
      'HAR savol 2–3 zich jumla: aniq shart/cheklov; chalg\'ituvchi lekin mantiqiy fakt; qaror savoli. ' +
      '5 ta yaqin variant. Klinik bemor + kasallik YARATILMASIN.'
    );
  }
  if (level === 'easy') {
    return 'HAR savol 2 qatorlik klinik vignette (30–50 so\'z), 5 ta variant. Ta\'rif savoli yo\'q.';
  }
  if (level === 'hard') {
    return (
      'HAR savol 3 zich jumla (55–95 so\'z): yosh+shikoyat; komorbidlik/dori/anamnez; 2 topilma (raqam+birlik, biri trap); ' +
      'oxirida qaror savoli (keyingi qadam / kontrendikatsiya / qaysi topilma kesadi). 5 ta yaqin variant. ' +
      'Klassik ABG=tashxis va 1–2 qatorlik oson savol YARATILMASIN.'
    );
  }
  return 'HAR savol 2–3 qatorlik vignette (40–65 so\'z), 5 ta variant. 1 qatorlik ta\'rif yo\'q.';
}

export function testExplanationInstruction(level: TestDifficulty, domain: SubjectDomain = 'clinical'): string {
  if (domain === 'academic') {
    return (
      'explanation — 5-7 gap: to\'g\'ri javob nima uchun mavzu/ma\'ruzaga mos; ' +
      'qaysi shart hal qiluvchi; distraktor nima uchun xato. Klinik patofiziologiya YOZILMASIN.'
    );
  }
  if (level === 'easy') {
    return (
      'explanation — 3-5 to\'liq gap: to\'g\'ri javob nima va nega; asosiy fakt; ' +
      'distraktor nima uchun xato. Yo\'q ssenariyni o\'ylab topib yozmang.'
    );
  }
  return (
    'explanation — KAMIDA 5, KO\'PI BILAN 7 to\'liq gap (120-170 so\'z): ' +
    '(a) vignettadagi qaysi belgi/tahlil hal qiluvchi va nega; ' +
    '(b) klinik fikrlash: yetakchi sindrom va qaysi belgi boshqa tashxislarni kesib tashlashi; ' +
    '(c) patofiziologiya (mexanizm); ' +
    '(d) tasdiqlovchi tekshiruv va undan kutiladigan aniq natija; ' +
    '(e) keyingi qadam yoki tanlangan dori/usul nima qilishi. ' +
    'Bir-ikki gaplik yoki savolni takrorlaydigan izoh XATO hisoblanadi. ' +
    'Har gapda aniq atama, mexanizm yoki ko\'rsatkich bo\'lsin; "muhim ahamiyatga ega", ' +
    '"e\'tibor berish kerak" kabi bo\'sh (safsata) gaplar TAQIQLANADI.'
  );
}
