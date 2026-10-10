import { describe, expect, it } from 'vitest';
import {
  academicTextHasClinicalLeak,
  isPatientFree,
  patientVignetteLeak,
  resolveSubjectDomain,
} from './subjectDomain';

/**
 * Uch daraja (2026-09-25):
 *   clinical   — bemor yonidagi qaror (institutning 15 ta rasmiy klinik kafedrasi);
 *   biomedical — tibbiy, lekin bemorsiz (anatomiya, fiziologiya, gigiyena…);
 *   academic   — tibbiyotdan tashqari (til, IT, matematika, ijtimoiy fanlar).
 * Noma'lum holat hech qachon "clinical" bo'lmaydi — soxta bemor yaratilmasin.
 */

describe('tibbiyotdan tashqari fanlar', () => {
  it('informatika / elektronika / matematika — akademik', () => {
    expect(
      resolveSubjectDomain({
        departmentName: "O'zbek va xorijiy tillar",
        subjectName: 'Tibbiyotda axborot texnologiyalari',
      }),
    ).toBe('academic');
    expect(resolveSubjectDomain({ subjectName: 'Elektronika asoslari' })).toBe('academic');
    expect(resolveSubjectDomain({ subjectName: 'Oliy matematika' })).toBe('academic');
  });

  it('imlo xatolari va kirill ham akademik', () => {
    expect(resolveSubjectDomain({ subjectName: 'Ahborot texnalogiyalari tibbiyoti' })).toBe('academic');
    expect(resolveSubjectDomain({ subjectName: 'Elektorinika' })).toBe('academic');
    expect(resolveSubjectDomain({ subjectName: 'Ахборот технологиялари' })).toBe('academic');
  });

  it('mavzu elektron pochta — fan nomi bo‘lmasa ham akademik', () => {
    expect(resolveSubjectDomain({ topic: 'Elektron pochta xizmatlari xavfsizligi' })).toBe('academic');
  });

  it('IT fanida "tashxis" so‘zi uchrasa ham bemor chiqmaydi', () => {
    expect(
      resolveSubjectDomain({
        subjectName: 'Axborot texnologiyalari',
        topic: 'Tarmoq nosozligini tashxislash',
      }),
    ).toBe('academic');
  });

  it('gumanitar fanlar akademik', () => {
    expect(resolveSubjectDomain({ subjectName: 'Dinshunoslik' })).toBe('academic');
    expect(resolveSubjectDomain({ subjectName: 'PED Falsafa 1 sm' })).toBe('academic');
    expect(resolveSubjectDomain({ subjectName: 'Tibbiyot', topic: 'Tibbiy etika va deontologiya' })).toBe('academic');
  });

  it('hech narsa ma’lum bo‘lmasa — klinik EMAS', () => {
    expect(resolveSubjectDomain({})).toBe('academic');
    expect(resolveSubjectDomain({ topic: 'Kirish mashg‘uloti' })).toBe('academic');
  });
});

describe('rasmiy klinik kafedralar (institut hujjati)', () => {
  const OFFICIAL = [
    'Umumiy jarrohlik kafedrasi',
    'Fakultet va gospital jarrohlik kafedrasi',
    'Terapiya yo‘nalishidagi fanlar kafedrasi',
    'Nevrologiya va psixiatriya',
    'Ichki kasallalliklar propedevtikasi kafedrasi',
    'Gospital terapiya (laboratoriya) kafedrasi',
    'Pediatriya kafedrasi',
    'Urologiya va onkologiya kafedrasi',
    'Akusherlik va ginekologiya kafedrasi',
    'Stomatologiya va otoloringologiya kafedrasi',
    'Travmatologiya va ortopediya kafedrasi',
    'Dermatovenerologiya va allergologiya kafedrasi',
    'Pediatriya 2 kafedrasi',
    'Endokrinologiya, gemotologiya va ftiziatriya kafedrasi',
    'Epidemiologiya va yuqumli kasalliklar, hamshiralik ishi kafedrasi',
  ];

  it.each(OFFICIAL)('%s — klinik', (departmentName) => {
    expect(resolveSubjectDomain({ departmentName, topic: 'Kasallikning klinik kechishi' })).toBe('clinical');
  });

  it('serverdagi bayroq nom qolipidan ustun', () => {
    expect(
      resolveSubjectDomain({
        departmentName: 'Yangi nomli kafedra',
        departmentIsClinical: true,
        topic: 'Bemorni ko‘rikdan o‘tkazish',
      }),
    ).toBe('clinical');
  });
});

