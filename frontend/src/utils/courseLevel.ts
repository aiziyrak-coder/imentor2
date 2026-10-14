/**
 * Fan nomidan KURS darajasini aniqlash (rektor shikoyati, 2026-10-13).
 *
 * Shikoyat: "1-kurslar uchun 3-4 kurslarning savolini bermoqda".
 *
 * Sabab: generatsiya faqat mavzu va fan nomini biladi, kurs darajasi hech
 * qayerda ishlatilmasdi. Sillabusda alohida maydon yo'q, lekin fan nomining
 * o'zida semestr yoki kurs yozilgan: "Fizika 1-s BM", "Akusher ginekologiya
 * 8-s DI", "2 kurs Kalendar dastur". Jonli ma'lumotda 735 fandan 75% shu
 * yo'l bilan aniqlanadi; qolganida daraja qo'yilmaydi (avvalgidek).
 */

export type CourseLevel = {
  /** 1–12. Aniqlangan bo'lsa. */
  semester?: number;
  /** 1–6. Semestrdan hisoblanadi: 1–2 semestr = 1-kurs. */
  course: number;
};

const KURS = /(\d)\s*-?\s*kurs/i;
//: "1-s", "3-sem", "9 semestr", "7th- semestr", "3rd Semester"
const SEM_UZ = /(\d{1,2})\s*-?\s*s(?:em|emestr)?\b/i;
//: "3rd Semester", "7th- semestr" — tartib qo'shimchasi va chiziqcha bilan.
const SEM_EN = /(\d{1,2})\s*(?:st|nd|rd|th)?\s*-?\s*semes(?:tr|ter)/i;

/** Fan nomidan kurs darajasi. Aniqlanmasa — null. */
export function parseCourseLevel(subjectName: string): CourseLevel | null {
  const name = (subjectName || '').trim();
  if (!name) return null;

  const kurs = KURS.exec(name);
  if (kurs) {
    const course = Number(kurs[1]);
    if (course >= 1 && course <= 6) return { course };
  }
  const sem = SEM_EN.exec(name) || SEM_UZ.exec(name);
  if (sem) {
    const semester = Number(sem[1]);
    if (semester >= 1 && semester <= 12) {
      return { semester, course: Math.ceil(semester / 2) };
    }
  }
  return null;
}

/**
 * Promptga qo'shiladigan daraja qoidasi.
 *
 * Qiyinlik PASAYTIRILMAYDI — faqat savol turi kursga mos bo'ladi: 1–2 kursda
 * talaba hali bemorni davolamagan, shuning uchun dori tanlash yoki taktika
 * savoli o'rinsiz; o'rniga mexanizm, tuzilma va me'yor bo'yicha chuqur savol
 * beriladi.
 */
export function courseLevelPrompt(level: CourseLevel | null): string {
  if (!level) return '';
  const where = level.semester
    ? `${level.course}-kurs (${level.semester}-semestr)`
    : `${level.course}-kurs`;
  if (level.course <= 2) {
    return (
      `KURS DARAJASI: ${where} — nazariy bosqich. Talaba hali klinikada ishlamagan. ` +
      'Shuning uchun DORI TANLASH, davolash taktikasi, doza, "keyingi qadam" va ' +
      'bemorni boshqarish savollari TAQIQLANADI. Savollar tuzilma, mexanizm, ' +
      'normal va buzilgan funksiya, laboratoriya me\'yori va uni izohlash ustida bo\'lsin. ' +
      'Qiyinlik PASAYTIRILMAYDI: savol ikki bosqichli fikrlash talab qilsin ' +
      '(ma\'lumotni izohlash, so\'ng xulosa), lekin klinik tajriba talab qilmasin.'
    );
  }
  if (level.course === 3) {
    return (
      `KURS DARAJASI: ${where} — klinikaga o'tish bosqichi. Tashxis va differensial ` +
      'tashxis savollari O\'RINLI; murakkab davolash rejimi, kam uchraydigan dori ' +
      'interaksiyasi va rezident darajasidagi taktika SO\'RALMASIN.'
    );
  }
  return (
    `KURS DARAJASI: ${where} — klinik bosqich. To'liq klinik qaror o'rinli: ` +
    'tashxis, differensial, keyingi qadam, dori va doza, kontrendikatsiya, asorat. ' +
    'Savol darajasi USMLE Step 2 CK / rezidentura imtihoni bilan bir xil bo\'lsin.'
  );
}

/** Qisqa yorliq — jurnal va xabarlar uchun. */
export function courseLevelLabel(level: CourseLevel | null): string {
  if (!level) return '';
  return level.semester ? `${level.course}-kurs/${level.semester}-sem` : `${level.course}-kurs`;
}
