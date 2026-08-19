import { describe, expect, it } from 'vitest';
import {
  buildCaseClinicalRules,
  buildCaseKeywordsFocusPrompt,
  buildCaseStructurePrompt,
  buildTestVarietyPrompt,
} from './generationVariety';

describe('Keys generatsiya qoidalari', () => {
  it('mavzu bo\'limlarini ochiq beradi va mavzudan chiqishni taqiqlaydi', () => {
    const prompt = buildCaseStructurePrompt(
      'Piodermiyalar. Dermatozoonozlar. Ter va yog\' bezlari.',
    );
    expect(prompt).toContain('Piodermiyalar');
    expect(prompt).toContain('Dermatozoonozlar');
    expect(prompt).toMatch(/mavzudan tashqariga CHIQMASIN/i);
    expect(prompt).toMatch(/MAVZUGA kiradigan/i);
  });

  it('oson klassik keys va cho\'zilgan matnni taqiqlaydi', () => {
    const prompt = buildCaseStructurePrompt('Gipertoniya kasalligi');
    expect(prompt).toMatch(/tipik oson/i);
    expect(prompt).toMatch(/VAZIYATLI MASALA/i);

    const rules = buildCaseClinicalRules();
    expect(rules).toMatch(/OLDI-QOCHDI YO'Q/);
    expect(rules).toMatch(/oson kasallik/);
    expect(rules).toContain('520–720');
    expect(rules).toContain('700–920');
    expect(rules).toMatch(/appenditsit/);
    expect(rules).not.toMatch(/kamida 700/);
    expect(rules).not.toContain('320–420');
  });

  it('kalit so\'zlarni mavzu doirasida ushlab turadi', () => {
    const block = buildCaseKeywordsFocusPrompt(['skrining', 'statin']);
    expect(block).toContain('skrining');
    expect(block).toMatch(/mavzudan tashqariga olib chiqmasin/);
  });
});

describe('Test generatsiya qoidalari', () => {
  it('maktab savolini taqiqlaydi va mavzuga bog\'laydi', () => {
    const prompt = buildTestVarietyPrompt(
      'Piodermiyalar. Dermatozoonozlar.',
      10,
      'hard',
    );
    expect(prompt).toMatch(/3 ZICH JUMLA/);
    expect(prompt).toMatch(/ABG=tashxis/);
    expect(prompt).toMatch(/ehtimoliy tashxis/);
    expect(prompt).toContain('Piodermiyalar');
    expect(prompt).toMatch(/TO'G'RI JAVOBI shu mavzuga/i);
    expect(prompt).toMatch(/Mavzudan CHIQMANG|mavzu doirasida/i);
  });

  it('akademik fanlarda diabet+pochta namunasini taqiqlaydi', () => {
    const prompt = buildTestVarietyPrompt(
      'Elektron pochta xavfsizligi',
      10,
      'hard',
      'academic',
    );
    expect(prompt).toMatch(/HbA1c/);
    expect(prompt).toMatch(/KLINIK BEMOR YO'Q/);
    expect(prompt).not.toMatch(/ABG=tashxis/);

    const casePrompt = buildCaseStructurePrompt('Elektron pochta', 'academic');
    expect(casePrompt).toMatch(/diabet/i);
    expect(casePrompt).not.toMatch(/appenditsit/);

    const rules = buildCaseClinicalRules('academic');
    expect(rules).toMatch(/klinik keys EMAS/);
    expect(rules).not.toMatch(/appenditsit/);
  });
});
