import { describe, expect, it } from 'vitest';
import { ensureHandoutPackFilled, normalizeHandoutPack, pickHandoutText } from './handoutInfographic';
import { inferTopicScene, sceneForSection } from './handoutScenes';

describe('normalizeHandoutPack', () => {
  it('fills missing translations from uz and keeps 3 languages', () => {
    const pack = normalizeHandoutPack({
      title: { uz: 'Sariqlik sindromi' },
      sections: [
        { id: 'definition', heading: { uz: "Ta'rif" }, points: [{ uz: 'Bilirubin oshadi' }] },
        { id: 'etiology', heading: 'Etiologiya', points: ['Virusli gepatit'] },
        { id: 'treatment', heading: { uz: 'Davolash', ru: 'Лечение' }, points: [] },
        { id: 'prevention', heading: { uz: 'Reabilitatsiya' }, cards: [{ title: { uz: 'Dieta' }, points: [{ uz: 'Tuzni kamaytirish' }] }] },
      ],
    }, 'Sariqlik sindromi');
    expect(pack.title.ru).toBe('Sariqlik sindromi');
    expect(pack.title.en).toBe('Sariqlik sindromi');
    expect(pack.sections).toHaveLength(8);
    expect(pack.sections.map((s) => s.id)).toEqual([
      'definition',
      'etiology',
      'pathogenesis',
      'pathomorphology',
      'clinical',
      'differential',
      'treatment',
      'prevention',
    ]);
    expect(pickHandoutText(pack.sections[6].heading, 'ru')).toBe('Лечение');
    expect(pack.sections[7].cards[0].title.uz).toContain('Dieta');
    expect(pack.heroScene).toBe('liver');
  });

  it('bo\'sh AI javobida ham 8 bo\'limni to\'ldiradi', () => {
    const pack = ensureHandoutPackFilled(normalizeHandoutPack({}, 'Urug\'lanish'), 'Urug\'lanish');
    expect(pack.title.uz).toContain('Urug');
    expect(pack.sections).toHaveLength(8);
    expect(pack.sections.every((s) => s.lead.uz.length > 10 || s.points.length > 0)).toBe(true);
  });

  it('picks urinary art for urethritis-type topics', () => {
    expect(inferTopicScene('Uretrit, orxit va epididimit')).toBe('urinary');
    expect(sceneForSection('definition', 'urinary')).toBe('urinary');
    expect(sceneForSection('etiology', 'urinary')).toBe('infection');
  });
});

describe('poster bo‘limlari fanga mos (2026-09-26)', () => {
  it('tibbiyotdan tashqari fanda "Patogenez" va "Davolash" yo‘q, rasm neytral', () => {
    const pack = ensureHandoutPackFilled(normalizeHandoutPack({}, 'Qonunchilik asoslari', 'academic'), 'Qonunchilik asoslari', 'academic');
    const headings = pack.sections.map((s) => s.heading.uz).join(' | ');
    expect(headings).not.toMatch(/Patogenez|Davolash|Etiologiya|Klinik/);
    expect(pack.sections.every((s) => s.scene === 'default')).toBe(true);
    expect(pack.heroScene).toBe('default');
    const text = JSON.stringify(pack);
    expect(text).not.toMatch(/Bemor|bemor|qizil bayroq|Qizil bayroq/);
  });

  it('bemorsiz tibbiy fanda klinik ahamiyati bor, davolash rejimi yo‘q', () => {
    const pack = ensureHandoutPackFilled(normalizeHandoutPack({}, 'Hujayra membranasi', 'biomedical'), 'Hujayra membranasi', 'biomedical');
    const headings = pack.sections.map((s) => s.heading.uz).join(' | ');
    expect(headings).toMatch(/Klinik ahamiyati/);
    expect(headings).not.toMatch(/Davolash usullari/);
  });

  it('klinik fanda eski 8 bo‘lim o‘zgarmadi', () => {
    const pack = ensureHandoutPackFilled(normalizeHandoutPack({}, 'Pnevmoniya'), 'Pnevmoniya');
    expect(pack.sections.map((s) => s.heading.uz)).toContain('Davolash usullari');
  });
});
