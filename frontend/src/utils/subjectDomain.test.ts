import { describe, expect, it } from 'vitest';
import {
  academicTextHasClinicalLeak,
  resolveSubjectDomain,
} from './subjectDomain';

describe('resolveSubjectDomain', () => {
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
    expect(
      resolveSubjectDomain({ subjectName: 'Ahborot texnalogiyalari tibbiyoti' }),
    ).toBe('academic');
    expect(resolveSubjectDomain({ subjectName: 'Elektorinika' })).toBe('academic');
    expect(
      resolveSubjectDomain({ subjectName: 'Ахборот технологиялари' }),
    ).toBe('academic');
  });

  it('mavzu elektron pochta — fan nomi bo‘lmasa ham akademik', () => {
    expect(
      resolveSubjectDomain({ topic: 'Elektron pochta xizmatlari xavfsizligi' }),
    ).toBe('academic');
  });

  it('klinik fanlar klinik qoladi', () => {
    expect(
      resolveSubjectDomain({
        departmentName: 'Ichki kasalliklar',
        subjectName: 'Propedevtika',
      }),
    ).toBe('clinical');
    expect(resolveSubjectDomain({ subjectName: 'Farmakologiya' })).toBe('clinical');
    expect(resolveSubjectDomain({ subjectName: 'Fiziologiya' })).toBe('clinical');
    expect(
      resolveSubjectDomain({
        subjectName: 'Ichki kasalliklar',
        topic: 'Elektron pochta',
      }),
    ).toBe('clinical');
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
        "Talaba SMTP orqali xat yubormoqchi. Qaysi protokol parolni ochiq matnda yuboradi?",
      ),
    ).toBe(false);
  });
});
