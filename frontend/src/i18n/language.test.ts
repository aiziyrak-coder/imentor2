import { describe, expect, it } from 'vitest';
import { inferPdfLanguage } from './language';

/** Serverdagi haqiqiy mavzu nomlari (2026-09-26 auditi) — ilgari hammasi "en" chiqardi. */
describe('inferPdfLanguage — mavzu nomlari', () => {
  it.each([
    'Odam anatomiyasi faniga kirish. Suyaklar tuzilishi va turlari.\nBosh suyagi. Umurtqa pog‘onasi.',
    'Bolalar kasalliklari propedevtikasi. Bolaning jismoniy rivojlanishi.\nNafas olish a’zolarini tekshirish usullari.',
    'Analitik kimyo faniga kirish. Sifat analizi.\nKationlarning birinchi analitik guruhi.',
    'Kommunal gigiyena. Suv ta’minoti gigiyenasi va aholi salomatligi.',
  ])('o‘zbekcha: %s', (text) => {
    expect(inferPdfLanguage(text)).toBe('uz');
  });

  it.each([
    'Cell alteration, dystrophy.\nInflammation, acute and chronic inflammation.\nGenetic diseases.',
    'Vascular pathology. Vascular anomalies. Hypertension. Atherosclerosis.\nHeart pathology.',
    'Microbiology, immunology and virology of the respiratory tract infections.',
  ])('inglizcha: %s', (text) => {
    expect(inferPdfLanguage(text)).toBe('en');
  });

  it('ruscha', () => {
    expect(inferPdfLanguage('Физиология клетки. Мембранный потенциал.\nТема: возбудимые ткани.')).toBe('ru');
  });
});
