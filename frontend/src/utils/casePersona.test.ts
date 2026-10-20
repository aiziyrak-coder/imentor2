import { describe, expect, it } from 'vitest';
import { casePersonaLine, pickCasePersona } from './casePersona';

const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

describe('pickCasePersona', () => {
  it('ginekologiya mavzusida faqat ayol bemor', () => {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const p = pickCasePersona('davolash', 'Ayollar jinsiy a’zolarining rivojlanish nuqsonlari', 'Akusherlik va ginekologiya', seq(r));
      expect(p.sex).toBe('female');
    }
  });

  it('homiladorlikda tug‘ish yoshi', () => {
    const p = pickCasePersona('tashxis', 'Homiladorlikda preeklampsiya', '', seq(0.99));
    expect(p.age).toBeLessThanOrEqual(41);
    expect(p.age).toBeGreaterThanOrEqual(19);
  });

  it('prostata mavzusida erkak', () => {
    expect(pickCasePersona('profilaktika', 'Prostata bezi giperplaziyasi', 'Urologiya', seq(0.1)).sex).toBe('male');
  });

  it('bolalar fanida bola, lekin "Pediatriya" yo‘nalishidagi kattalar fanida emas', () => {
    expect(pickCasePersona('tashxis', 'Bolalarda o‘tkir pnevmoniya', 'Pediatriya', seq(0.5)).age).toBeLessThan(18);
    const adult = pickCasePersona(
      'tashxis',
      'O‘pkani eshitish (auskultatsiya)',
      'Pediatriya 2024-2025 (Milliy) 5-semestr Ichki kasalliklar propedevtikasi',
      seq(0.5),
    );
    expect(adult.age).toBeGreaterThanOrEqual(18);
  });

  it('har chaqiruvda boshqa ism va yosh bo‘lishi mumkin', () => {
    const a = pickCasePersona('tashxis', 'Miokard infarkti', '', seq(0.05));
    const b = pickCasePersona('tashxis', 'Miokard infarkti', '', seq(0.95));
    expect(`${a.name}${a.age}`).not.toBe(`${b.name}${b.age}`);
    expect(casePersonaLine(a)).toContain(`${a.age} yosh`);
  });
});
