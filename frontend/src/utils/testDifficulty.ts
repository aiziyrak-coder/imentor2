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
    // Rektor talabi (2026-10-15): "judayam oson — USMLE 10-11 darajaga
    // o'tkazing, o'sha mavzu bo'yicha bo'lsin". Ya'ni qiyinlik MAVZUNI
    // chuqurlashtirish hisobiga oshadi, boshqa mavzuga o'tish hisobiga emas.
    'DARAJASI: ENG QIYIN — USMLE Step 2 CK ning eng og\'ir savollari darajasi. ' +
    '4 zich jumla (75–110 so\'z): bemor + komorbidlik va dori + 3 topilma + qaror savoli.\n' +
    'MAJBURIY SHARTLAR:\n' +
    '  1) Javob KAMIDA UCHTA ma\'lumotni birga talqin qilgandagina chiqsin ' +
    '(masalan vital + lab + dori ta\'siri). Ikkita faktdan chiqadigan savol bu daraja uchun oson.\n' +
    '  2) Kamida BITTA topilma yo\'nalishni O\'ZGARTIRSIN: usiz javob boshqa bo\'lardi. ' +
    'Izohda shu aniq aytilsin.\n' +
    '  3) Vaqt omili bo\'lsin (necha soat/kun, qachon boshlangani yoki qachongacha ulgurish kerakligi) ' +
    'va u qarorga ta\'sir qilsin.\n' +
    '  4) Distraktorlar — TO\'G\'RI, lekin boshqa vaziyat uchun: har biri shu mavzuning yaqin ' +
    'holatida to\'g\'ri javob bo\'ladigan darajada ishonarli bo\'lsin.\n' +
    '  5) Savol turi: keyingi eng to\'g\'ri qadam; USHBU bemorda nima mumkin emas; qaysi topilma ' +
    'yaqin DDx ni kesadi; dastlabki taktika muvaffaqiyatsiz bo\'lganda nima qilinadi; ' +
    'ikki ko\'rsatkichni birga talqin qilish.\n' +
    '  6) MAVZUDAN CHIQMASIN: ishchi tashxis ham, qaror ham shu mavzuning nozologiyasi doirasida. ' +
    'Qiyinlik mavzuni chuqurlashtirish bilan oshadi, begona mavzu qo\'shish bilan emas.\n' +
    'TAQIQLANADI: "bitta ABG/lab = tashxis"; yolg\'iz "qaysi tashxis ehtimoliy?"; ' +
    'klassik darslik kartinasi; bitta belgidan topiladigan javob.',
};

/**
 * USMLE uslubidagi majburiy talablar (rektor, 2026-10-13: "yanada
 * kuchaytiring").
 *
 * Bu qoidalar `utils/testDepth.ts` da TEKSHIRILADI — bajarilmagan savol
 * olinmaydi va qayta so'raladi. Shuning uchun ular umumiy maslahat emas,
 * aniq shartlar.
 */
export const USMLE_RULES = [
  'SAVIYA (majburiy, tekshiriladi — bajarilmagan savol OLINMAYDI):',
  // Eng muhim mezon: variantlarni yopib qo'yganda ham savol javob beradigan
  // bo'lsin. Eslash savoli bu sinovdan o'tmaydi.
  '1) VARIANTLARNI YOPIB SINOV: variantlar ko\'rinmasa ham mutaxassis savolga javob bera olsin. ' +
    'Ya\'ni savol o\'zi to\'liq vazifa bo\'lsin, variantlardan taxmin qilinadigan emas.',
  '2) Savol QAROR so\'rasin: "keyingi eng to\'g\'ri qadam", "eng ehtimoliy holat", "qaysi mexanizm", ' +
    '"USHBU bemorda nima mumkin emas", "qaysi topilma tashxisni kesadi", "ko\'rsatkich qayerga siljiydi". ' +
    '"Quyidagilardan qaysi biri to\'g\'ri?", "X nima?", "qaysi biri xos?" TAQIQLANADI.',
  '3) INKOR savol TAQIQLANADI ("qaysi biri to\'g\'ri EMAS", "istisno") — u bilimni emas, diqqatni tekshiradi.',
  '4) Vignettada kamida IKKI aniq topilma (raqam+birlik) va VAQT bo\'lsin. "Yuqori", "past", "o\'zgargan" ' +
    'kabi raqamsiz ta\'rif yetarli emas.',
  '5) IKKI BOSQICHLI fikrlash: avval ma\'lumotni izohlash, so\'ng xulosa. Bitta faktni eslash bilan ' +
    'yechiladigan savol TAQIQLANADI.',
  '6) Variantlarda MUTLAQ so\'z bo\'lmasin ("har doim", "hech qachon", "faqat shu").',
  '7) IZOH (explanation) o\'qituvchi darajasida bo\'lsin: to\'g\'ri javob nega to\'g\'ri, va HAR BIR ' +
    'noto\'g\'ri variant nega jalb qiladi hamda nega baribir xato. Faqat to\'g\'ri javobni takrorlagan izoh YAROQSIZ.',
  '8) Fakt kitobdan olinsin: berilgan manbalardagi me\'yor, mezon va raqamlardan foydalaning, o\'ylab topmang.',
].join('\n');

