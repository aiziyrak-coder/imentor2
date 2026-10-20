import { describe, expect, it } from 'vitest';
import {
  caseTextFlaws,
  caseWeaknesses,
  localizeCaseLabels,
  repetitionShare,
  stripCaseHtml,
  stripScenarioInterpretation,
} from './caseQuality';

describe('caseTextFlaws', () => {
  it('to‘ldirilmagan shablonni ushlaydi, taqqoslash belgisini emas', () => {
    expect(caseTextFlaws(['<Muqobil> — QO‘LLAB: ...'])).toContain('shablon_qoldi');
    expect(caseTextFlaws(['DO <5 mg/l, EChT >20 mm/soat'])).not.toContain('shablon_qoldi');
  });

  it('JSON kalit nomini ushlaydi', () => {
    expect(caseTextFlaws(['patient: 45 yosh\ncomplaints: og‘riq'])).toContain('kalit_nomi');
  });

  it('nano takrorlanish halqasini ushlaydi', () => {
    const loop = Array(8).fill('O‘tgan hafta, kechqurunlar, qattiq, qattiq, qattiq og‘riq bilan, ayniqsa, ovqatdan keyin, kuchaygan.').join(' ');
    expect(repetitionShare(loop)).toBeGreaterThan(0.5);
    expect(caseTextFlaws([loop])).toContain('takrorlanish');
  });

  it('ko‘rsatma matnga ko‘chganini ushlaydi', () => {
    expect(caseTextFlaws(['Ism, yosh va jins mosligi saqlangan holda, bemor yurib kelgan.'])).toContain('korsatma_sizdi');
  });

  it('oddiy keys matni toza', () => {
    const text =
      'Dilfuza, 34 yosh, ayol, o‘qituvchi. Uch kundan beri o‘ng qovurg‘a ostida og‘riq, ko‘ngil aynishi va ' +
      'yog‘li ovqatdan keyin kuchayish. Harorat 38,1 °C, puls 96, Merfi belgisi musbat. Leykotsitlar 13,2×10⁹/l, ' +
      'CRP 64 mg/l, bilirubin 18 mkmol/l. UTT: o‘t pufagi devori 5 mm, bo‘yinchasida 12 mm tosh, perixoletsistik suyuqlik.';
    expect(caseTextFlaws([text])).toEqual([]);
  });
});

describe('localizeCaseLabels', () => {
  it('ruscha va inglizcha keysda yorliqlar chiqish tilida', () => {
    const src = "ФИКР YO'LI: ... Пневмония — QO'LLAB: хрипы; RAD: нет лихорадки. CHALG'ITUVCHI: ...";
    const ru = localizeCaseLabels(src, 'ru');
    expect(ru).toContain('ХОД РАССУЖДЕНИЯ');
    expect(ru).toContain('ЗА:');
    expect(ru).toContain('ПРОТИВ:');
    expect(localizeCaseLabels("FIKR YO'LI: x", 'en')).toBe('REASONING: x');
    expect(localizeCaseLabels("FIKR YO'LI: x", 'uz')).toBe("FIKR YO'LI: x");
  });

  it('lokalizatsiyadan keyin ham fikrlash tekshiruvi o‘tadi', () => {
    const dx = 'ХОД РАССУЖДЕНИЯ: СОЭ 68 мм/ч + ... -> пневмония.';
    const dd = 'Туберкулёз — ЗА: кашель; ПРОТИВ: нет. Рак — ЗА: возраст; ПРОТИВ: КТ.';
    expect(caseWeaknesses(dx, dd)).not.toContain('fikr_yoli_yoq');
    expect(caseWeaknesses(dx, dd)).not.toContain('differensial_yuzaki');
  });
});

it('stripCaseHtml <br> ni qatorga aylantiradi', () => {
  expect(stripCaseHtml('a<br>b<br/>c')).toBe('a\nb\nc');
});

describe('stripScenarioInterpretation', () => {
  it('talqin gaplarini olib tashlaydi, faktlarni qoldiradi', () => {
    const src =
      'Leykotsitlar 14,8 x10^9/L, CRP 62 mg/L. Laktat 3,1 mmol/L, bu to‘qima gipoperfuziyasi foydasiga. ' +
      'Amilaza 62 U/L normal, bu pankreatitni zaiflashtiradi. Najasda eritrotsitlar bor. Gemoglobin 116 g/L.';
    const out = stripScenarioInterpretation(src);
    expect(out).toContain('CRP 62 mg/L.');
    expect(out).toContain('Najasda eritrotsitlar bor.');
    expect(out).not.toMatch(/foydasiga|zaiflashtiradi/);
    expect(out).toContain('Laktat 3,1 mmol/L.');
    expect(out).toContain('Amilaza 62 U/L normal.');
  });

  it('qiymatni saqlab, faqat talqin bo‘lagini kesadi', () => {
    const src =
      'Gemoglobin 116 g/L (me’yor 120–150) va gematokrit 35% bo‘lib, o‘tkir qon yo‘qotish bilan mos keladi. ' +
      'Peritoneal simptomlar **yo‘q**, bu perforatsiya ehtimolini pasaytiradi. Harorat 37,8 °C. Puls 108/min.';
    const out = stripScenarioInterpretation(src);
    expect(out).toContain('gematokrit 35%.');
    expect(out).toContain('Peritoneal simptomlar **yo‘q**.');
    expect(out).not.toMatch(/mos keladi|ehtimolini/);
  });

  it('ko‘p gap tushadigan bo‘lsa, matnga tegmaydi', () => {
    const src = 'Bu infeksiyani ko‘rsatadi. Bu sepsis foydasiga. Harorat 39 °C.';
    expect(stripScenarioInterpretation(src)).toBe(src);
  });
});
