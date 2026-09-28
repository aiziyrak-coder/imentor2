import { describe, expect, it } from 'vitest';
import { buildTopicContext, caseToText } from './onlineGenerate';
import type { Material } from './onlineTeacherApi';

/**
 * Onlayn portalda mavzu materiallari AI'ga kontekst bo'lib boradi. Ilgari unga
 * HAR fanda "qaysi dori, qaysi doza" degan klinik ko'rsatma qo'shilardi.
 */

const lecture = [{ kind: 'lecture', payload: { text: 'Yurak kameralari va klapanlari.' } }] as unknown as Material[];

describe('buildTopicContext', () => {
  it('klinik fanda klinik daraja', async () => {
    const ctx = await buildTopicContext(lecture, 'clinical');
    expect(ctx).toMatch(/qaysi dori/);
  });

  it('bemorsiz fanda dori-doza talabi yo‘q, bemor kartasi taqiqlangan', async () => {
    const ctx = await buildTopicContext(lecture, 'biomedical');
    expect(ctx).not.toMatch(/qaysi dori/);
    expect(ctx).toMatch(/bemor kartasi/);
    expect(ctx).toContain('Yurak kameralari');
  });

  it('tibbiyotdan tashqari fanda tibbiy talab umuman yo‘q', async () => {
    const ctx = await buildTopicContext(lecture, 'academic');
    expect(ctx).not.toMatch(/dori, qaysi doza|6-kurs/);
    expect(ctx).toMatch(/ISHLATILMASIN/);
  });

  it('material bo‘lmasa kontekst bo‘sh', async () => {
    expect(await buildTopicContext([], 'academic')).toBe('');
  });
});

describe('caseToText', () => {
  it('sarlavha domenga mos: bemorsiz fanda "Tashxis" emas', () => {
    const session = {
      topic: 'x',
      domain: 'academic',
      questions: [{ focus: 'tashxis', scenario: 'S', answer: 'A' }],
    } as never;
    const clinical = { ...(session as object), domain: 'clinical' } as never;
    expect(caseToText(clinical)).toContain('### Tashxis');
    expect(caseToText(session)).not.toContain('### Tashxis');
  });
});