/**
 * Daraja bo'yicha CHUQURLIK talabi — bemorsiz fanlar uchun ham.
 *
 * Klinik tarmoqda bu `LEVEL_RULES` ichida, lekin biomedical va academic
 * tarmoqlar u yerga umuman yetib bormasdi: natijada "qiyin" deb so'ralgan
 * test 24 so'zlik, o'lchovsiz savol bo'lib chiqardi (2026-10-15 o'lchovi).
 */
const DEPTH_BY_LEVEL: Record<TestDifficulty, string> = {
  easy:
    'DARAJASI: OSONROQ, lekin TA\'RIF EMAS — shart + bitta aniq o\'lchov (raqam+birlik) + qaror.',
  medium:
    'DARAJASI: O\'RTA — shart + IKKITA aniq o\'lchov, biri chalg\'ituvchi; javob ikkisini birga talqin qilishdan chiqsin.',
  hard:
    'DARAJASI: ENG QIYIN (USMLE Step 2 CK ning eng og\'ir savollari darajasi). MAJBURIY: ' +
    'savol 45–90 so\'z; ichida KAMIDA UCHTA aniq ma\'lumot (raqam+birlik: konsentratsiya, faollik, ' +
    'harorat, pH, vaqt, foiz, me\'yordan chetlanish); javob shu uchtasini BIRGA talqin qilgandagina chiqsin. ' +
    'Bitta ma\'lumot o\'zgarsa javob ham o\'zgaradigan bo\'lsin va izohda shu aniq aytilsin. ' +
    'Har bir chalg\'ituvchi variant — SHU mavzuning boshqa shartida TO\'G\'RI javob bo\'ladigan darajada ishonarli. ' +
    'Bitta faktni eslash bilan yechiladigan savol va "qaysi biri xos?" TAQIQLANADI.',
};

/**
 * "Qiyin" daraja uchun NAMUNA savol — har tarmoq uchun bittadan.
 *
 * Qoida aytish yetarli emasligi ko'rindi: 2026-10-15 da talablar
 * kuchaytirilgandan keyin ham model 24 so'zlik savol yozardi. Model
 * ko'rsatmadan ko'ra NAMUNAGA aniqroq ergashadi, shuning uchun unga
 * kerakli darajaning aniq ko'rinishi beriladi.
 *
 * Namuna MAVZUSI ataylab neytral: model uni ko'chirmasligi, faqat
 * SHAKLINI va chuqurligini olishi kerak.
 */
const HARD_EXAMPLE: Record<SubjectDomain, string> = {
  clinical:
    'NAMUNA (faqat SHAKL va chuqurlik uchun; mavzusini KO\'CHIRMANG):\n' +
    'Savol: "64 yoshli erkak 8 soat ichida kuchaygan nafas qisilishi bilan keldi. ' +
    'Yurak yetishmovchiligi bo\'yicha furosemid 40 mg va enalapril qabul qiladi. ' +
    'AB 92/58 mm Hg, puls 118 zarb/min, SpO2 86%, kreatinin 2,1 mg/dl (3 oy oldin 1,0), ' +
    'kaliy 5,8 mmol/l, o\'pkada ikki tomonlama xirillash. Bu bemorda keyingi eng to\'g\'ri qadam qaysi?"\n' +
    'Nega bu daraja: javob UCHTA ma\'lumotni birga talqin qilishni talab qiladi (bosim pastligi + ' +
    'kreatinin ikki baravar oshgani + kaliy yuqoriligi); kaliy 5,8 bo\'lmasa javob boshqa bo\'lardi; ' +
    'har bir variant boshqa shartda to\'g\'ri javob bo\'ladi.',
  biomedical:
    'NAMUNA (faqat SHAKL va chuqurlik uchun; mavzusini KO\'CHIRMANG):\n' +
    'Savol: "Jigar gomogenatida glyukoza-6-fosfataza faolligi 0,5 birlik/mg oqsil (me\'yor 2,8–4,2), ' +
    'glyukoza-6-fosfat miqdori 40% ga oshgan, laktat 4,8 mmol/l (me\'yor <2,2), ' +
    'ochlikning 6-soatida qondagi glyukoza 2,6 mmol/l. Bu ko\'rsatkichlar birgalikda qaysi ' +
    'bosqichning buzilishini ko\'rsatadi?"\n' +
    'Nega bu daraja: uchta o\'lchov birga talqin qilinadi (ferment faolligi + substrat to\'planishi + ' +
    'laktat); laktat me\'yorda bo\'lsa javob boshqa bo\'lardi; bemor kartasi yo\'q.',
  academic:
    'NAMUNA (faqat SHAKL va chuqurlik uchun; mavzusini KO\'CHIRMANG):\n' +
    'Savol: "Xonada o\'lchov 3 marta takrorlandi: 420, 465 va 510 lk, talab 500 lk dan kam emas. ' +
    'O\'lchov quyoshli kunning 11:00 va 15:00 oralig\'ida, chiroqlar yoqilgan holda olingan. ' +
    'Shu uch natija asosida qaysi xulosa to\'g\'ri?"\n' +
    'Nega bu daraja: uchta raqam, talab me\'yori va o\'lchov sharti birga hisobga olinadi; ' +
    'bitta natijaga qarab javob berib bo\'lmaydi.',
};

