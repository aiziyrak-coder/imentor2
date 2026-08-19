import { describe, expect, it } from 'vitest';
import { normalizeHandoutPack, pickHandoutText } from './handoutInfographic';
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

  it('picks urinary art for urethritis-type topics', () => {
    expect(inferTopicScene('Uretrit, orxit va epididimit')).toBe('urinary');
    expect(sceneForSection('definition', 'urinary')).toBe('urinary');
    expect(sceneForSection('etiology', 'urinary')).toBe('infection');
  });
});
