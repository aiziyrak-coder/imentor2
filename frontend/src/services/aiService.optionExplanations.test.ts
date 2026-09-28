import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Eslatma: variant izohlari + klinik tahlil OPENAI_CHAT ('gpt-test') da,
 * tarjima esa OPENAI_FAST ('gpt-test-fast') da so'raladi — mock shu bo'yicha
 * ajratadi.
 *
 * `enrichTestSession` har variantga izoh (`optionExplanations`) biriktirishini
 * va bu izohlar tarjimalarga ham yetib borishini tekshiradi — test ekranida
 * "nega to'g'ri / nega xato" aynan shu maydondan chiqadi.
 */

const openaiJson = vi.fn();

vi.mock('./openaiClient', () => ({
  openaiJson: (...args: unknown[]) => openaiJson(...args),
  openaiJsonStream: vi.fn(),
  chatCompletion: vi.fn(),
  assertOpenAiApiKey: vi.fn(),
  OPENAI_CHAT: 'gpt-test',
  OPENAI_FAST: 'gpt-test-fast',
  OPENAI_VISION: 'gpt-test-vision',
}));

// Kitob manbalari backendga so'rov yuboradi — bu testda ahamiyatsiz.
vi.mock('../utils/backendAuth', () => ({
  ensureBackendAccessToken: vi.fn(async () => ''),
  getBackendAccessToken: vi.fn(() => ''),
}));

const { aiService } = await import('./aiService');

const baseSession = () => ({
  topic: 'Pemfigus',
  primaryLanguage: 'uz' as const,
  questions: [
    {
      question: '45 yoshli bemorda intraepidermal akantoliz aniqlandi. Tashxis?',
      options: ['Pemfigus vulgaris', 'Pemfigus foliaceus', 'Dyuring', 'Kontakt dermatit', 'Psoriaz'],
      correctOptionIndex: 0,
      explanation: 'Intraepidermal akantoliz pemfigus vulgarisga xosdir.',
    },
  ],
  references: [],
});

