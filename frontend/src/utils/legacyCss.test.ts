import { describe, expect, it } from 'vitest';
import { downlevelOklch, oklchToHex } from './legacyCss';

describe('legacy colors', () => {
  it('converts Tailwind palette colors to the same sRGB hex', () => {
    expect(oklchToHex('20.8% .042 265.755')).toBe('#0f172b'); // slate-900 (#0f172a)
    expect(oklchToHex('100% 0 0')).toBe('#ffffff');
    expect(oklchToHex('0% 0 0 / .5')).toBe('#00000080');
  });

  it('rewrites css and leaves variable-based colors alone', () => {
    const css = '--color-slate-900:oklch(20.8% .042 265.755);a{color:oklch(var(--l) .1 20)}';
    expect(downlevelOklch(css)).toBe('--color-slate-900:#0f172b;a{color:oklch(var(--l) .1 20)}');
  });
});
