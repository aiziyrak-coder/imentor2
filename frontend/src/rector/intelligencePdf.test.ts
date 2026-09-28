import { describe, expect, it, vi } from 'vitest';
import { csvCell, intelligenceCsv } from './intelligenceApi';
import { buildIntelligencePdf, intelligencePdfParts } from './intelligencePdf';
import { person, reportFixture } from './intelligenceFixtures.test-helper';
vi.mock('../utils/htmlToPdf', () => ({ renderHtmlDocumentsToPdf: vi.fn() }));
describe('intelligence exports', () => {
  it('escapes names and excludes AI costs', () => {
    const html = buildIntelligencePdf(
      reportFixture,
      [{ ...person(), display_name: '<script>alert(1)</script>' }],
      null,
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/OpenAI|Taxminiy narx/);
  });
  it('exports precisely the selected people in both formats', () => {
    const rows = [person(2)];
    expect(intelligenceCsv(reportFixture, rows)).not.toContain('Ali-1');
    expect(buildIntelligencePdf(reportFixture, rows, null)).not.toContain('Ali-1');
    expect(intelligenceCsv(reportFixture, rows)).toContain('Ali-2');
  });
  it('protects Excel cells against formulas', () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"');
    expect(csvCell('"Ali"')).toBe('"""Ali"""');
  });
  it('bounds canvas fragments and retains all 700 people', () => {
    const rows = Array.from({ length: 700 }, (_, i) => person(i + 1));
    const parts = [...intelligencePdfParts(reportFixture, rows)];
    expect(parts).toHaveLength(28);
    expect(parts[27]).toContain('Ali-700');
    expect(parts[0]).not.toContain('Ali-26');
    expect(parts.join('')).toContain('Qism 28 / 28');
  });
  it('keeps missing results separate from zero', () => {
    const csv = intelligenceCsv(reportFixture, [{ ...person(), avg_student_score: null }]);
    expect(csv).toContain('"10";"";');
    expect(
      buildIntelligencePdf(reportFixture, [{ ...person(), avg_student_score: null }], null),
    ).toContain('10 / —');
  });
});
