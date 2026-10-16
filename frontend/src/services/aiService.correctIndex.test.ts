import { describe, expect, it } from 'vitest';
import { parseCorrectOptionIndex } from './aiService';

const OPTS = ['Alfa', 'Beta', 'Gamma', 'Delta', 'Epsilon'];

describe("parseCorrectOptionIndex — to'g'ri javob kaliti", () => {
  it('raqamni o\'zgartirmaydi', () => {
    expect(parseCorrectOptionIndex(3, OPTS)).toBe(3);
  });

  it('matn ko\'rinishidagi raqam va harfni o\'qiydi (ilgari 0 bo\'lib qolardi)', () => {
    expect(parseCorrectOptionIndex('2', OPTS)).toBe(2);
    expect(parseCorrectOptionIndex('C', OPTS)).toBe(2);
    expect(parseCorrectOptionIndex('d)', OPTS)).toBe(3);
  });

  it('variant matnidan topadi', () => {
    expect(parseCorrectOptionIndex(undefined, OPTS, 'gamma')).toBe(2);
  });

  it("aniqlab bo'lmasa null — A ga jimgina tushmaydi", () => {
    expect(parseCorrectOptionIndex(undefined, OPTS)).toBeNull();
    expect(parseCorrectOptionIndex(7, OPTS)).toBeNull();
    expect(parseCorrectOptionIndex('Z', OPTS)).toBeNull();
  });
});

describe("parseCorrectOptionIndex — javob matni raqamdan ustun", () => {
  it('model 1 dan sanagan bo\'lsa (A=1), matn bo\'yicha to\'g\'ri variant olinadi', () => {
    // Model "Beta" ni to'g'ri deb, lekin raqamni 2 deb yozgan (1 dan sanab).
    expect(parseCorrectOptionIndex(2, OPTS, 'Beta')).toBe(1);
  });

  it('javob matni harf bilan kelsa ham taniydi', () => {
    expect(parseCorrectOptionIndex(0, OPTS, 'D) Delta')).toBe(3);
  });

  it('matn hech bir variantga mos kelmasa — raqam ishlatiladi', () => {
    expect(parseCorrectOptionIndex(4, OPTS, 'Boshqa narsa')).toBe(4);
  });

  it('"C. difficile" kabi variant nomini harf deb kesmaydi', () => {
    const opts = ['Vankomitsin', 'C. difficile toksini', 'Metronidazol', 'Rifaksimin'];
    expect(parseCorrectOptionIndex(3, opts, 'C. difficile toksini')).toBe(1);
  });
});
