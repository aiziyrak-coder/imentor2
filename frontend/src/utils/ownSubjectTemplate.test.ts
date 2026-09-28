import { Blob as NodeBlob } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseSyllabusExcel } from './syllabusExcelParse';
import { readXlsxRows } from './xlsxRows';
import { subjectNameFromRows } from './ownSubjectTemplate';

describe("o'qituvchi yuklab oladigan namuna fayl", () => {
  // xlsx o'quvchi `Blob.stream()` ishlatadi — jsdom'ning Blob'ida u yo'q.
  const jsdomBlob = globalThis.Blob;
  beforeAll(() => {
    globalThis.Blob = NodeBlob as unknown as typeof Blob;
  });
  afterAll(() => {
    globalThis.Blob = jsdomBlob;
  });

  it('brauzer tahlilchisidan fan nomi va barcha mavzular bilan chiqadi', async () => {
    const buf = readFileSync(resolve(__dirname, '../../public/namuna-fan-mavzulari.xlsx'));
    const rows = await readXlsxRows(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const parsed = parseSyllabusExcel(rows, 'namuna-fan-mavzulari.xlsx');

    expect(subjectNameFromRows(rows, 'namuna-fan-mavzulari.xlsx')).toMatch(/^Tibbiy profilaktika ishi/);
    expect(parsed.topics.length).toBeGreaterThanOrEqual(40);
    const types = new Set(parsed.topics.map((t) => t.type));
    expect(types.has('lecture')).toBe(true);
    expect(types.has('independent')).toBe(true);
    const ids = parsed.topics.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('L1');
  });

  it("sarlavha qatori bo'lmasa fayl nomidan oladi", () => {
    expect(subjectNameFromRows([['#', 'Nomi', "Mashg'ulot"]], 'Farmakologiya_5_semestr.xlsx')).toBe(
      'Farmakologiya 5 semestr',
    );
  });
});
