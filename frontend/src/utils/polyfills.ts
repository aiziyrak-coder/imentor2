/**
 * Eski telefon brauzerlari uchun kichik to'ldirishlar.
 *
 * Institut talabalarining katta qismi eski Android telefonlarda (Chrome 80,
 * Samsung Internet) kiradi. 2026-09-23 da talaba QR bilan testga kirganda
 * butun sahifa "a.replaceAll is not a function" deb yiqilgan edi: `replaceAll`
 * Chrome 85 dan, `AbortSignal.timeout` esa Chrome 103 dan bor. Kod bundan
 * foydalanadi (matn tarjimalari HAR sahifada `replaceAll` chaqiradi), shuning
 * uchun ular shu yerda, ilova yuklanishidan oldin qo'shiladi.
 *
 * Faqat yo'q bo'lsa qo'shiladi — zamonaviy brauzerda hech narsa o'zgarmaydi.
 * Bu fayl `main.tsx` da ENG BIRINCHI import bo'lishi kerak.
 */

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (!String.prototype.replaceAll) {
  Object.defineProperty(String.prototype, 'replaceAll', {
    configurable: true,
    writable: true,
    value: function replaceAll(this: string, search: string | RegExp, replacement: never): string {
      if (search instanceof RegExp) {
        if (!search.global) throw new TypeError('replaceAll must be called with a global RegExp');
        return this.replace(search, replacement);
      }
      return this.replace(new RegExp(escapeForRegExp(String(search)), 'g'), replacement);
    },
  });
}

if (!Object.hasOwn) {
  Object.defineProperty(Object, 'hasOwn', {
    configurable: true,
    writable: true,
    value: (target: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(target, key),
  });
}

function atPolyfill(this: { length: number; [i: number]: unknown }, index: number): unknown {
  const len = this.length;
  const i = Math.trunc(index) || 0;
  const pos = i < 0 ? len + i : i;
  return pos < 0 || pos >= len ? undefined : this[pos];
}

// Typed massivlar ham (`Uint8Array.at`) — pdf.js va rasm kodi ularda chaqiradi.
const typedArrayProto = Object.getPrototypeOf(Int8Array.prototype) as Record<string, unknown>;
for (const proto of [Array.prototype, String.prototype, typedArrayProto] as unknown as Array<Record<string, unknown>>) {
  if (!proto.at) {
    Object.defineProperty(proto, 'at', { configurable: true, writable: true, value: atPolyfill });
  }
}

// `AbortSignal.timeout` — rasm qidirishda so'rov uzoq ketsa uzish uchun ishlatiladi.
if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as { timeout?: unknown }).timeout !== 'function') {
  Object.defineProperty(AbortSignal, 'timeout', {
    configurable: true,
    writable: true,
    value: (ms: number) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('TimeoutError', 'TimeoutError')), ms);
      return controller.signal;
    },
  });
}

// `structuredClone` — Chrome 98 dan. Sinf monitorlari (Chrome 85) da yo'q,
// pdf.js esa ko'p sahifali PDF'da takrorlanuvchi rasmni shu bilan nusxalaydi.
// Sinxron chuqur nusxa: oddiy obyekt, massiv, typed massiv, ArrayBuffer, Map,
// Set, Date. Nusxalab bo'lmaydigan obyekt (ImageBitmap) o'zi qaytariladi.
// `transfer` e'tiborsiz — ko'chirish o'rniga nusxa olinadi, natija bir xil.
if (typeof (globalThis as { structuredClone?: unknown }).structuredClone !== 'function') {
  const cloneDeep = (value: unknown, seen: Map<unknown, unknown>): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof RegExp) return new RegExp(value.source, value.flags);
    if (value instanceof ArrayBuffer) {
      const copy = value.slice(0);
      seen.set(value, copy);
      return copy;
    }
    if (ArrayBuffer.isView(value)) {
      const view = value as unknown as { constructor: new (b: ArrayBuffer) => unknown; buffer: ArrayBuffer; byteOffset: number; byteLength: number };
      const copy = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
      const out = value instanceof DataView ? new DataView(copy) : new view.constructor(copy);
      seen.set(value, out);
      return out;
    }
    if (value instanceof Map) {
      const out = new Map();
      seen.set(value, out);
      value.forEach((v, k) => out.set(cloneDeep(k, seen), cloneDeep(v, seen)));
      return out;
    }
    if (value instanceof Set) {
      const out = new Set();
      seen.set(value, out);
      value.forEach((v) => out.add(cloneDeep(v, seen)));
      return out;
    }
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      seen.set(value, out);
      value.forEach((v, i) => { out[i] = cloneDeep(v, seen); });
      return out;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    seen.set(value, out);
    for (const key of Object.keys(value)) out[key] = cloneDeep((value as Record<string, unknown>)[key], seen);
    return out;
  };
  Object.defineProperty(globalThis, 'structuredClone', {
    configurable: true,
    writable: true,
    value: (value: unknown) => cloneDeep(value, new Map()),
  });
}

// `Promise.withResolvers` — Chrome 119 dan; pdf.js ichida ko'p ishlatiladi.
if (typeof (Promise as { withResolvers?: unknown }).withResolvers !== 'function') {
  Object.defineProperty(Promise, 'withResolvers', {
    configurable: true,
    writable: true,
    value: function withResolvers<T>() {
      let resolve!: (v: T | PromiseLike<T>) => void;
      let reject!: (e?: unknown) => void;
      const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    },
  });
}

export {};
