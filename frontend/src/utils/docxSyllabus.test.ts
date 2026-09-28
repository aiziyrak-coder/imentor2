import { describe, expect, it } from 'vitest';
import { docxBlocks, sectionKind, subjectNameFromDocx, topicsFromDocxBlocks } from './docxSyllabus';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tbl = (rows: string[][]) =>
  `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
const doc = (...parts: string[]) => `<w:document xmlns:w="${W}"><w:body>${parts.join('')}</w:body></w:document>`;

describe('Word ishchi dasturidan mavzular', () => {
  it("ishchi dastur: bo'lim qatorlari turini belgilaydi, adabiyotlar va usullar mavzu bo'lmaydi", () => {
    const blocks = docxBlocks(
      doc(
        tbl([['1.', "Fan ma’lumotlari"], ['Fanning nomi Radiatsion gigiyena', 'Jami yuklama (soat)']]),
        tbl([
          ['5', "Fan mazmuni va mashg‘ulotlar shakli", ''],
          ['', "Ma’ruza (M)", '8'],
          ['', '9-semestr.', ''],
          ['M1', 'Radiatsion gigiyena fanining predmeti', '2'],
          ['M2', 'Atrof muhitning radioaktivligi', '2'],
          ['', "Amaliy mashg‘ulot (A)", '46'],
          ['A1', 'Havoning radioaktivligini aniqlash usuli', '6'],
          ['', 'Jami', '46 soat'],
        ]),
        tbl([['7', "Mustaqil ta’lim (MT)", 'Soat 30'], ['1.', 'Radioaktivlikning ochilish tarixi', '2']]),
        tbl([['11.', "Taʼlim texnologiyalari va metodlari"], ['1', 'Lectures'], ['3', 'seminarlar (mantiqiy fikrlash)'], ['4', 'guruhlarda ishlash']]),
        p('Asosiy adabiyotlar'),
        p('1. Duschanov B.A. Umumiy gigiyena. Darslik. Toshkent 2008'),
      ),
    );
    const { topics } = topicsFromDocxBlocks(blocks);
    expect(topics.map((t) => `${t.id} ${t.title}`)).toEqual([
      'L1 Radiatsion gigiyena fanining predmeti',
      'L2 Atrof muhitning radioaktivligi',
      'A1 Havoning radioaktivligini aniqlash usuli',
      'I1 Radioaktivlikning ochilish tarixi',
    ]);
    expect(subjectNameFromDocx(blocks, 'ISHCHI DASTUR.docx')).toBe('Radiatsion gigiyena');
  });

  it('kalendar reja: tur jadval sarlavhasida yoki oldidagi paragrafda', () => {
    const blocks = docxBlocks(
      doc(
        p('Modulning nomi: Organik kimyo'),
        tbl([['№', 'Ma’ruzalar mavzulari', 'Soatlar hajmi'], ['1', 'Organik kimyo predmeti', '2']]),
        tbl([['№', 'Amaliy mashg’ulot va laboratoriya ishi mavzulari', 'Soat'], ['1', 'Alkan va sikloalkanlar', '4']]),
        p('Mashg‘ulot turi: Mustaqil ta’lim'),
        tbl([['№', 'Mavzular', 'Soat'], ['1', 'Tutashgan arenlar va ularning xossalari', '4']]),
      ),
    );
    const { topics } = topicsFromDocxBlocks(blocks);
    expect(topics.map((t) => `${t.id} ${t.type}`)).toEqual(['L1 lecture', 'A1 practical', 'I1 independent']);
    expect(subjectNameFromDocx(blocks, 'x.docx')).toBe('Organik kimyo');
  });

  it('ikki tilli reja: birinchi kelgan til qoladi, ikkinchisi sanaladi', () => {
    const ru = ['Радиометрические методы исследования', 'Методы исследования радиоактивности воды', 'Способы дезактивации воды'];
    const uz = ['Radiometrik tekshirish usullari', 'Suvning radioaktivligini tekshirish', 'Suvni dezaktivatsiya qilish usullari'];
    const blocks = docxBlocks(
      doc(
        p('Тематический план практических занятий'),
        tbl([['№', '', 'Часы'], ...ru.map((t, i) => [String(i + 1), t, '6'])]),
        p("Amaliy mashg’ulotlar mavzulari"),
        tbl(uz.map((t, i) => [String(i + 1), t, '6'])),
      ),
    );
    const { topics, otherLanguageDropped } = topicsFromDocxBlocks(blocks);
    expect(topics.map((t) => t.title)).toEqual(ru);
    expect(otherLanguageDropped).toBe(3);
  });

  it("jadvalsiz dastur: sarlavha ostidagi raqamlangan qatorlar", () => {
    const blocks = docxBlocks(
      doc(p('Amaliy mashg‘ulotlar mavzulari'), p('1. Mikroskop bilan ishlash qoidasi – 2 soat'), p('2) Hujayra tuzilishi va vazifalari')),
    );
    expect(topicsFromDocxBlocks(blocks).topics.map((t) => t.title)).toEqual([
      'Mikroskop bilan ishlash qoidasi',
      'Hujayra tuzilishi va vazifalari',
    ]);
  });

  it("oddiy so'z yoki mavzu nomi bo'lim deb olinmaydi", () => {
    expect(sectionKind('Lectures')).toBeNull();
    expect(sectionKind('Organik kimyo laboratoriyasida ishni tashkil etish')).toBeNull();
    expect(sectionKind('Practcal classes (P)')).toBe('practical');
    expect(sectionKind('Indepentent work (IW)')).toBe('independent');
    expect(sectionKind('Criteria for assessing students’ knowledge')).toBe('');
  });
});