describe('enrichTestSession — variant izohlari', () => {
  beforeEach(() => {
    openaiJson.mockReset();
  });

  it('har variantga izoh qo\'shadi', async () => {
    openaiJson.mockImplementation(async (opts: { model: string }) => {
      if (opts.model === 'gpt-test') {
        return {
          items: [
            {
              id: 0,
              explanations: [
                { i: 0, text: 'To\'g\'ri' },
                { i: 1, text: 'Yuzaki akantoliz' },
                { i: 2, text: 'Subepidermal' },
                { i: 3, text: 'Allergik' },
                { i: 4, text: 'Papula' },
              ],
            },
          ],
        };
      }
      throw new Error('tarjima bu testda kerak emas');
    });

    const out = await aiService.enrichTestSession(baseSession(), 'uz');
    expect(out.questions[0].optionExplanations).toEqual([
      'To\'g\'ri',
      'Yuzaki akantoliz',
      'Subepidermal',
      'Allergik',
      'Papula',
    ]);
  });

  it('qisqa `explanation` o\'rniga to\'liq tahlil qo\'yiladi', async () => {
    openaiJson.mockImplementation(async (opts: { model: string }) => {
      if (opts.model === 'gpt-test') {
        return {
          items: [
            {
              id: 0,
              analysis: 'Bemorda intraepidermal akantoliz aniqlangan. Bu pemfigus vulgarisga xos. '
                + 'Dyuring dermatitida esa subepidermal ajralish bo\'ladi. Shuning uchun tanlov aniq.',
              explanations: [{ i: 0, text: 'To\'g\'ri' }],
            },
          ],
        };
      }
      throw new Error('tarjima kerak emas');
    });

    const out = await aiService.enrichTestSession(baseSession(), 'uz');
    expect(out.questions[0].explanation).toContain('subepidermal ajralish');
    expect(out.questions[0].explanation!.length).toBeGreaterThan(120);
  });

  it('tahlil qisqaroq kelsa — mavjud izoh saqlanib qoladi', async () => {
    openaiJson.mockImplementation(async (opts: { model: string }) => {
      if (opts.model === 'gpt-test') {
        return { items: [{ id: 0, analysis: 'Juda qisqa.', explanations: [{ i: 0, text: 'a' }] }] };
      }
      throw new Error('tarjima kerak emas');
    });

    const out = await aiService.enrichTestSession(baseSession(), 'uz');
    expect(out.questions[0].explanation).toBe('Intraepidermal akantoliz pemfigus vulgarisga xosdir.');
  });

  it('so\'rov bir marta yiqilsa — qayta urinib izohlarni oladi', async () => {
    let calls = 0;
    openaiJson.mockImplementation(async (opts: { model: string; system: string }) => {
      if (opts.model === 'gpt-test' && opts.system.includes('variantning berilgan i raqami')) {
        calls += 1;
        // Birinchi urinish uziladi (tarmoq/model xatosi), ikkinchisi ishlaydi.
        if (calls === 1) throw new Error('tarmoq uzildi');
        return {
          items: [
            {
              id: 0,
              analysis: 'Uzun tahlil. Ikkinchi gap. Uchinchi gap bilan yakunlanadi.',
              explanations: [0, 1, 2, 3, 4].map((i) => ({ i, text: `r-${i}` })),
            },
          ],
        };
      }
      throw new Error('tarjima kerak emas');
    });

    const out = await aiService.enrichTestSession(baseSession(), 'uz');
    expect(calls).toBe(2);
    expect(out.questions[0].optionExplanations).toEqual(['r-0', 'r-1', 'r-2', 'r-3', 'r-4']);
  });

  it('har ikki urinish ham yiqilsa — test baribir saqlanadi, izohsiz', async () => {
    openaiJson.mockImplementation(async (opts: { model: string; system: string }) => {
      if (opts.model === 'gpt-test' && opts.system.includes('variantning berilgan i raqami')) {
        throw new Error('doim yiqiladi');
      }
      throw new Error('tarjima kerak emas');
    });

    const out = await aiService.enrichTestSession(baseSession(), 'uz');
    expect(out.questions[0].optionExplanations).toBeUndefined();
    expect(out.questions[0].question).toContain('akantoliz');
  });

  it('izohlar sessiyaga qo\'shiladi — tarjimani server qiladi, brauzer emas', async () => {
    // Tarjima serverga ko'chgan (saqlanganda `case_i18n.ensure_translations` fonda ishlaydi):
    // brauzer tarjima so'rovini yubormasligi, lekin izohlar saqlanadigan sessiyada bo'lishi shart —
    // aks holda server ru/en versiyalarni izohsiz tarjima qilardi.
    const otherCalls: string[] = [];
    openaiJson.mockImplementation(async (opts: { model: string; user: string; system: string }) => {
      if (opts.model === 'gpt-test' && opts.system.includes('variantning berilgan i raqami')) {
        return {
          items: [
            {
              id: 0,
              explanations: [0, 1, 2, 3, 4].map((i) => ({ i, text: `izoh-${i}` })),
            },
          ],
        };
      }
      otherCalls.push(opts.system);
      throw new Error('kutilmagan so\'rov');
    });

    const out = await aiService.enrichTestSession(baseSession(), 'uz');
    expect(out.questions[0].optionExplanations).toEqual(['izoh-0', 'izoh-1', 'izoh-2', 'izoh-3', 'izoh-4']);
    expect(otherCalls.filter((sys) => /translat|tarjima/i.test(sys))).toHaveLength(0);
  });

  it('AI kam izoh qaytarsa — kelgani o\'z o\'rnida qoladi, qolgani bo\'sh', async () => {
    openaiJson.mockImplementation(async (opts: { model: string }) => {
      if (opts.model === 'gpt-test') {
        return { items: [{ id: 0, explanations: [{ i: 2, text: 'faqat uchinchisi' }] }] };
      }
      throw new Error('tarjima kerak emas');
    });

    const out = await aiService.enrichTestSession(baseSession(), 'uz');
    expect(out.questions[0].optionExplanations).toEqual(['', '', 'faqat uchinchisi', '', '']);
  });

  it('izoh o\'z variantiga tushadi — AI tartibni almashtirib yuborsa ham', async () => {
    // Model ko'pincha TO'G'RI variant izohini birinchi qilib qaytaradi.
    // `i` raqami bo'lgani uchun u baribir o'z o'rniga tushishi kerak.
    openaiJson.mockImplementation(async (opts: { model: string }) => {
      if (opts.model === 'gpt-test') {
        return {
          items: [
            {
              id: 0,
              explanations: [
                { i: 2, text: 'uchinchi haqida' },
                { i: 0, text: 'birinchi haqida' },
                { i: 4, text: 'beshinchi haqida' },
              ],
            },
          ],
        };
      }
      throw new Error('tarjima kerak emas');
    });

    const out = await aiService.enrichTestSession(baseSession(), 'uz');
    expect(out.questions[0].optionExplanations).toEqual([
      'birinchi haqida',
      '',
      'uchinchi haqida',
      '',
      'beshinchi haqida',
    ]);
  });

  it('raqamsiz izohlar ISHLATILMAYDI — noto\'g\'ri variantga tushgandan ko\'ra bo\'sh yaxshi', async () => {
    openaiJson.mockImplementation(async (opts: { model: string }) => {
      if (opts.model === 'gpt-test') {
        return { items: [{ id: 0, optionExplanations: ['eski shakl', 'b', 'c', 'd', 'e'] }] };
      }
      throw new Error('tarjima kerak emas');
    });

    const out = await aiService.enrichTestSession(baseSession(), 'uz');
    expect(out.questions[0].optionExplanations).toBeUndefined();
  });

  it('model {items} o\'rniga sof massiv qaytarsa ham qabul qilinadi', async () => {
    openaiJson.mockImplementation(async (opts: { model: string }) => {
      if (opts.model === 'gpt-test') {
        return [{ explanations: [0, 1, 2, 3, 4].map((i) => ({ i, text: `x-${i}` })) }];
      }
      throw new Error('tarjima kerak emas');
    });

    const out = await aiService.enrichTestSession(baseSession(), 'uz');
    expect(out.questions[0].optionExplanations).toEqual(['x-0', 'x-1', 'x-2', 'x-3', 'x-4']);
  });

  it('id yo\'q bo\'lsa — bo\'lakdagi tartib bo\'yicha biriktiriladi', async () => {
    openaiJson.mockImplementation(async (opts: { model: string }) => {
      if (opts.model === 'gpt-test') {
        return { questions: [{ explanations: [0, 1, 2, 3, 4].map((i) => ({ i, text: `p-${i}` })) }] };
      }
      throw new Error('tarjima kerak emas');
    });

    const out = await aiService.enrichTestSession(baseSession(), 'uz');
    expect(out.questions[0].optionExplanations).toEqual(['p-0', 'p-1', 'p-2', 'p-3', 'p-4']);
  });
});