export function buildTestDifficultyPrompt(level: TestDifficulty, domain: SubjectDomain = 'clinical'): string {
  if (domain === 'biomedical') {
    return [
      'SAVOL SIFATI — tibbiy, lekin BEMORSIZ fan (anatomiya, fiziologiya, biokimyo, mikrobiologiya, farmakologiya, gigiyena):',
      'Har savol aniq shart ustida: tuzilma, mexanizm, preparat, o\'lchov yoki me\'yordan chetlanish (raqam+birlik).',
      'Mexanizm, patofiziologiya va laboratoriya talqini O\'RINLI — lekin individual bemor vignette',
      '(«N yoshli bemor murojaat qildi» + shikoyat + tashxis/dori) TAQIQLANADI.',
      'Ta\'rif («X nima?») TAQIQLANADI. 5 variant bir xil turda, to\'g\'ri javob BITTA.',
      '«Hammasi to\'g\'ri» TAQIQLANADI.',
      // Bu tarmoq avval LEVEL_RULES'ni umuman olmasdi, shuning uchun
      // "qiyin" daraja tibbiy-nazariy fanlarda amalda ishlamasdi: jonli
      // tekshiruvda o'rtacha savol 24 so'z va 0,1 o'lchov edi (2026-10-15).
      DEPTH_BY_LEVEL[level],
      level === 'hard' ? HARD_EXAMPLE[domain] : '',
    ].join(' ') + '\n' + USMLE_RULES;
  }
  if (domain === 'academic') {
    return [
      'SAVOL SIFATI — oliy ta\'lim, SHU FAN bo\'yicha, klinik vignette EMAS:',
      'Har savol konkret vazifa: shart + cheklov/raqam/me\'yor + qaror.',
      'Individual bemor vignette (yosh + shikoyat + tashxis/dori) TAQIQLANADI.',
      'Ta\'rif ("X nima?") TAQIQLANADI. 5 variant bir xil turda, to\'g\'ri javob BITTA.',
      '"Hammasi to\'g\'ri" TAQIQLANADI.',
      DEPTH_BY_LEVEL[level],
      level === 'hard' ? HARD_EXAMPLE[domain] : '',
    ].join(' ') + '\n' + USMLE_RULES;
  }
  const example = level === 'hard' ? `\n${HARD_EXAMPLE[domain]}` : '';
  return `${LEVEL_RULES[level]} ${QUALITY_RULES}\n${USMLE_RULES}${example}`;
}

export function testStemInstruction(level: TestDifficulty, domain: SubjectDomain = 'clinical'): string {
  if (domain === 'biomedical') {
    if (level === 'easy') {
      return 'HAR savol 2 qatorlik ilmiy vazifa (30–50 so\'z): tuzilma, mexanizm yoki me\'yor. Bemor hikoyasi yo\'q.';
    }
    return (
      (level === 'hard'
        ? 'HAR savol 45–90 so\'z, 3–4 zich jumla: preparat/namuna/tajriba sharti; KAMIDA UCHTA ' +
          'raqam+birlik bilan topilma (biri chalg\'ituvchi); oxirida qaror savoli. '
        : 'HAR savol 2–3 zich jumla: preparat/namuna/o\'lchov sharti; raqam+birlik bilan topilma; qaror savoli ') +
      '(qaysi mexanizm, qaysi tuzilma, ko\'rsatkich qayerga siljiydi). 5 ta yaqin variant. ' +
      'Individual bemor kartasi YARATILMASIN. ' +
      // Jonli natijada savol ichida "(Source: Robbins..., p. 108)" turardi —
      // bu javobni oshkor qiladi va savolni kitobdan qidirishga aylantiradi.
      'Savol matnida MANBA ko\'rsatilmasin ("(Source: ...)", "(Robbins, p. 108)") — manbalar alohida maydonda.'
    );
  }
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
  if (domain === 'biomedical') {
    return (
      'explanation — 5-7 gap: qaysi mexanizm yoki tuzilma hal qiluvchi; ko\'rsatkich nega shunday o\'zgaradi; ' +
      'distraktor nega xato. Bemor ssenariysi qo\'shilmasin.'
    );
  }
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
