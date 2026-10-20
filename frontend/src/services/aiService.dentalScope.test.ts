import { describe, expect, it } from 'vitest';
import { isDentalScope } from './aiService';

describe('isDentalScope', () => {
  it('stomatologik mavzularni taniydi', () => {
    expect(isDentalScope('Tishlarning anatomiyasi')).toBe(true);
    expect(isDentalScope('Doimiy tish kariyesi')).toBe(true);
    expect(isDentalScope('Og‘iz bo‘shlig‘i shilliq qavati')).toBe(true);
    expect(isDentalScope('Mavzu', 'Terapevtik stomatologiya')).toBe(true);
  });

  it('"-tish" qo\'shimchasi stomatologiya emas (2026-10-20)', () => {
    expect(isDentalScope("Sog'liqni saqlashni tashkil etish")).toBe(false);
    expect(isDentalScope('Ma’lumotlar bazalari va ularni yaratish asoslari')).toBe(false);
    expect(isDentalScope('Bemorni tekshirish usullari', 'Ichki kasalliklar')).toBe(false);
  });
});
