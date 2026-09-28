import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { inflateRawJs } from './inflateRaw';

/** Eski brauzerda `DecompressionStream('deflate-raw')` yo'q — Excel shu zaxira bilan ochiladi. */
describe('inflateRawJs', () => {
  const cases: Array<[string, Buffer]> = [
    ['bo‘sh', Buffer.from('')],
    ['qisqa matn', Buffer.from('Ma’ruza 1. Dalillarga asoslangan tibbiyot', 'utf8')],
    ['takrorlanuvchi matn', Buffer.from('Amaliy mashg‘ulot. '.repeat(500), 'utf8')],
    ['tasodifiy baytlar', Buffer.from(Array.from({ length: 50_000 }, (_, i) => (i * 7919) % 256))],
  ];

  for (const [label, data] of cases) {
    for (const level of [0, 1, 6, 9]) {
      it(`${label} (daraja ${level})`, () => {
        const packed = deflateRawSync(data, { level });
        const out = inflateRawJs(new Uint8Array(packed));
        expect(Buffer.from(out).equals(data)).toBe(true);
      });
    }
  }

  it('buzuq ma’lumotda xato beradi, osilib qolmaydi', () => {
    expect(() => inflateRawJs(new Uint8Array([0x07]))).toThrow();
  });
});