describe('tibbiy, lekin bemorsiz fanlar', () => {
  it('fundamental fanlar biomedical', () => {
    expect(resolveSubjectDomain({ subjectName: 'Farmakologiya' })).toBe('biomedical');
    expect(resolveSubjectDomain({ subjectName: 'Fiziologiya' })).toBe('biomedical');
    expect(resolveSubjectDomain({ subjectName: 'Normal anatomiya' })).toBe('biomedical');
    expect(resolveSubjectDomain({ subjectName: 'Mikrobiologiya' })).toBe('biomedical');
  });

  it('kasallik mavzusi fundamental fanni klinik qilib yubormaydi', () => {
    expect(
      resolveSubjectDomain({
        subjectName: 'Patologik fiziologiya',
        topic: 'Patologik fiziologiya moduliga kirish. Umumiy nozologiya.',
      }),
    ).toBe('biomedical');
    expect(
      resolveSubjectDomain({ subjectName: 'Farmakologiya', topic: 'Dori moddalarning farmakokinetikasi' }),
    ).toBe('biomedical');
  });

  it('klinik kafedradagi nazariy/tashkiliy mavzu bemorsiz yoziladi', () => {
    expect(
      resolveSubjectDomain({
        departmentName: 'Epidemiologiya va yuqumli kasalliklar, hamshiralik ishi kafedrasi',
        topic: 'Hamshiralik ishidagi boshqaruv. Hamshiralik ishini boshqarish ta’rifi.',
      }),
    ).toBe('biomedical');
    expect(
      resolveSubjectDomain({ subjectName: 'Gigiyena', topic: 'Kasalxona xonalari mikroiqlimining gigiyenik ahamiyati' }),
    ).toBe('biomedical');
  });

  it('klinik kafedrada bemor qarori bo‘lgan mavzu klinik qoladi', () => {
    expect(
      resolveSubjectDomain({
        subjectName: 'Onkologiya',
        topic: 'Axoliga onkologik xizmatni tashkil etish. O‘sma kasalliklar tashxisi',
      }),
    ).toBe('clinical');
    expect(
      resolveSubjectDomain({ subjectName: 'Akusherlik', topic: 'Homiladorlik toksikozlari. Davolash taktikasi' }),
    ).toBe('clinical');
  });
});

describe('isPatientFree', () => {
  it('faqat klinik domenda bemor kartasi yoziladi', () => {
    expect(isPatientFree('clinical')).toBe(false);
    expect(isPatientFree('biomedical')).toBe(true);
    expect(isPatientFree('academic')).toBe(true);
  });
});

describe('academicTextHasClinicalLeak', () => {
  it('diabet + HbA1c + yoshli ayol — sizib chiqish', () => {
    expect(
      academicTextHasClinicalLeak(
        "55 yoshli ayolda qandli diabet mavjud bo'lib, HbA1c 9.5%, metformin. Qaysi elektron pochta xizmati mos emas?",
      ),
    ).toBe(true);
  });

  it('oddiy IT savoli — sizib chiqish emas', () => {
    expect(
      academicTextHasClinicalLeak(
        'Talaba SMTP orqali xat yubormoqchi. Qaysi protokol parolni ochiq matnda yuboradi?',
      ),
    ).toBe(false);
  });
});

describe('patientVignetteLeak', () => {
  it('bemorsiz tibbiy matnda atama o‘rinli, bemor vignette esa yo‘q', () => {
    expect(
      patientVignetteLeak('Preparatda mitoxondriyalar soni ortgan, ATF sintezi 40% ga oshgan.'),
    ).toBe(false);
    expect(
      patientVignetteLeak('62 yoshli erkak bemor nafas qisishi bilan murojaat qildi.'),
    ).toBe(true);
  });
});

