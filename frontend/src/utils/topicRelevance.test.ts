import { describe, expect, it } from 'vitest';
import { offTopicShare, roughLanguage, topicTerms } from './topicRelevance';

describe('topicRelevance', () => {
  it('ignores generic title words', () => {
    expect(topicTerms('Gigienaning predmeti va vazifalari. Tibbiy ekologiya.')).toEqual(['gigie', 'tibbi', 'ekolo']);
  });

  it('flags patient vignettes that never touch the topic', () => {
    const topic = 'Dinshunoslik fanining predmeti, maqsadi va vazifalari';
    const off = [
      "45 yoshli erkak hansirash va charchoqdan shikoyat qiladi. Qon bosimi 150/95, qaysi dori tanlanadi?",
      "Bemor ayolda qandli diabet bor, metformin qabul qiladi. Keyingi qadam qaysi?",
    ];
    const on = [
      "Dinshunoslik fani dinlarni qaysi usul bilan o'rganadi va bu falsafadan nimasi bilan farq qiladi?",
      "Dinshunoslikning vazifalari orasida jamiyatda bag'rikenglikni ta'minlash qaysi yo'l bilan amalga oshadi?",
    ];
    expect(offTopicShare(topic, off)).toBe(1);
    expect(offTopicShare(topic, on)).toBe(0);
  });

  it('skips the check when the output is in another language', () => {
    const topic = 'Yurak va qon tomir tizimi patofiziologiyasi';
    const en = ['The cardiovascular system is a complex network and the heart pumps blood to the tissues of the body.'];
    expect(offTopicShare(topic, en)).toBeNull();
    expect(roughLanguage('Pathophysiology of the Cardiovascular System', true)).toBe('en');
  });
});
