import { describe, expect, it } from 'vitest';
import { parseCaseScenario } from './parseCaseScenario';

describe('parseCaseScenario', () => {
  it('reads ### headings as clinical chart rows', () => {
    const parsed = parseCaseScenario(
      '### Bemor\n65 yosh erkak.\n\n### Shikoyatlar\nNafas qisilishi.',
      'uz',
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe('Bemor');
    expect(parsed[0].body).toMatch(/65 yosh/);
    expect(parsed[1].title).toBe('Shikoyatlar');
  });

  it('labels unlabeled 6-paragraph cases', () => {
    const parsed = parseCaseScenario(
      ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].join('\n\n'),
      'uz',
    );
    expect(parsed).toHaveLength(6);
    expect(parsed[0].title).toBe('Bemor');
    expect(parsed[5].title).toBe('Laboratoriya');
  });

  it('keeps a single blob as one block', () => {
    const parsed = parseCaseScenario('Qisqa vaziyat matni.');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('');
    expect(parsed[0].body).toMatch(/Qisqa/);
  });
});
