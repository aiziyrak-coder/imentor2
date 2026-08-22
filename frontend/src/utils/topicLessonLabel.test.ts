import { describe, expect, it } from 'vitest';
import { stripRedundantTopicNumber, topicNumberFromId } from './topicLessonLabel';

describe('stripRedundantTopicNumber', () => {
  it('removes uz prefix matching topic id number', () => {
    expect(stripRedundantTopicNumber('3-mavzu. Chinni anatomiyasi', 'A3')).toBe('Chinni anatomiyasi');
    expect(stripRedundantTopicNumber('1-mavzu. Ortopedik stomatologiyada', 'L1')).toBe(
      'Ortopedik stomatologiyada',
    );
  });

  it('leaves title unchanged when prefix does not match', () => {
    expect(stripRedundantTopicNumber('Ortopedik stomatologiyada', 'L1')).toBe('Ortopedik stomatologiyada');
    expect(stripRedundantTopicNumber('2-mavzu. Boshqa', 'L1')).toBe('2-mavzu. Boshqa');
  });

  it('topicNumberFromId reads trailing digits from codes', () => {
    expect(topicNumberFromId('A10')).toBe(10);
    expect(topicNumberFromId('L3')).toBe(3);
  });
});
