import { DEFAULT_TEST_DIFFICULTY, type TestDifficulty } from './testDifficulty';
import type { SubjectDomain } from './subjectDomain';

type CaseLike = { questions: Array<{ scenario?: string }> };
type TestLike = { questions: Array<{ question?: string }> };

export type CaseStudyFocus = 'profilaktika' | 'davolash' | 'tashxis';

/**
 * Keys savollarining tartibi — KLINIK MANTIQ bo'yicha:
 * avval TASHXIS qo'yiladi, so'ng DAVOLASH tayinlanadi, oxirida PROFILAKTIKA.
 *
 * Bu tartib ham generatsiyada, ham ekranda ishlatiladi (`sortCaseQuestionsByFocus`).
 */
export const CASE_STUDY_FOCUS_ORDER: readonly CaseStudyFocus[] = ['tashxis', 'davolash', 'profilaktika'] as const;

function pickRandom<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  while (picked.length < count && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

export function generationNonce(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildCaseStructurePrompt(topic: string, domain: SubjectDomain = 'clinical'): string {
  const themes = topicSubThemes(topic);
  const themeBlock =
    themes.length > 1
      ? `MAVZU BO'LIMLARI: ${themes.map((s, i) => `${i + 1}) ${s}`).join('; ')}. ` +
        'Har keys shu bo\'limlardan BIRIGA chuqur bog\'lansin, mavzudan tashqariga CHIQMASIN.'
      : '';
  if (domain === 'academic') {
    return [
      `Variatsiya ID: ${generationNonce()}.`,
      `Mavzu: "${topic}".`,
      themeBlock,
      'Aniq 3 ta AMALIY VAZIYATLI MASALA — fan/mavzu bo\'yicha, KLINIK BEMOR KARTASI EMAS:',
      '1-keys focus="profilaktika": xatolik, xavfsizlik yoki standartni buzmaslik qarori.',
      '2-keys focus="davolash": aniq yechim/usul tanlash (ikki yaqin variant, biri mos emas).',
      '3-keys focus="tashxis": ildiz sabab / to\'g\'ri model / qaysi tushuncha mos keladi.',
      'Qaror AYNAN shu fan va mavzuga tegishli. Kasallik, dori, lab, vital belgi YO\'Q (fan klinik bo\'lmasa).',
      'TAQIQLANGAN NAMUNA: 55 yoshli ayol, diabet, HbA1c 9.5%, metformin, elektron pochta xizmati qaysi xavfsiz emas. ' +
        'Bu informatika/elektronika mavzusini sun\'iy ravishda klinik qiladi — YARATILMASIN.',
    ]
      .filter(Boolean)
      .join(' ');
  }
  return [
    `Variatsiya ID: ${generationNonce()}.`,
    `Mavzu: "${topic}".`,
    themeBlock,
    'Aniq 3 ta VAZIYATLI MASALA — har biri BOSHQA klinik qaror, lekin UCHALASI HAM shu mavzu nozologiyasiga oid:',
    '1-keys focus="profilaktika": skrining/profilaktika qarori oson emas (raqobatdosh xavf, kontrendikatsiya, o\'tkazib yuborilgan skrining).',
    '2-keys focus="davolash": dori/taktika tanlash ikkilamchi (komorbidlik, interaksiya, birinchi qator muvaffaqiyatsiz).',
    '3-keys focus="tashxis": atipik yoki o\'xshash sindromlar — talaba differensial qilishi shart.',
    'Ishchi tashxis VA asosiy qaror MAVZUGA kiradigan kasallik/holat bo\'lsin. Mavzuga kirmaydigan tashxis faqat differensialdagi rad etiladigan variant.',
    'Darslikdagi "tipik oson" klassik keysni takrorlamang.',
    'TAQIQLANGAN NAMUNA (bunday keys YARATILMASIN): keksa erkak, 3 kun pastki qorin og\'rig\'i, ' +
      'leykotsit 12 000, CRP 12, o\'t pufagi olingan, tashxis appenditsit, keyingi qadam UTT + qon ekilmasi, ' +
      'seftriakson 1 g. Bu maktab darajasi: kam ma\'lumot, oson DDx, noto\'g\'ri/yuzaki taktika.',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Keys sifati: zich klinik karta, qiyin vaziyatli masala.
 * Mutaxassis: kam ma'lumot, oson tashxis, yuzaki yechim — shuni tuzatadi.
 */
export function buildCaseClinicalRules(domain: SubjectDomain = 'clinical'): string {
  if (domain === 'academic') {
    return [
      'QATTIQ QOIDALAR — oliy ta\'lim AMALIY vaziyat, klinik keys EMAS:',
      'MAVZUGA BOG\'LIQLIK: muammo, ma\'lumotlar va yechim AYNAN fan va mavzu (va ma\'ruza, bo\'lsa) doirasida.',
      'BEMOR YO\'Q: yosh+jins+kasallik+dori vignette TAQIQLANADI. HbA1c, qon bosimi, puls, qorin og\'rig\'i, appenditsit YO\'Q.',
      'Ishtirokchi: talaba, muhandis, o\'qituvchi, tizim administratori — kasalliksiz.',
      'QIYINLIK: bitta ta\'rif = javob EMAS. Kamida ikkita chalg\'ituvchi, lekin mantiqiy cheklov (standart, formula, protokol).',
      'Yechimda aniq qadam, formula, sozlama yoki qoida; nima uchun muqobil noto\'g\'ri.',
      'HAJM: vaziyat 520–720 so\'z, yechim 700–920 so\'z. Har maydon 4–8 dens gap.',
    ].join(' ');
  }
  return [
    'QATTIQ QOIDALAR — oliy tibbiy ta\'lim (KROK / rezidentura) vaziyatli masala, MAKTAB EMAS:',
    'MAVZUGA BOG\'LIQLIK: shikoyat, topilmalar, ishchi tashxis va asosiy qaror AYNAN berilgan mavzu doirasida.',
    'MA\'LUMOT ZICH: har maydonda qaror uchun yetarli fakt. "Kam lab + 2 gap shikoyat" TAQIQLANADI.',
    'QIYINLIK: klassik bir belgi = bir tashxis YO\'Q. Kamida IKKITA chalg\'ituvchi, lekin ishonchli topilma',
    '(komorbidlik, dori+doza, atipik belgi, raqobatdosh lab yoki noaniq vizualizatsiya).',
    'Yengil "oson kasallik" va darslik appenditsit/pnevmoniya/gipertoniya klassikasi YO\'Q.',
    'OLDI-QOCHDI YO\'Q: ob-havo, oilaviy roman, "haftasiga 3 marta yuradi", "muhim ahamiyatga ega" TAQIQLANADI.',
    'Hayot tarzi FAQAT qarorni o\'zgartiradigan fakt (chekish+yara, alkogol+metronidazol, kasb ta\'siri, jinsiy/epidemiologik xavf).',
    'Vaziyat tashxisni OCHIQ aytmasin. Yechimda aniq nozologiya, mezon, dori, doza, nima uchun muqobil emas.',
    'Yechimda yuzaki mantiq TAQIQLANADI (masalan "CRP 12 = divertikulit yo\'q", "o\'t pufagi yo\'q = appenditsit").',
    'HAJM (zich klinik karta, suv emas):',
    'Vaziyat jami 520–720 so\'z. Yechim jami 700–920 so\'z.',
    'Har maydon 4–8 dens klinik gap: raqam+birlik, vaqt (soat/kun), dori+doza.',
  ].join(' ');
}

const TEST_ANGLES = [
  'diagnostika va differensial tashxis',
  'davolash strategiyasi tanlash',
  'laboratoriya va vizualizatsiya talqin qilish',
  'dori-darmonlar va kontrendikatsiyalar',
  'klinik yo\'riqnoma va protokol qo\'llash',
  'favqulodda yordam va triyaj',
  'prognostik omillar va asoratlar',
  'profilaktika va skrining',
  'patiens xavfsizligi va xatolarni oldini olish',
  'etika va bemor huquqlari',
];

/**
 * Mavzu sarlavhasini bo'limlarga ajratadi.
 *
 * Sillabus mavzulari odatda bir nechta mustaqil bo'limdan iborat bo'ladi
 * ("Piodermiyalar. Dermatozoonozlar. Ter va yog' bezlari. Zamburug' kasallik.").
 * Ularni ochiq ro'yxat qilib berish model savollarni shu bo'limlar bo'ylab
 * taqsimlashiga yordam beradi — aks holda u bitta bo'limga yopishib qoladi
 * yoki umuman mavzudan chiqib ketadi.
 */
export function topicSubThemes(topic: string): string[] {
  return (topic || '')
    .split(/[.;]\s+|\.$/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2)
    .slice(0, 8);
}

const TEST_HARD_ANGLES = [
  'ikki yaqin DDx: qaysi topilma birini kesib tashlaydi (yolg\'iz "ehtimoliy tashxis" emas)',
  'keyingi eng to\'g\'ri qadam — tekshiruv YOKI davolash, komorbidlik hisobga olingan',
  'USHBU bemorda qaysi dori kontrendikatsiya / interaksiya / doza o\'zgarishi',
  'ikki lab/instrumental qiymatni BIRGA talqin (bitta ABG dan tashxis YO\'Q)',
  'asorat: qaysi belgi darhol aralashuvni talab qiladi',
  'nima uchun birinchi qator dori/usul USHBU bemorga mos emas',
];

const TEST_ACADEMIC_ANGLES = [
  'tushunchani konkret vazifaga qo\'llash (ta\'rif savoli emas)',
  'ikki yaqin usul/formula/protokoldan qaysi biri USHBU shartga mos',
  'xatolik sababini topish (hisob, sozlama, mantiq)',
  'keyingi to\'g\'ri qadam (tekshirish, hisoblash, xavfsizlik qoidasi)',
  'nima uchun muqobil yechim ushbu cheklovda ishlamaydi',
  'ma\'ruzadagi qoida/standartni raqamli misolga qo\'llash',
];

const TEST_ACADEMIC_EASY = [
  'asosiy tushunchani misolda tanlash',
  'to\'g\'ri formula yoki qoidani tanlash',
  'xavfsizlik yoki standartning oddiy qo\'llanishi',
];

export function buildTestVarietyPrompt(
  topic: string,
  count: number,
  difficulty: TestDifficulty = DEFAULT_TEST_DIFFICULTY,
  domain: SubjectDomain = 'clinical',
): string {
  const anglePool =
    domain === 'academic'
      ? difficulty === 'easy'
        ? TEST_ACADEMIC_EASY
        : TEST_ACADEMIC_ANGLES
      : difficulty === 'easy'
        ? TEST_ANGLES.filter(
            (a) =>
              a.includes('diagnostika') ||
              a.includes('dori-darmon') ||
              a.includes('laboratoriya'),
          )
        : difficulty === 'hard'
          ? TEST_HARD_ANGLES
          : TEST_ANGLES.filter((a) => !a.includes('etika'));
  const angleCount = difficulty === 'hard' ? 4 : 3;
  const angles = pickRandom(anglePool.length ? anglePool : TEST_ACADEMIC_ANGLES, angleCount);
  const themes = topicSubThemes(topic);
  const themeBlock =
    themes.length > 1
      ? `MAVZU BO'LIMLARI: ${themes.map((s, i) => `${i + 1}) ${s}`).join('; ')}. ` +
        'Savollarni shu bo\'limlar bo\'ylab taqsimlang — har bo\'limdan kamida bittadan. Mavzudan CHIQMANG.'
      : '';
  if (domain === 'academic') {
    return [
      `Variatsiya ID: ${generationNonce()}.`,
      `Mavzu: "${topic}". ${count} ta NOYOB test savoli.`,
      themeBlock,
      'HAR SAVOL 2–3 zich jumla: aniq shart (raqam/cheklov/standart) + qaror. Ta\'rif ("X nima?") TAQIQLANADI.',
      'KLINIK BEMOR YO\'Q: diabet, HbA1c, metformin, qon bosimi, yoshli bemor + kasallik vignette YARATILMASIN.',
      'TAQIQLANGAN NAMUNA: "55 yoshli ayol, qandli diabet, yangi elektron pochta, HbA1c 9.5%, metformin. Qaysi xizmat xavfsiz emas?" —',
      'bu informatika savolini sun\'iy klinik qiladi, mantiqsiz.',
      'QAT\'IY: to\'g\'ri javob shu FAN va MAVZU (va ma\'ruza) tushunchasi bo\'lsin. Boshqa fan aralashtirilmasin.',
      'To\'g\'ri javoblar takrorlanmasin. Avvalgi savollarni nusxalamang.',
      `Savol uslublari: ${angles.join('; ')}.`,
      'To\'g\'ri javoblar A–E bo\'ylab teng taqsimlansin.',
    ]
      .filter(Boolean)
      .join(' ');
  }
  return [
    `Variatsiya ID: ${generationNonce()}.`,
    `Mavzu: "${topic}". ${count} ta NOYOB test savoli.`,
    themeBlock,
    'HAR SAVOL 3 ZICH JUMLA (55–95 so\'z). 1–2 qatorlik oson / ta\'rif / "ABG=tashxis" TAQIQLANADI.',
    'OLIY TA\'LIM: maktab savoli, oldi-qochdi, yolg\'iz "qaysi tashxis ehtimoliy?" YO\'Q. ' +
      'Har savolda komorbidlik yoki dori + chalg\'ituvchi topilma + qaror (keyingi qadam/kontrendikatsiya).',
    'QAT\'IY QOIDA: har savolning TO\'G\'RI JAVOBI shu mavzuga kiradigan kasallik/holat/dori bo\'lsin. ' +
      'Mavzuga kirmaydigan tashxis faqat DISTRAKTOR sifatida, hech qachon to\'g\'ri javob bo\'lmasin. ' +
      'Stemdagi bemor ham shu mavzu kasalligi bilan kelgan bo\'lsin.',
    'To\'g\'ri javoblar takrorlanmasin — har savolda boshqa tashxis/dori/qadam to\'g\'ri bo\'lsin.',
    'Avvalgi generatsiyalardagi savollarni qayta ishlatmang — yangi klinik ssenariyalar yozing.',
    `Savol uslublari (mavzu doirasida, eslab qolish emas — qo'llash): ${angles.join('; ')}.`,
    'To\'g\'ri javoblar A–E variantlari bo\'ylab teng taqsimlansin (faqat bir xil harfda emas).',
    'Har savolda boshqa yosh, shikoyat va lab/vital topilma bo\'lsin.',
  ]
    .filter(Boolean)
    .join(' ');
}

export function summarizeCaseForAvoid(session: CaseLike): string {
  return session.questions
    .map((q, i) => `${i + 1}) ${(q.scenario || '').replace(/\s+/g, ' ').trim().slice(0, 140)}`)
    .join(' | ');
}

export function summarizeTestForAvoid(session: TestLike): string {
  return session.questions
    .map((q, i) => `${i + 1}) ${(q.question || '').replace(/\s+/g, ' ').trim().slice(0, 120)}`)
    .join(' | ');
}

export function buildAvoidRepeatsBlock(summaries: string[]): string {
  const limited = summaries.filter(Boolean).slice(0, 6);
  if (!limited.length) return '';
  return [
    '',
    'OLDIN YARATILGAN (QAYTA ISHLATMANG — yangi klinik holatlar/savollar yozing):',
    ...limited.map((s, i) => `- Oldingi ${i + 1}: ${s}`),
  ].join('\n');
}

export function parseKeywordsInput(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function buildCaseKeywordsFocusPrompt(keywords: string[]): string {
  if (!keywords.length) return '';
  return [
    '',
    `ASOSIY FOKUS KALIT SO'ZLAR (har bir keys kamida bitta kalit so'zni chuqur qamrab olsin): ${keywords.join(', ')}.`,
    'Kalit so\'zlar mavzu doirasida ishlatilsin — mavzudan tashqariga olib chiqmasin.',
  ].join('\n');
}

export const GENERATION_UNIQUENESS_RULE =
  'Har generatsiya noyob bo\'lsin: bir xil ssenariy, savol matni yoki klassik darslik misolini takrorlamang.';
