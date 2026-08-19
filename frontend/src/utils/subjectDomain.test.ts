import { describe, expect, it } from 'vitest';
import { resolveSubjectDomain } from './subjectDomain';

describe('resolveSubjectDomain', () => {
  it('informatika / elektronika / matematika — akademik', () => {
    expect(
      resolveSubjectDomain({
        departmentName: "O'zbek va xorijiy tillar",
        subjectName: 'Tibbiyotda axborot texnologiyalari',
      }),
    ).toBe('academic');
    expect(
      resolveSubjectDomain({ subjectName: 'Elektronika asoslari' }),
    ).toBe('academic');
    expect(resolveSubjectDomain({ subjectName: 'Oliy matematika' })).toBe('academic');
  });

  it('klinik fanlar klinik qoladi', () => {
    expect(
      resolveSubjectDomain({
        departmentName: 'Ichki kasalliklar',
        subjectName: 'Propedevtika',
      }),
    ).toBe('clinical');
    expect(resolveSubjectDomain({ subjectName: 'Farmakologiya' })).toBe('clinical');
  });
});
