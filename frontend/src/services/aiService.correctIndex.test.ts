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