describe('serverdagi haqiqiy kafedra nomlari (87 ta ro‘yxat tekshirildi)', () => {
  const CASES: Array<[string, string]> = [
    ['Terapiya UASH', 'clinical'],
    ['Yuz-jag‘ jarroxligi', 'clinical'],
    ['Neonatologiya', 'clinical'],
    ['Bolalar xirurgiyasi', 'clinical'],
    ['Ichki kasallilar propedevtikasi', 'clinical'],
    ['Normal anatomiya', 'biomedical'],
    ['Patologik fiziologiya va patologik anatomiya', 'biomedical'],
    ['Tibbiy va biologik kimyo', 'biomedical'],
    ['Mikrobiologiya,virusologiya,immunologiya', 'biomedical'],
    ['Kommunal va mehnat gigiyenasi', 'biomedical'],
    ['Xalq tabobati va farmakologiya kafedrasi', 'biomedical'],
    ['Morfologiya', 'biomedical'],
    ['O‘zbek va xorijiy tillar', 'academic'],
    ['Ijtimoiy fanlar', 'academic'],
    ['Lotin tili', 'academic'],
    ['Biotibbiyot muhandisligi, biofizika va axborot texnologiyalari', 'academic'],
  ];

  it.each(CASES)('%s → %s', (departmentName, expected) => {
    expect(resolveSubjectDomain({ departmentName })).toBe(expected);
  });

  it('anatomiya kafedrasi nomidagi "operativ jarrohlik" uni klinik qilmaydi', () => {
    expect(
      resolveSubjectDomain({
        departmentName: 'Normal anatomiya, operativ jarrohlik va topografik anatomiya kafedrasi',
        topic: 'Qorin bo‘shlig‘i a’zolari',
      }),
    ).toBe('biomedical');
  });
});

/**
 * "Xalq tabobati va farmakologiya" kafedrasi (2026-10-05).
 *
 * Kafedra aytdi: bu yerda FAQAT "Klinik farmakologiya" klinik, qolgan hamma
 * fan klinik emas. Ilgari mavzudagi "davolash" yoki "retsept" so'zi oddiy
 * farmakologiyani ham bemor kartasiga aylantirib yuborardi.
 */
describe('Xalq tabobati va farmakologiya kafedrasi', () => {
  const dept = { departmentName: 'Xalq tabobati va Farmakologiya', departmentIsClinical: false };

  it('oddiy farmakologiya — davolash haqidagi mavzuda ham bemor kartasi YO‘Q', () => {
    expect(
      resolveSubjectDomain({
        ...dept,
        subjectName: 'Farmakologiya 5-s DI',
        topic: 'Arterial gipertenziyani davolashda qo‘llaniladigan dori vositalari',
      }),
    ).toBe('biomedical');
  });

  it('retsept va doza mavzusi ham klinik emas', () => {
    expect(
      resolveSubjectDomain({
        ...dept,
        subjectName: 'Farmakologiya 3-s OHI',
        topic: 'Retsept yozish qoidalari va dori dozalarini hisoblash',
      }),
    ).toBe('biomedical');
  });

  it('kasallik nomi bor mavzu ham klinik emas', () => {
    expect(
      resolveSubjectDomain({
        ...dept,
        subjectName: 'Farmakologiya 6-s DI',
        topic: 'Yurak yetishmovchiligida qo‘llaniladigan dori moddalar',
      }),
    ).toBe('biomedical');
  });

  it('xalq tabobati mavzulari ham klinik emas', () => {
    expect(
      resolveSubjectDomain({
        ...dept,
        subjectName: 'Xalq tabobati asoslari',
        topic: 'Shifobaxsh o‘simliklardan tayyorlanadigan damlamalar',
      }),
    ).not.toBe('clinical');
  });

  it('"Klinik farmakologiya" esa KLINIK bo‘lib qoladi', () => {
    expect(
      resolveSubjectDomain({
        ...dept,
        subjectName: 'Klinik farmakologiya 9-s DI',
        topic: 'Antibiotiklarni tanlash va davolash taktikasi',
      }),
    ).toBe('clinical');
    expect(
      resolveSubjectDomain({
        ...dept,
        subjectName: 'Klinika farmakologiya 10-s DI',
        topic: 'Bemorga dori tanlash',
      }),
    ).toBe('clinical');
  });

  it('rasmiy klinik kafedra ilgarigidek klinik', () => {
    expect(
      resolveSubjectDomain({
        departmentName: 'Pediatriya kafedrasi',
        departmentIsClinical: true,
        subjectName: 'Pediatriya 9-s',
        topic: 'Bronxial astmani davolash',
      }),
    ).toBe('clinical');
  });
});
