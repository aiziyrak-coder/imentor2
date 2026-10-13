import { describe, expect, it } from 'vitest';
import { CASE_STUDY_FOCUS_ORDER } from './generationVariety';
import {
  caseFocusAccentBorderClass,
  caseFocusBadgeClass,
  caseFocusLabel,
  sortCaseQuestionsByFocus,
} from './caseFocusLabels';

describe('Keys fokus tartibi', () => {
  it('klinik mantiq bo\'yicha: tashxis → davolash → profilaktika', () => {
    expect([...CASE_STUDY_FOCUS_ORDER]).toEqual(['tashxis', 'davolash', 'profilaktika']);
  });

  it('eski tartibda saqlangan keysni ham to\'g\'ri ketma-ketlikda chiqaradi', () => {
    const stored = [
      { focus: 'profilaktika' as const, scenario: 'p' },
      { focus: 'davolash' as const, scenario: 'd' },
      { focus: 'tashxis' as const, scenario: 't' },
    ];
    expect(sortCaseQuestionsByFocus(stored).map((q) => q.scenario)).toEqual(['t', 'd', 'p']);
  });

  it('fokusi yo\'q savollarni oxirida, asl tartibda qoldiradi', () => {
    const items = [
      { scenario: 'x' },
      { focus: 'davolash' as const, scenario: 'd' },
      { scenario: 'y' },
      { focus: 'tashxis' as const, scenario: 't' },
    ];
    expect(sortCaseQuestionsByFocus(items).map((q) => q.scenario)).toEqual(['t', 'd', 'x', 'y']);
  });

  it('asl massivni o\'zgartirmaydi', () => {
    const items = [{ focus: 'profilaktika' as const }, { focus: 'tashxis' as const }];
    sortCaseQuestionsByFocus(items);
    expect(items[0].focus).toBe('profilaktika');
  });
});

describe("noma'lum focus qiymati", () => {
  it('sahifani yiqitmaydi — standart ko\'rinish qaytadi', () => {
    const odd = 'nazariya' as unknown as Parameters<typeof caseFocusBadgeClass>[0];
    expect(caseFocusBadgeClass(odd)).toContain('bg-black/5');
    expect(caseFocusAccentBorderClass(odd)).toBe('border-l-black/15');
    expect(caseFocusLabel(odd)).toBe('');
  });
});
