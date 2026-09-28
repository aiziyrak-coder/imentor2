import { describe, expect, it } from 'vitest';

/** Eski brauzerlarda yo'q metodlar — polyfill ularni to'g'ri qo'shishi kerak. */
describe('polyfills', () => {
  it('adds a working replaceAll when the browser lacks it', async () => {
    const original = String.prototype.replaceAll;
    // Eski brauzerni taqlid qilamiz.
    delete (String.prototype as { replaceAll?: unknown }).replaceAll;
    try {
      await import('./polyfills');
      expect('a{x}b{x}'.replaceAll('{x}', '1')).toBe('a1b1');
      // Nuqta kabi regexp belgilari oddiy matn sifatida almashishi kerak.
      expect('a.b.c'.replaceAll('.', '-')).toBe('a-b-c');
      expect('aaa'.replaceAll(/a/g, 'b')).toBe('bbb');
      expect(() => 'aaa'.replaceAll(/a/ as RegExp, 'b')).toThrow(TypeError);
    } finally {
      if (original) String.prototype.replaceAll = original;
    }
  });

  it('keeps the browser implementation when it exists', async () => {
    const mine = String.prototype.replaceAll;
    await import('./polyfills');
    expect(String.prototype.replaceAll).toBe(mine);
  });
});
