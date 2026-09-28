import { describe, expect, it } from 'vitest';
import { normalizePresentationContent, type ContentSlide } from './presentationContentSchema';
import { slideLanguageWrong } from './presentationLanguage';
const ru: ContentSlide = { slide_type: 'content_bullets', title: 'Качество питьевой воды', body: { bullets: ['Качество питьевой воды оценивают по микробиологическим и химическим показателям с учетом источника водоснабжения и условий отбора проб.'] }, image_query: 'drinking water quality laboratory' };
describe('presentation integrity', () => {
  it('does not add Uzbek filler or fabricated statistics to a short Russian deck', () => {
    const content = normalizePresentationContent({ slides: [ru] }, { title: 'Питьевая вода', subject: 'Гигиена' });
    expect(content.slides).toHaveLength(2);
    expect(JSON.stringify(content)).not.toMatch(/90%|72h|Xulosa|Klinik/);
    expect(content.slides.every(s => !slideLanguageWrong(s, 'ru'))).toBe(true);
  });
  it('detects mixed later slides, ignoring English image queries and JSON keys', () => {
    expect(slideLanguageWrong(ru, 'ru')).toBe(false);
    expect(slideLanguageWrong({ ...ru, body: { bullets: ["Ushbu mavzuda bemor holati aniqlanadi va tavsiya etilgan profilaktika choralari muhim hisoblanadi."] } }, 'ru')).toBe(true);
  });
  it('preserves image source URLs after normalization for saved downloads', () => {
    const content = normalizePresentationContent({ slides: [{ ...ru, imageSourceUrl: 'https://example.org/water.jpg' }] }, { title: 'Вода', subject: 'Гигиена' });
    expect(content.slides[1].imageSourceUrl).toBe('https://example.org/water.jpg');
  });
  it('rejects empty AI output instead of fabricating a teaching deck', () => {
    expect(() => normalizePresentationContent({}, { title: 'Water', subject: 'Hygiene' })).toThrow();
  });
});
