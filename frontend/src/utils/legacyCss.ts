/**
 * Eski brauzerlar uchun ranglar.
 *
 * Tailwind v4 barcha ranglarni `oklch(...)` da yozadi — Chrome 111 dan eski
 * brauzer (masalan Windows 7 dagi Chrome 109) buni tushunmaydi va rang
 * butunlay tushib qoladi: 2026-09-18 da o'qituvchida "Ma'ruza matnini
 * yaratish" tugmasi oq fonda oq yozuv bo'lib ko'rinmay qoldi.
 *
 * Build'dan keyin CSS dagi har bir `oklch()` sRGB hex ga o'giriladi.
 * sRGB'dan tashqaridagi ranglar chegaraga siqiladi — ekrandagi farq sezilmaydi.
 */
import type { Plugin } from 'vite';

function toNumber(token: string, percentScale = 1): number {
  const t = token.trim();
  if (t === 'none') return 0;
  if (t.endsWith('%')) return (parseFloat(t) / 100) * percentScale;
  return parseFloat(t);
}

function channel(linear: number): number {
  const v = linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** `oklch(L C H [/ A])` ichidagi matn → `#rrggbb` yoki `#rrggbbaa`. O'girib bo'lmasa — null. */
export function oklchToHex(args: string): string | null {
  const [main, alphaPart] = args.split('/');
  const parts = main.trim().split(/\s+/);
  if (parts.length !== 3 || parts.some((p) => p.includes('var(') || p.includes('calc('))) return null;
  const L = toNumber(parts[0]);
  const C = toNumber(parts[1], 0.4);
  const H = (toNumber(parts[2]) * Math.PI) / 180;
  if ([L, C, H].some((x) => Number.isNaN(x))) return null;

  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  let out = `#${hex2(channel(r))}${hex2(channel(g))}${hex2(channel(bl))}`;
  if (alphaPart !== undefined) {
    const alpha = toNumber(alphaPart);
    if (Number.isNaN(alpha)) return null;
    if (alpha < 1) out += hex2(Math.round(Math.max(0, alpha) * 255));
  }
  return out;
}

export function downlevelOklch(css: string): string {
  return css.replace(/oklch\(([^()]*)\)/g, (whole, args: string) => oklchToHex(args) ?? whole);
}

/** Vite plagini: build natijasidagi CSS fayllarda `oklch()` ni hex ga almashtiradi. */
export function legacyColors(): Plugin {
  return {
    name: 'imentor-legacy-colors',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.css') && typeof file.source === 'string') {
          file.source = downlevelOklch(file.source);
        }
      }
    },
  };
}
