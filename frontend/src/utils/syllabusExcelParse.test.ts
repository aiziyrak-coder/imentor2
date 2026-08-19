import { describe, expect, it } from 'vitest';

import { parseSyllabusExcel } from './syllabusExcelParse';
import { readXlsxRows } from './xlsxRows';

function zipStore(files: Record<string, string>): ArrayBuffer {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const entries = Object.entries(files);
  for (const [name, text] of entries) {
    const data = enc.encode(text);
    const nameBytes = enc.encode(name);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, p);
    p += part.length;
  }
  return out.buffer;
}

function inline(ref: string, text: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
}

describe('parseSyllabusExcel', () => {
  it('oladi ma\'ruza, amaliy va laboratoriya', () => {
    const rows = [
      ['', 'Ekologiya 6-s BM'],
      ['#', 'Nomi', '', '', '', '', '', '', '', '', 'Mashg\'ul', 'Yuklama'],
      ['1', 'Zamonaviy gigiyena va inson ekologiyasi', '', '', '', '', '', '', '', '', "Ma'ruza", '2'],
      ['2', 'Havo muhiti gigiyenasi', '', '', '', '', '', '', '', '', "Ma'ruza", '2'],
      ['16', "Xonalarning mikroiqlim ko'rsatkichlari", '', '', '', '', '', '', '', '', 'Amaliy', '2'],
      ['24', "Laboratoriya №1 Xonalar mikroiqlimini o'lchash", '', '', '', '', '', '', '', '', 'Laboratori', '4'],
      ['25', 'Laboratoriya №2 Havo tarkibini aniqlash', '', '', '', '', '', '', '', '', 'Laboratoriya', '4'],
    ];
    const parsed = parseSyllabusExcel(rows);
    expect(parsed.skippedLabCount).toBe(0);
    expect(parsed.topics.map((t) => `${t.id}:${t.type}`)).toEqual([
      'L1:lecture',
      'L2:lecture',
      'A1:practical',
      'B1:lab',
      'B2:lab',
    ]);
    expect(parsed.topics[0].title).toContain('Zamonaviy gigiyena');
    expect(parsed.topics.some((t) => /laboratori/i.test(t.title))).toBe(true);
  });

  it("mustaqil ta'limni ham oladi, bir xil nomli ma'ruza va amaliyni ikkalasini saqlaydi", () => {
    const rows = [
      ['Pediatriya ishi 2024-2025 (Milliy) 3-semestr Sog\'lom turmush tarzi'],
      ['#', 'Nomi º', "Mashg'ulot", 'Yuklama', 'Semestr'],
      ['1', 'Valeologiyaga kirish', "Ma'ruza", '2', '3-semestr'],
      ['2', 'Ovqatlanish gigiyenasi', "Ma'ruza", '2', '3-semestr'],
      ['3', 'Valeologiyaga kirish', 'Amaliy', '2', '3-semestr'],
      ['4', 'Mustaqil ish: referat', "Mustaqil ta'lim", '2', '3-semestr'],
      ['5', 'Klinik ko\'rik', "Klinik mashg'ulot", '4', '3-semestr'],
    ];
    const parsed = parseSyllabusExcel(rows);
    expect(parsed.skippedIndependentCount).toBe(0);
    expect(parsed.topics.map((t) => `${t.id}:${t.type}:${t.title}`)).toEqual([
      'L1:lecture:Valeologiyaga kirish',
      'L2:lecture:Ovqatlanish gigiyenasi',
      'A1:practical:Valeologiyaga kirish',
      "K1:clinical:Klinik ko'rik",
      "I1:independent:Mustaqil ish: referat",
    ]);
  });

  it('Seminar qatorlarini amaliy mashg\'ulot qiladi, ma\'ruza emas', () => {
    const rows = [
      ['#', 'Nomi', "Mashg'ulot"],
      ['1', 'Falsafaning mohiyati', "Ma'ruza"],
      ['2', 'Sharq falsafasi', 'Seminar'],
      ['3', 'Ontologiya', 'SEMINAR'],
    ];
    const parsed = parseSyllabusExcel(rows);
    expect(parsed.topics.map((t) => `${t.id}:${t.type}`)).toEqual([
      'L1:lecture',
      'A1:practical',
      'A2:practical',
    ]);
    expect(parsed.topics[1].title).toBe('Sharq falsafasi');
  });

  it('sarlavha ustuni Nomi bo\'lmasa ham ishlaydi', () => {
    const rows = [
      ['Mavzu', 'Turi'],
      ['Yurak yetishmovchiligi', "Ma'ruza"],
      ['EKG tahlili', 'Amaliy'],
    ];
    const parsed = parseSyllabusExcel(rows);
    expect(parsed.topics).toHaveLength(2);
    expect(parsed.topics[1].type).toBe('practical');
  });
});

describe('readXlsxRows + parseSyllabusExcel', () => {
  it('xlsx zip dan mavzularni o\'qiydi va lab ni ham oladi', async () => {
    const sheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="2">${inline('A2', '#')}${inline('B2', 'Nomi')}${inline('K2', "Mashg'ul")}</row>
    <row r="3">${inline('A3', '1')}${inline('B3', 'Zamonaviy gigiyena va inson ekologiyasi')}${inline('K3', "Ma'ruza")}</row>
    <row r="4">${inline('A4', '16')}${inline('B4', "Xonalarning mikroiqlim ko'rsatkichlari")}${inline('K4', 'Amaliy')}</row>
    <row r="5">${inline('A5', '24')}${inline('B5', 'Laboratoriya №1 mikroiqlim')}${inline('K5', 'Laboratori')}</row>
  </sheetData>
</worksheet>`;
    const buffer = zipStore({ 'xl/worksheets/sheet1.xml': sheet });
    const rows = await readXlsxRows(buffer);
    const parsed = parseSyllabusExcel(rows);
    expect(parsed.topics).toHaveLength(3);
    expect(parsed.skippedLabCount).toBe(0);
    expect(parsed.topics[0].type).toBe('lecture');
    expect(parsed.topics[1].type).toBe('practical');
    expect(parsed.topics[2].type).toBe('lab');
  });
});
