import { describe, expect, it } from 'vitest';
import { translatedView } from './useTranslatedPayload';

describe("tarjima ko'rinishida to'g'ri javob", () => {
  it('asl savoldan olinadi (tarjimada u saqlanmaydi)', () => {
    const payload = {
      primaryLanguage: 'uz' as const,
      questions: [{ question: 'Savol', options: ['a', 'b'], correctOptionIndex: 1 }],
      translations: { ru: { questions: [{ question: 'Вопрос', options: ['а', 'б'] }] } },
    };
    const view = translatedView(payload, 'ru');
    expect(view?.questions[0]).toMatchObject({ question: 'Вопрос', correctOptionIndex: 1 });
  });

  it("eskirgan raqam bo'lsa ham asl raqam ustun", () => {
    const payload = {
      primaryLanguage: 'uz' as const,
      questions: [{ question: 'Savol', options: ['a', 'b', 'c'], correctOptionIndex: 2 }],
      translations: { en: { questions: [{ question: 'Q', options: ['a', 'b', 'c'], correctOptionIndex: 0 }] } },
    };
    expect(translatedView(payload, 'en')?.questions[0].correctOptionIndex).toBe(2);
  });
});
