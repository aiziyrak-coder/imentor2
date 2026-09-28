import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LessonReport from './LessonReport';
import * as api from './rectorApi';

vi.mock('./rectorApi', async () => {
  const actual = await vi.importActual<typeof api>('./rectorApi');
  return { ...actual, fetchLessonTeachers: vi.fn(), fetchLessonDepartments: vi.fn(), fetchScheduledLessons: vi.fn() };
});

const filters = { from: '2026-09-21', to: '2026-09-26' };

function teacher(over: Partial<api.LessonTeacherRow> = {}): api.LessonTeacherRow {
  return {
    teacher_key: '3442112018', teacher_name: 'MADOLIMOV A. M.', employee_id: '461', linked: true,
    department: 'Fiziologiya', lessons: 10, used_lessons: 4, with_monitor: 6, students: 30,
    subject_count: 2, group_count: 3, days: 5, used_days: 3, usage_percent: 40, last_used: '2026-09-24',
    ...over,
  };
}

describe('Dars jadvali bo‘yicha nazorat', () => {
  beforeEach(() => {
    vi.mocked(api.fetchLessonDepartments).mockResolvedValue({
      from: filters.from, to: filters.to,
      results: [{ department: 'Fiziologiya', lessons: 10, used_lessons: 4, usage_percent: 40, teachers: 2, active_teachers: 1 }],
    });
    vi.mocked(api.fetchScheduledLessons).mockResolvedValue({ count: 0, results: [] });
  });

  it('o‘qituvchi va kafedra ko‘rsatkichlarini chiqaradi', async () => {
    vi.mocked(api.fetchLessonTeachers).mockResolvedValue({
      from: filters.from, to: filters.to,
      totals: { teachers: 2, linked_teachers: 1, lessons: 15, used_lessons: 4, usage_percent: 27, never_used: 1, with_monitor: 6 },
      results: [teacher(), teacher({ teacher_key: '', teacher_name: 'NOMA’LUM X.', linked: false, lessons: 5, used_lessons: 0, usage_percent: 0 })],
    });
    render(<LessonReport filters={filters} onUnauthorized={() => {}} />);

    expect(await screen.findByText('MADOLIMOV A. M.')).toBeTruthy();
    // Hisobi yo'q o'qituvchi yashirilmaydi — belgilanadi.
    expect(screen.getByText('NOMA’LUM X.')).toBeTruthy();
    expect(screen.getAllByText('iMentor hisobi yo‘q').length).toBe(1);
    // Monitorsiz darslar ham jamida.
    expect(screen.getByText('15')).toBeTruthy();
  });

  it('dars topilmasa tushunarli xabar beradi', async () => {
    vi.mocked(api.fetchLessonTeachers).mockResolvedValue({
      from: filters.from, to: filters.to,
      totals: { teachers: 0, linked_teachers: 0, lessons: 0, used_lessons: 0, usage_percent: 0, never_used: 0, with_monitor: 0 },
      results: [],
    });
    render(<LessonReport filters={filters} onUnauthorized={() => {}} />);
    await waitFor(() => expect(screen.getByText(/dars topilmadi/i)).toBeTruthy());
  });
});
