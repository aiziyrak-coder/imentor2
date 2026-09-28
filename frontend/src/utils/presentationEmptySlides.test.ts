import { describe, expect, it } from 'vitest';
import { coercePresentationContent, isRealStat } from './presentationContentSchema';

/** 2026-09-24: "1–2 sahifa bor, qolgani bo'sh" — bo'sh key_stat slayd matnini yutib yuborardi. */
describe('bo‘sh raqamli slaydlar', () => {
  it('treats the model placeholder key_stat as no data', () => {
    expect(isRealStat({ number: '0', label: '' })).toBe(false);
    expect(isRealStat({ number: '0', label: 'bemor' })).toBe(false);
    expect(isRealStat({ number: '', label: 'Kasallanish' })).toBe(false);
    expect(isRealStat({ number: '35%', label: 'Kasallanish ulushi' })).toBe(true);
  });

  it('keeps the bullet text of a statistics slide that has no real numbers', () => {
    const deck = coercePresentationContent(
      {
        presentation_title: 'Sanitariya organlari',
        slides: [
          {
            slide_type: 'statistics',
            title: 'Huquqiy asoslar',
            body: {
              bullets: ['Qonunlar va normativ hujjatlar', 'Vakolatlar va nazorat', 'Javobgarlik'],
              stats: [],
              key_stat: { number: '0', label: '' },
            },
          },
        ],
      },
      { title: 'Sanitariya organlari', subject: 'Jamoat salomatligi' },
    );
    const slide = deck.slides.find((s) => s.title === 'Huquqiy asoslar');
    expect(slide).toBeTruthy();
    expect(slide!.slide_type).not.toBe('statistics');
    expect(slide!.body.bullets).toContain('Qonunlar va normativ hujjatlar');
    expect(slide!.body.stats || []).toHaveLength(0);
  });
});
