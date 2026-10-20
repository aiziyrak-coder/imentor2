import { describe, expect, it } from 'vitest';
import { caseTextFlaws, caseWeaknesses, localizeCaseLabels, repetitionShare, stripCaseHtml } from './caseQuality';

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
