import { describe, expect, it } from 'vitest';
import { UNGRADABLE, questionFlaws } from './testQuality';

// Radiologiya yakuniy testidan (2026-10-19) — talabalar shikoyat qilgan savollar.
describe('questionFlaws: baholab bo\'lmaydigan variantlar', () => {
  it('aynan bir xil variantlarni tutadi', () => {
    const same = "Beta-2 agonistlar, steroidlar, yallig'lanishga qarshi, diuretiklar, antihistaminlar";
    const flaws = questionFlaws({
      question: 'Qaysi dori kontrendikatsiya bo\'lishi mumkin?',
      options: [same, same, 'Beta-2 agonistlar, steroidlar, antihistaminlar, diuretiklar', same, 'Metformin'],
      correctOptionIndex: 3,
    });
    expect(flaws).toContain('variant_takror');
  });

  it('bir xil ro\'yxatning boshqa tartibini tutadi', () => {
    const flaws = questionFlaws({
      question: 'Qaysi tashxis ehtimoliy?',
      options: [
        "Sarkoidoz, sil, emfizem, o'pka kengayishi, bronxial astma",
        "Sil, emfizem, o'pka fibrozlari, sarkoidoz, bronxial astma",
        "O'pka fibrozlari, sil, emfizem, sarkoidoz, bronxial astma",
        "Emfizem, sil, o'pka kengayishi, sarkoidoz, bronxial astma",
        "Sil, o'pka fibrozlari, emfizem, bronxektazi, COPD",
      ],
      correctOptionIndex: 2,
    });
    expect(flaws).toContain('variant_tartib_takror');
    expect(flaws.some((f) => UNGRADABLE.has(f))).toBe(true);
  });

  it('oddiy savolga tegmaydi', () => {
    expect(
      questionFlaws({
        question: 'Rentgenogrammada suyuqlik sathi bilan bo\'shliq. Eng ehtimoliy tashxis?',
        options: ["O'pka abssesi", "O'pka kistasi", 'Pnevmotoraks', 'Plevrit', 'Atelektaz'],
        correctOptionIndex: 0,
      }),
    ).toEqual([]);
  });
});

import { dropDuplicateQuestions } from './testQuality';

describe('dropDuplicateQuestions', () => {
  const q = (question: string, answer: string) => ({
    question,
    options: [answer, 'Furosemid', 'Digoksin', 'Amlodipin', 'Heparin'],
    correctOptionIndex: 0,
  });
  it('bir xil to\'g\'ri javobli ikkinchi savolni tashlaydi', () => {
    const r = dropDuplicateQuestions([
      q('63 yoshli erkak, troponin oshgan, ST depressiya. Keyingi qadam?', 'Koronar angiografiya'),
      q('71 yoshli ayol, damdagi og\'riq, troponin 0,23. Keyingi qadam?', 'Koronar angiografiya'),
      q('54 yoshli erkak, tungi og\'riq, vaqtinchalik ST ko\'tarilishi. Qaysi dori?', 'Nifedipin'),
    ]);
    expect(r.kept).toHaveLength(2);
    expect(r.dropped).toHaveLength(1);
  });
});

describe('javob_savolda: so\'z boshi bo\'yicha', () => {
  it('stemda tasvirlangan topilmani javob sifatida tutadi', () => {
    expect(
      questionFlaws({
        question: 'Auskultatsiyada nafas bilan kuchayadigan qo\'pol ishqalanish shovqini bor. Qaysi fizik topilma plevritni qo\'llab-quvvatlaydi?',
        options: ['Plevral ishqalanish shovqini', 'Perkussiya susayishi', 'Ekspirator xirillash', 'Sistolik shovqin', 'Bronxial nafas'],
        correctOptionIndex: 0,
      }),
    ).toContain('javob_savolda');
  });
});
