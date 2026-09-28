import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRectorPdfHtml, downloadRectorPdf, type RectorPdfData } from './rectorPdf';
import * as api from './rectorApi';
import { renderHtmlToPdf } from '../utils/htmlToPdf';

vi.mock('../utils/htmlToPdf', () => ({ renderHtmlToPdf: vi.fn() }));
vi.mock('./rectorApi', () => ({
  fetchOverview: vi.fn(), fetchTeachers: vi.fn(), fetchDepartments: vi.fn(),
  fetchRisk: vi.fn(), fetchSubjects: vi.fn(), fetchAiUsage: vi.fn(),
}));

const fixture: RectorPdfData = {
  from: '2026-09-01', to: '2026-09-14', department: '',
  overview: {
    from: '2026-09-01', to: '2026-09-14',
    teachers: { total: 0, active: 0, inactive: 0, minutes: 0, avg_minutes: 0,
      cases_created: 0, tests_created: 0, handouts_created: 0, videos_created: 0,
      presentations_created: 0, live_sessions: 0, online_lessons: 0 },
    students: { total: 0, attempts: 0, avg_percent: null, bands: [] },
    online: { attendance_students: 0, attendance_visits: 0, attendance_minutes: 0,
      online_tests_submitted: 0, online_avg_percent: null, malaka_listeners: 0,
      malaka_attempts: 0, malaka_avg_percent: null }, days: [],
  },
  teachers: [], departments: [], risk: null,
  subjects: { from: '2026-09-01', to: '2026-09-14', pass_percent: 56,
    subjects: 17, attempts: 17, pass_rate: 80,
    results: Array.from({ length: 17 }, (_, i) => ({
      subject_code: String(i), subject_name: `Fan-${i + 1}`,
      department: i === 16 ? 'Boshqa kafedra' : 'Terapiya',
      attempts: 1, students: 1, sessions: 1, teachers: 1,
      avg_percent: 80, pass_rate: 80, failed: 0,
    })),
  },
};

describe('rector PDF', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.fetchOverview).mockResolvedValue(fixture.overview);
    vi.mocked(api.fetchTeachers).mockResolvedValue({ count: 0, results: [] });
    vi.mocked(api.fetchDepartments).mockResolvedValue({ results: [] } as unknown as api.DepartmentsResponse);
    vi.mocked(api.fetchRisk).mockResolvedValue(null as unknown as api.RiskReport);
    vi.mocked(api.fetchSubjects).mockResolvedValue(fixture.subjects!);
  });

  it('excludes costs even when a caller supplies legacy AI data', () => {
    const legacy = { ...fixture, ai: { calls: 10, cost_usd: 1234, tokens: 99,
      cached_pct: 50, results: [], prices_note: 'SECRET COST NOTE' } };
    const html = buildRectorPdfHtml(legacy);
    expect(html).not.toMatch(/OpenAI|Taxminiy narx|Jami token|SECRET COST NOTE|\$1234/);
    expect(html).toContain('Rektor hisoboti');
  });

  it('does not claim a healthy institute when no activity or department data exists', () => {
    const html = buildRectorPdfHtml(fixture);
    expect(html).toContain('Baholash uchun ma’lumot yetarli emas');
    expect(html).not.toContain('Institut bo‘yicha holat yaxshi');
  });

  it('includes subjects after the fifteenth row', () => {
    expect(buildRectorPdfHtml(fixture)).toContain('Fan-17');
  });

  it('keeps other departments out of a department PDF', () => {
    const html = buildRectorPdfHtml({ ...fixture, department: 'Terapiya' });
    expect(html).toContain('Fan-16');
    expect(html).not.toContain('Fan-17');
    expect(html).not.toContain('Boshqa kafedra');
  });

  it('downloads without requesting AI usage', async () => {
    await downloadRectorPdf(fixture);
    expect(api.fetchAiUsage).not.toHaveBeenCalled();
    expect(renderHtmlToPdf).toHaveBeenCalledWith(expect.stringContaining('Fan-17'),
      'rektor-hisoboti-2026-09-01_2026-09-14.pdf');
  });

  it('does not save an incomplete PDF when a report fails', async () => {
    vi.mocked(api.fetchRisk).mockRejectedValue(new Error('timeout'));
    await expect(downloadRectorPdf(fixture)).rejects.toThrow('timeout');
    expect(renderHtmlToPdf).not.toHaveBeenCalled();
  });
});
