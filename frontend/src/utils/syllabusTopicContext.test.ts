import { describe, expect, it } from 'vitest';
import {
  isStructuredTopicNorm,
  topicNormForStorage,
  topicNormLookupKeys,
  type SyllabusTopicContext,
} from './syllabusTopicContext';

const ctx = (over: Partial<SyllabusTopicContext> = {}): SyllabusTopicContext => ({
  id: 'M1',
  title: 'Kirish',
  type: 'lecture',
  syllabusId: 12,
  subjectName: 'Fiziologiya',
  subjectCode: 'fiz',
  variantLabel: 'Asosiy',
  instructionLanguage: 'uz',
  ...over,
});

describe('topicNormLookupKeys', () => {
  it('returns only structured keys, never the topic title', () => {
    const keys = topicNormLookupKeys(ctx());
    expect(keys).toContain('12::asosiy::m1');
    expect(keys.every((k) => !k.includes('kirish'))).toBe(true);
  });

  it('does not look up by bare title string', () => {
    expect(topicNormLookupKeys('Kirish')).toEqual([]);
  });

  it('accepts structured string keys', () => {
    expect(isStructuredTopicNorm('12::asosiy::m1')).toBe(true);
    expect(isStructuredTopicNorm('12::asosiy::kirish')).toBe(false);
    expect(topicNormLookupKeys('12::PI::L2')).toEqual(['12::pi::l2']);
  });

  it('topicNormForStorage lowercases variant and code', () => {
    expect(topicNormForStorage(ctx({ variantLabel: 'PI', id: 'A12' }))).toBe('12::pi::a12');
  });
});
