import { describe, expect, it, vi } from 'vitest';

vi.mock('./openaiClient', () => ({
  openaiJson: vi.fn(),
  openaiJsonStream: vi.fn(),
  chatCompletion: vi.fn(),
  assertOpenAiApiKey: vi.fn(),
  OPENAI_CHAT: 'gpt-test',
  OPENAI_FAST: 'gpt-test-fast',
  OPENAI_VISION: 'gpt-test-vision',
}));

const { shuffleQuestionOptions } = await import('./aiService');

describe('shuffleQuestionOptions', () => {
  it('to\'g\'ri javob matni o\'zgarmaydi — faqat o\'rni siljiydi', () => {
    for (let n = 0; n < 200; n += 1) {
      const out = shuffleQuestionOptions({
        options: ['A-javob', 'B-javob', 'C-javob', 'D-javob', 'E-javob'],
        correctOptionIndex: 2,
      });
      expect(out.options[out.correctOptionIndex]).toBe('C-javob');
      expect([...out.options].sort()).toEqual(
        ['A-javob', 'B-javob', 'C-javob', 'D-javob', 'E-javob'].sort(),
      );
    }
  });

  it('variant izohlari o\'z variantiga ergashadi', () => {
    for (let n = 0; n < 200; n += 1) {
      const out = shuffleQuestionOptions({
        options: ['bir', 'ikki', 'uch'],
        correctOptionIndex: 0,
        optionExplanations: ['bir-izoh', 'ikki-izoh', 'uch-izoh'],
      });
      out.options.forEach((opt, i) => {
        expect(out.optionExplanations?.[i]).toBe(`${opt}-izoh`);
      });
    }
  });

  it('to\'g\'ri javob har doim A da qolib ketmaydi', () => {
    const positions = new Set<number>();
    for (let n = 0; n < 300; n += 1) {
      positions.add(
        shuffleQuestionOptions({
          options: ['a', 'b', 'c', 'd', 'e'],
          correctOptionIndex: 0,
        }).correctOptionIndex,
      );
    }
    // 300 urinishda beshala o'rin ham uchrashi kerak.
    expect([...positions].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('bitta variant bo\'lsa — hech narsa buzilmaydi', () => {
    const out = shuffleQuestionOptions({ options: ['yagona'], correctOptionIndex: 0 });
    expect(out.options).toEqual(['yagona']);
    expect(out.correctOptionIndex).toBe(0);
  });
});

describe('shuffleQuestionOptions — izohdagi harf', () => {
  it("izohdagi \"to'g'ri javob — A\" aralashtirilgandan keyin ham to'g'ri variantni ko'rsatadi", () => {
    for (let n = 0; n < 100; n += 1) {
      const out = shuffleQuestionOptions({
        options: ['Togri', 'Xato-1', 'Xato-2', 'Xato-3', 'Xato-4'],
        correctOptionIndex: 0,
        explanation: "To'g'ri javob — A. B variant esa boshqa holat uchun.",
      });
      const letter = 'ABCDE'[out.correctOptionIndex];
      expect(out.explanation).toContain(`To'g'ri javob — ${letter}.`);
      const bWas = 'ABCDE'[out.options.indexOf('Xato-1')];
      expect(out.explanation).toContain(`${bWas} variant esa`);
    }
  });
});
