/**
 * Deflate (raw) ochish — sof JavaScript, kutubxonasiz.
 *
 * Brauzerning `DecompressionStream('deflate-raw')` funksiyasi faqat yangi
 * brauzerlarda bor (Chrome 103+, Safari 16.4+). Eski telefon va kompyuter
 * brauzerlarida u yo'q, shu sababli o'qituvchi Excel faylini yuklaganda
 * "faylni o'qib bo'lmadi" xatosi chiqardi va o'z fanini kirita olmasdi
 * (2026-09-23 shikoyatlari). Shu fayl o'sha holat uchun zaxira yo'l.
 *
 * RFC 1951: saqlangan bloklar, qat'iy va dinamik Huffman kodlari.
 */

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

type Huffman = { counts: Int32Array; symbols: Int32Array };

function buildHuffman(lengths: number[] | Uint8Array): Huffman {
  const counts = new Int32Array(16);
  for (const len of lengths) counts[len] += 1;
  counts[0] = 0;
  const offsets = new Int32Array(16);
  for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1] + counts[i - 1];
  const symbols = new Int32Array(lengths.length);
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym];
    if (len) symbols[offsets[len]++] = sym;
  }
  return { counts, symbols };
}

class BitReader {
  private pos = 0;
  private bitBuffer = 0;
  private bitCount = 0;

  constructor(private readonly data: Uint8Array) {}

  bits(need: number): number {
    while (this.bitCount < need) {
      if (this.pos >= this.data.length) throw new Error('inflate: ma’lumot tugadi');
      this.bitBuffer |= this.data[this.pos++] << this.bitCount;
      this.bitCount += 8;
    }
    const value = this.bitBuffer & ((1 << need) - 1);
    this.bitBuffer >>>= need;
    this.bitCount -= need;
    return value;
  }

  /** Bayt chegarasiga qaytadi. Buferda qolgan TO'LIQ baytlar o'qilmagan deb belgilanadi —
   *  aks holda saqlangan (stored) blok noto'g'ri joydan o'qilardi. */
  alignToByte(): void {
    this.pos -= this.bitCount >> 3;
    this.bitBuffer = 0;
    this.bitCount = 0;
  }

  readStored(): Uint8Array {
    this.alignToByte();
    if (this.pos + 4 > this.data.length) throw new Error('inflate: buzuq blok');
    const len = this.data[this.pos] | (this.data[this.pos + 1] << 8);
    this.pos += 4; // uzunlik + uning teskari nusxasi
    const out = this.data.subarray(this.pos, this.pos + len);
    if (out.length !== len) throw new Error('inflate: buzuq blok');
    this.pos += len;
    return out;
  }

  decode(tree: Huffman): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= this.bits(1);
      const count = tree.counts[len];
      if (code - first < count) return tree.symbols[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('inflate: noto’g’ri kod');
  }
}

const FIXED_LITERAL = buildHuffman(
  Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)),
);
const FIXED_DISTANCE = buildHuffman(new Array(30).fill(5));

function readDynamicTrees(reader: BitReader): [Huffman, Huffman] {
  const hlit = reader.bits(5) + 257;
  const hdist = reader.bits(5) + 1;
  const hclen = reader.bits(4) + 4;
  const codeLengths = new Uint8Array(19);
  for (let i = 0; i < hclen; i++) codeLengths[CODE_LENGTH_ORDER[i]] = reader.bits(3);
  const codeTree = buildHuffman(codeLengths);

  const lengths = new Uint8Array(hlit + hdist);
  let i = 0;
  while (i < lengths.length) {
    const sym = reader.decode(codeTree);
    if (sym < 16) {
      lengths[i++] = sym;
    } else if (sym === 16) {
      if (i === 0) throw new Error('inflate: buzuq jadval');
      const prev = lengths[i - 1];
      for (let n = reader.bits(2) + 3; n > 0; n--) lengths[i++] = prev;
    } else if (sym === 17) {
      for (let n = reader.bits(3) + 3; n > 0; n--) lengths[i++] = 0;
    } else {
      for (let n = reader.bits(7) + 11; n > 0; n--) lengths[i++] = 0;
    }
  }
  return [buildHuffman(lengths.subarray(0, hlit)), buildHuffman(lengths.subarray(hlit))];
}

/** Raw deflate (zip ichidagi method=8) ma'lumotini ochadi. */
export function inflateRawJs(data: Uint8Array): Uint8Array {
  const reader = new BitReader(data);
  let out = new Uint8Array(Math.max(1024, data.length * 4));
  let size = 0;

  const push = (byte: number) => {
    if (size === out.length) {
      const bigger = new Uint8Array(out.length * 2);
      bigger.set(out);
      out = bigger;
    }
    out[size++] = byte;
  };

  for (;;) {
    const last = reader.bits(1);
    const type = reader.bits(2);
    if (type === 0) {
      for (const byte of reader.readStored()) push(byte);
    } else if (type === 1 || type === 2) {
      const [literals, distances] = type === 1 ? [FIXED_LITERAL, FIXED_DISTANCE] : readDynamicTrees(reader);
      for (;;) {
        const sym = reader.decode(literals);
        if (sym < 256) {
          push(sym);
        } else if (sym === 256) {
          break;
        } else {
          const idx = sym - 257;
          if (idx >= LENGTH_BASE.length) throw new Error('inflate: noto’g’ri uzunlik');
          const length = LENGTH_BASE[idx] + reader.bits(LENGTH_EXTRA[idx]);
          const dsym = reader.decode(distances);
          const distance = DIST_BASE[dsym] + reader.bits(DIST_EXTRA[dsym]);
          if (distance > size) throw new Error('inflate: noto’g’ri masofa');
          for (let n = 0; n < length; n++) push(out[size - distance]);
        }
      }
    } else {
      throw new Error('inflate: noma’lum blok turi');
    }
    if (last) break;
  }
  return out.subarray(0, size);
}
