import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TeacherProfileProvider } from './TeacherProfile';
import TeacherName from './TeacherName';
import type { TeacherDetail } from './rectorApi';

vi.mock('./rectorApi', async (orig) => ({
  ...(await orig<typeof import('./rectorApi')>()),
  fetchTeacherDetail: vi.fn(async () => detail),
}));

const detail = {
  owner_key: '998906308266', display_name: 'Boretskaya Alisa', department: 'Mikrobiologiya', job_title: 'Assistent',
  role: 'hodim', last_login: null, minutes: 95, active_days: 3, total_minutes: 95, from: '2026-09-14', to: '2026-09-18',
  pages: [{ page: 'lectures', minutes: 60, seconds: 3600, opens: 4 }, { page: 'tests', minutes: 35, seconds: 2100, opens: 2 }],
  days: [{ date: '2026-09-15', minutes: 95, pages: [], videos_viewed: 0, handouts_viewed: 0, cases_created: 0, tests_created: 1, live_sessions: 1 }],
  videos_viewed: 0, handouts_viewed: 0, cases_created: 2, tests_created: 1, handouts_created: 0, videos_created: 0,
  presentations_created: 1, live_sessions: 1, online_lessons: 0, students_taught: 24, student_attempts: 24,
  avg_student_score: 74, created_total: 4, lessons_total: 1, is_active: true,
  lessons: [],
  monitor: {
    planned_slots: 2, used_slots: 1, usage_percent: 50,
    slots: [
      { monitor_id: 'MON-029', department: 'Mikro', building: '', room: '', room_full: '106-auditoriya', date: '2026-09-15', weekday: 'Seshanba', para: '1-para', start_time: '08:00', end_time: '09:20', teacher_name: 'Boretskaya Alisa', teacher_key: '998906308266', subject: 'Mikrobiologiya', group: 'DI', lesson_type: '', status: 'Band', planned: true, used: true, student_count: 24 },
    ],
  },
} as unknown as TeacherDetail;

describe('TeacherProfile', () => {
  it('opens the full report of the clicked teacher', async () => {
    render(
      <TeacherProfileProvider filters={{ from: '2026-09-14', to: '2026-09-18' }} onUnauthorized={vi.fn()}>
        <TeacherName teacherKey="998906308266" name="Boretskaya Alisa" />
      </TeacherProfileProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Boretskaya Alisa' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.textContent).toContain('Qaysi modulda necha daqiqa'));
    expect(dialog.textContent).toContain("Ma'ruza");
    expect(dialog.textContent).toContain('60 daq');
    expect(dialog.textContent).toContain('1/2 dars ishlatildi');
    expect(dialog.textContent).toContain('Ishlatildi');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('is plain text without a provider', () => {
    render(<TeacherName teacherKey="x" name="Rasulov Ulug‘bek" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
