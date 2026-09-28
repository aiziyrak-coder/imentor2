import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudentProfileProvider } from './StudentProfile';
import StudentName from './StudentName';
import type { StudentDetail } from './rectorApi';

const bucket = (key: string, name: string, percent: number) => ({ key, name, attempts: 1, score: percent / 10, total: 10, minutes: 5, percent, band: percent >= 71 ? 'yaxshi' : 'qoniqarsiz', last_at: null });

const detail: StudentDetail = {
  student_id: '123456789012', display_name: 'Aliyev Vali', has_id: true, from: '2026-09-01', to: '2026-09-17',
  attempts_count: 2, score_sum: 12, score_total: 20, avg_percent: 60, band: 'qoniqarli', minutes: 10,
  first_at: '2026-09-10T08:00:00Z', last_at: '2026-09-12T08:00:00Z', rank: 5, rank_total: 50, best_percent: 80, worst_percent: 40,
  subjects: [bucket('MIK', 'Mikrobiologiya', 80), bucket('ANA', 'Anatomiya', 40)],
  teachers: [bucket('3442000001', 'Boretskaya Alisa', 80)],
  days: [bucket('2026-09-10', '2026-09-10', 80), bucket('2026-09-12', '2026-09-12', 40)],
  attempts: [
    { id: 1, submitted_at: '2026-09-10T08:00:00Z', subject_code: 'MIK', subject_name: 'Mikrobiologiya', topic: 'Bakteriyalar', variant: '', teacher_key: '3442000001', teacher_name: 'Boretskaya Alisa', score: 8, total: 10, percent: 80, band: 'yaxshi', minutes: 5 },
    { id: 2, submitted_at: '2026-09-12T08:00:00Z', subject_code: 'ANA', subject_name: 'Anatomiya', topic: 'Suyaklar', variant: '', teacher_key: '', teacher_name: '', score: 4, total: 10, percent: 40, band: 'qoniqarsiz', minutes: 5 },
  ],
  online: { lessons: 0, minutes: 0, tests: 0, avg_percent: null },
};

vi.mock('./rectorApi', async (orig) => ({
  ...(await orig<typeof import('./rectorApi')>()),
  fetchStudentDetail: vi.fn(async () => detail),
}));

describe('StudentProfile', () => {
  it('opens the full report and filters tests by subject', async () => {
    render(
      <StudentProfileProvider filters={{ from: '2026-09-01', to: '2026-09-17' }} onUnauthorized={vi.fn()}>
        <StudentName studentKey="123456789012" name="Aliyev Vali" />
      </StudentProfileProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Aliyev Vali' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.textContent).toContain('Fanlar bo‘yicha natija'));
    expect(dialog.textContent).toContain('5-o‘rin');
    expect(dialog.textContent).toContain('Barcha testlari (2)');
    fireEvent.click(screen.getByRole('button', { name: 'Anatomiya' }));
    expect(dialog.textContent).toContain('Barcha testlari (1)');
    expect(dialog.textContent).not.toContain('Bakteriyalar');
  });
});
