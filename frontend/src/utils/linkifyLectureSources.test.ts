import { describe, expect, it } from 'vitest';
import { citationSearchHref, linkifyLectureSources } from './linkifyLectureSources';

describe('linkifyLectureSources', () => {
  it('kitob iqtibosini giperhavolaga aylantiradi', () => {
    const src =
      'O\'n oltilik tizim. (Manba: "Kompyuter Arxitekturasi", sahifa 68) Keyingi gap.';
    const out = linkifyLectureSources(src);
    expect(out).toContain('](https://www.google.com/search?tbm=bks&q=');
    expect(out).toContain('Kompyuter%20Arxitekturasi');
    expect(out).toContain('(Manba: "Kompyuter Arxitekturasi", sahifa 68)');
  });

  it('mavjud markdown havolani ikki marta o\'ramaydi', () => {
    const src = '[(Manba: Kitob, sahifa 1)](https://example.com/a)';
    expect(linkifyLectureSources(src)).toBe(src);
  });

  it('to\'ldirilmagan shablonni qoldiradi', () => {
    const src = 'Matn (Manba: kitob nomi, sahifa-bet).';
    expect(linkifyLectureSources(src)).toBe(src);
  });

  it('ichidagi URL ni ishlatadi', () => {
    expect(citationSearchHref('Guyton https://doi.org/10.1/abc, sahifa 12')).toBe(
      'https://doi.org/10.1/abc',
    );
  });
});
