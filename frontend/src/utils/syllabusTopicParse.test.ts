import { describe, expect, it } from 'vitest';

import { normalizeSyllabusTopics } from './syllabusTopicParse';

const topic = (id: string, title: string) =>
  ({ id, title, type: 'lecture' }) as const;

/** `normalizeSyllabusTopics` zaif/buzuq sarlavhalarni filtrlaydi. */
function titlesAfterNormalize(...titles: string[]): string[] {
  return normalizeSyllabusTopics(
    titles.map((t, i) => ({ ...topic(`M${i + 1}`, t) })),
  ).map((t) => t.title);
}

describe('normalizeSyllabusTopics — buzuq matnni filtrlash', () => {
  it('drops topics from a broken PDF text layer', () => {
    const junk = [
      'N J4 -v ? qt .iO lcg q L & t i; .r4 tin n> >\' O ) =.Y4 a,4d',
      "-.6 ol .FP >l Z.e =F e€ J € s Et E F :E f H <: 6 L' ;E $ E",
      'v OE ?& F F ti F= r -e (g F o F',
      'rr.)l E e -g $ EN A r C.ll -c) h c(|) tl q =>l td ol Eg',
    ];
    expect(titlesAfterNormalize(...junk)).toEqual([]);
  });

  it('keeps real topic titles', () => {
    const good = [
      'Fiziologiya fanining asosiy tushunchalari.',
      'Mushaklar, asab tolalari va sinapslaming fiziologiyasi.',
      'Спирометрия. Дыхательная гимнастика.',
      'Physiology of the excretory system. Functions of the kidneys.',
    ];
    expect(titlesAfterNormalize(...good)).toEqual(good);
  });

  it('keeps short-but-real titles containing an abbreviation', () => {
    expect(titlesAfterNormalize('EKG tahlili asoslari')).toEqual(['EKG tahlili asoslari']);
  });

  it('preserves clinical topic ids as K*', () => {
    const out = normalizeSyllabusTopics([
      { id: 'K1', title: 'Klinik ko\'rik va bemor bilan ishlash', type: 'clinical' },
    ]);
    expect(out).toEqual([
      { id: 'K1', title: 'Klinik ko\'rik va bemor bilan ishlash', type: 'clinical' },
    ]);
  });
});
