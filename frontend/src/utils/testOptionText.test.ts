import { describe, expect, it } from 'vitest';
import { remapOptionLetters, stripOptionLabels, stripOptionLetterPrefix } from './testOptionText';

describe('stripOptionLetterPrefix', () => {
  it('lotin harf prefiksini olib tashlaydi', () => {
    expect(stripOptionLetterPrefix('A. Papula', 0)).toBe('Papula');
    expect(stripOptionLetterPrefix('B) Vezikula', 1)).toBe('Vezikula');
  });

  it('kirilcha prefiksni ham olib tashlaydi', () => {
    expect(stripOptionLetterPrefix('А. Папула', 0)).toBe('Папула');
    expect(stripOptionLetterPrefix('В. Везикула', 1)).toBe('Везикула');
  });

  it('boshqa harf prefiksiga tegmaydi', () => {
    // 2-variant "C" bo'lishi kerak — "A." bu yerda mazmunning bir qismi.
    expect(stripOptionLetterPrefix('A. Papula', 2)).toBe('A. Papula');
  });

  it('prefiksi yo\'q matnni o\'zgartirmaydi', () => {
    expect(stripOptionLetterPrefix('Papula', 0)).toBe('Papula');
    expect(stripOptionLetterPrefix('ABO tizimi', 0)).toBe('ABO tizimi');
  });

  it('bo\'sh qiymatlarga chidamli', () => {
    expect(stripOptionLetterPrefix('', 0)).toBe('');
    expect(stripOptionLetterPrefix('A.', 0)).toBe('A.');
  });
});

describe('stripOptionLabels', () => {
  it('hamma variant belgilangan bo\'lsa — belgilarni olib tashlaydi', () => {
    expect(stripOptionLabels(['A) Papula', 'B) Vezikula', 'C) Pustula', 'D) Bulla'])).toEqual([
      'Papula',
      'Vezikula',
      'Pustula',
      'Bulla',
    ]);
  });

  it('tibbiy nomlarni buzmaydi (C. difficile, E. coli)', () => {
    const options = ['Vankomitsin', 'Metronidazol', 'C. difficile toksini', 'Rifaksimin', 'E. coli'];
    expect(stripOptionLabels(options)).toEqual(options);
  });
});

describe('remapOptionLetters', () => {
  // A->C, B->A, C->B, D->D, E->E
  const order = [2, 0, 1, 3, 4];

  it('"to\'g\'ri javob — A" ni yangi harfga o\'tkazadi', () => {
    expect(remapOptionLetters("To'g'ri javob — A, chunki…", order)).toBe("To'g'ri javob — C, chunki…");
    expect(remapOptionLetters('Javob: (B).', order)).toBe('Javob: (A).');
    expect(remapOptionLetters('Правильный ответ — A.', order)).toBe('Правильный ответ — C.');
  });

  it('"A variant", "B)", "(C)" ishoralarini bir martada almashtiradi', () => {
    expect(remapOptionLetters('A variant to\'g\'ri, B) esa xato, (C) ham xato.', order)).toBe(
      'C variant to\'g\'ri, A) esa xato, (B) ham xato.',
    );
  });

  it('variant bo\'lmagan harflarga tegmaydi', () => {
    const text = 'Vitamin A va B12 yetishmovchiligi; HbA1c 8%; C. difficile.';
    expect(remapOptionLetters(text, order)).toBe(text);
  });
});
