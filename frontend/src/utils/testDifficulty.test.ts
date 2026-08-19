import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEST_DIFFICULTY,
  DEFAULT_TEST_QUESTION_COUNT,
  buildTestDifficultyPrompt,
  isTestDifficulty,
  testDifficultyTemperature,
  testExplanationInstruction,
  testStemInstruction,
} from './testDifficulty';

describe('testDifficulty', () => {
  it('defaults to 10 hard questions', () => {
    expect(DEFAULT_TEST_DIFFICULTY).toBe('hard');
    expect(DEFAULT_TEST_QUESTION_COUNT).toBe(10);
  });

  it('accepts only easy/medium/hard', () => {
    expect(isTestDifficulty('medium')).toBe(true);
    expect(isTestDifficulty('oson')).toBe(false);
  });

  it('uses lower temperature for easy (fewer wrong items)', () => {
    expect(testDifficultyTemperature('easy')).toBeLessThan(testDifficultyTemperature('medium'));
    expect(testDifficultyTemperature('medium')).toBeLessThan(testDifficultyTemperature('hard'));
  });

  it('quality rules ban school-level ABG=diagnosis and two correct options', () => {
    const prompt = buildTestDifficultyPrompt('hard');
    expect(prompt).toMatch(/bitta to'g'ri javob/i);
    expect(prompt).toMatch(/OLIY TIBBIY TA'LIM/);
    expect(prompt).toMatch(/PaCO2 60/);
    expect(prompt).toMatch(/QIYIN/);
    expect(prompt).toMatch(/ehtimoliy tashxis/);
  });

  it('every level requires a vignette, not a definition', () => {
    expect(buildTestDifficultyPrompt('easy')).toMatch(/TA'RIF EMAS|TA'RIF/);
    expect(testStemInstruction('easy')).toMatch(/2 qatorlik/);
    expect(testStemInstruction('medium')).toMatch(/2–3 qatorlik/);
    expect(testStemInstruction('hard')).toMatch(/3 zich jumla/);
    expect(testStemInstruction('hard')).toMatch(/ABG=tashxis/);
    expect(testExplanationInstruction('easy')).toMatch(/3-5/);
  });
});
