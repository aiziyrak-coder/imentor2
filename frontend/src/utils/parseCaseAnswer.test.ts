import { describe, expect, it } from 'vitest';
import { parseCaseAnswer } from './parseCaseAnswer';

const SAMPLE = `a) Klinik tashxis va asoslanishi
Asosiy tashxis pyelonefrit [5].

b) Differensial tashxis
Sistit rad etiladi [11].

FOYDALANILGAN ADABIYOTLAR:
[5] Smith Urology
[11] PubMed: https://pubmed.ncbi.nlm.nih.gov/1`;

describe('parseCaseAnswer', () => {
  it('splits a–e sections and bibliography', () => {
    const parsed = parseCaseAnswer(SAMPLE);
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0].key).toBe('a');
    expect(parsed.sections[0].title).toMatch(/Klinik tashxis/i);
    expect(parsed.sections[0].body).toMatch(/pyelonefrit/);
    expect(parsed.bibliography).toMatch(/\[5\]/);
    expect(parsed.leftover).toBe('');
  });

  it('splits heading-only sections without a–e letters', () => {
    const parsed = parseCaseAnswer(`Klinik xulosa
Asosiy tashxis pyelonefrit [5].

Differensial tahlil
Sistit rad etiladi.

FOYDALANILGAN ADABIYOTLAR:
[5] Smith Urology`);
    expect(parsed.sections[0].key).toBe('a');
    expect(parsed.sections[0].title).toMatch(/Klinik xulosa/i);
    expect(parsed.sections[1].key).toBe('b');
    expect(parsed.bibliography).toMatch(/\[5\]/);
  });

  it('keeps plain text as leftover when no section markers', () => {
    const parsed = parseCaseAnswer('Oddiy yechim matni.');
    expect(parsed.sections).toHaveLength(0);
    expect(parsed.leftover).toBe('Oddiy yechim matni.');
  });
});
