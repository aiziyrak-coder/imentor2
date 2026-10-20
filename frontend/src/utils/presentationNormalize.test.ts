import { describe, expect, it } from 'vitest';
import { isFillerSlideTitle, normalizePresentationContent } from './presentationContentSchema';

const EMPTY_STAT = { number: '', label: '' };
const text = (title: string, extra: Record<string, unknown> = {}) => ({
  slide_type: 'content_bullets',
  title,
  body: {
    bullets: [
      `${title} haqida birinchi to'liq tushuntiruvchi gap, sababi va oqibati bilan birga yozilgan`,
      `${title} haqida ikkinchi to'liq tushuntiruvchi gap, amaliy misol bilan birga yozilgan`,
    ],
    key_stat: EMPTY_STAT,
    stats: [],
    ...extra,
  },
});
const norm = (slides: unknown[]) =>
  normalizePresentationContent({ presentation_title: 'T', slides } as never, { title: 'T', subject: 'S' });

describe('normalizePresentationContent (prod nuqsonlari, 2026-10-20)', () => {
  it('matnli slayddagi soxta key_stat uni statistika slaydiga aylantirmaydi', () => {
    const out = norm([
      { slide_type: 'title', title: 'T', body: { bullets: [] } },
      text('Ekssudatsiya', { key_stat: { number: '14', label: 'Yakuniy fikrlar' } }),
    ]);
    expect(out.slides[1].slide_type).not.toBe('statistics');
    expect(out.slides[1].body.key_stat).toBeUndefined();
    expect(out.slides[1].body.stats).toBeUndefined();
  });

  it('haqiqiy statistika slaydi saqlanadi', () => {
    const out = norm([
      { slide_type: 'title', title: 'T', body: { bullets: [] } },
      {
        slide_type: 'statistics',
        title: 'Raqamlar',
        body: { bullets: [], stats: [{ number: '45%', label: 'a' }, { number: '12', label: 'b' }], key_stat: EMPTY_STAT },
      },
    ]);
    expect(out.slides[1].slide_type).toBe('statistics');
    expect(out.slides[1].body.stats).toHaveLength(2);
  });

  it("o'rtadagi muqova slaydi oddiy slaydga aylanadi, faqat birinchisi title", () => {
    const out = norm([
      { slide_type: 'title', title: 'T', body: { bullets: [] } },
      { ...text('Ikkinchi qism'), slide_type: 'title' },
      text('Uchinchi'),
    ]);
    expect(out.slides.filter((s) => s.slide_type === 'title')).toHaveLength(1);
    expect(out.slides[1].body.bullets).toHaveLength(2);
  });

  it("mazmunsiz va 'Taqdimot yakuni' / 'Thank you' slaydlari tashlanadi", () => {
    const out = norm([
      { slide_type: 'title', title: 'T', body: { bullets: [] } },
      text('Mexanizm'),
      { slide_type: 'title', title: 'Taqdimot yakuni', body: { bullets: ['Taqdimot yakuni'] } },
      { slide_type: 'content_bullets', title: 'Bo\'sh', body: { bullets: [] } },
      { slide_type: 'title', title: 'Thank You!', body: { bullets: ['Thank You!'] } },
      { slide_type: 'content_bullets', title: '', body: { bullets: [] } },
      { slide_type: 'content_bullets', title: 'Slayd 15', body: { bullets: ['Slayd 15'] } },
      { ...text('Xulosa'), slide_type: 'summary' },
    ]);
    expect(out.slides.map((s) => s.title)).toEqual(['T', 'Mexanizm', 'Xulosa']);
  });

  it('tizimning manbalar slaydi qayta normalizatsiyada saqlanadi', () => {
    const out = norm([
      { slide_type: 'title', title: 'T', body: { bullets: [] } },
      text('Mexanizm'),
      { slide_type: 'references', title: 'Foydalanilgan manbalar', body: { bullets: ['Kitob — 12-bet'] } },
    ]);
    expect(out.slides.at(-1)?.slide_type).toBe('references');
  });

  it('isFillerSlideTitle uch tilda', () => {
    for (const t of ['Taqdimot yakuni', 'Taqdimotni yakunlash', 'E’tiboringiz uchun rahmat!', 'Manbalar', 'End of Presentation', 'Спасибо за внимание', 'Вопросы?'])
      expect(isFillerSlideTitle(t), t).toBe(true);
    for (const t of ['Xulosa', 'Manbalar va ularning tasnifi', 'Yakuniy tashxis mezonlari'])
      expect(isFillerSlideTitle(t), t).toBe(false);
  });
});
