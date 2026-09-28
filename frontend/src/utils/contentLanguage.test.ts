import { describe, expect, it } from 'vitest';
import { contentLanguageFor } from './syllabusInstructionLanguage';
describe('chosen content language', () => {
  it('keeps the selected language on every material page despite a different source language', () => {
    for (const ui of ['uz', 'ru', 'en'] as const) {
      for (const instructionLanguage of ['uz', 'ru', 'en'] as const) {
        expect(contentLanguageFor({ instructionLanguage, title: 'Gigiyena' }, ui)).toBe(ui);
      }
      expect(contentLanguageFor(null, ui)).toBe(ui);
    }
  });
});
