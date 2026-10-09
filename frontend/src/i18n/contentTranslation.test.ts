import { describe, expect, it } from 'vitest';
import { translatedView } from './useTranslatedPayload';
import { textFitsLanguage } from '../utils/outputLanguage';
import { parseDeckMarker } from '../utils/presentationDeckVariants';

describe('translatedView', () => {
  const payload = {
    topic: 'Gipertenziya',
    content: "O'zbekcha matn",
    primaryLanguage: 'uz' as const,
    translations: { ru: { topic: 'Гипертензия', content: 'Русский текст' } },
  };

  it('asosiy tilda o\'zini qaytaradi', () => {
    expect(translatedView(payload, 'uz')?.content).toBe("O'zbekcha matn");
  });

  it('tarjima bor bo\'lsa — tarjima', () => {
    expect(translatedView(payload, 'ru')?.content).toBe('Русский текст');
    expect(translatedView(payload, 'ru')?.topic).toBe('Гипертензия');
  });

  it("tarjima yo'q bo'lsa — null (asl matn ko'rsatilmaydi)", () => {
    expect(translatedView(payload, 'en')).toBeNull();
  });
});

describe('textFitsLanguage', () => {
  it("o'zbekcha server xabarini rus interfeysida rad etadi", () => {
    expect(textFitsLanguage("Fayl turi qo'llab-quvvatlanmaydi.", 'ru')).toBe(false);
    expect(textFitsLanguage("Fayl turi qo'llab-quvvatlanmaydi.", 'en')).toBe(false);
    expect(textFitsLanguage("Fayl turi qo'llab-quvvatlanmaydi.", 'uz')).toBe(true);
  });

  it('inglizcha xabar faqat ingliz interfeysida', () => {
    expect(textFitsLanguage('Session key already in use.', 'en')).toBe(true);
    expect(textFitsLanguage('Session key already in use.', 'uz')).toBe(false);
  });

  it('ruscha xabar faqat rus interfeysida', () => {
    expect(textFitsLanguage('Файл слишком большой.', 'ru')).toBe(true);
    expect(textFitsLanguage('Файл слишком большой.', 'uz')).toBe(false);
  });
});

describe('parseDeckMarker', () => {
  it('til qo\'shimchasi bilan', () => {
    expect(parseDeckMarker('Mavzu--pc12-ru.pptx')).toEqual({ pcId: '12', lang: 'ru' });
  });
  it('eski (tilsiz) fayl', () => {
    expect(parseDeckMarker('Mavzu--pc7.pptx')).toEqual({ pcId: '7', lang: null });
  });
  it("o'qituvchi yuklagan oddiy fayl", () => {
    expect(parseDeckMarker('ma_ruza.pdf')).toBeNull();
  });
});
