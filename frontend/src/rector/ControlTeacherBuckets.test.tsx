/**
 * O'qituvchilar kesimi (2026-10-09): darsi borlardan nechtasi darsini
 * iMentor'da o'tgan — hammasini, qisman, kirib chiqqan, umuman ochmagan.
 * Har o'qituvchi faqat bitta toifada; tugamagan darslar hisobga kirmaydi.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ControlReport as Report, ControlStudents, ControlTeacher } from './rectorApi';
import ControlReport from './ControlReport';

function teacher(name: string, used: number, lessons: number, state: ControlTeacher['state']): ControlTeacher {
  return {
    teacher_key: name, teacher_name: name, employee_id: '1', linked: true,
    department: 'Normal anatomiya', monitor_lessons: lessons, monitor_used: used,
    monitor_percent: Math.round((100 * used) / lessons), band: 'bad',
    other_lessons: 0, other_used: 0, lessons, students: 0, days: 1, rooms: [], last_used: null,
    proven_lessons: 0, excuse: 'check_room', minutes: 0, active_days: 0, created: {}, created_total: 0,
    top_module: '', depth: 'none', profile_percent: 100, profile_missing: [], subjects_linked: 1,
    material_percent: 100, material_topics: 1, material_empty: 0,
    state, monitor_missed: lessons - used, pending_lessons: name === 'QISMAN Q.' ? 1 : 0,
  } as ControlTeacher;
}

const REPORT = {
  from: '2026-10-09', to: '2026-10-09',
  headline: {
    monitor_lessons: 9, monitor_used: 4, monitor_percent: 44, band: 'warn',
    watched_teachers: 4, idle_teachers: 2, other_lessons: 0, other_used: 0, other_percent: 0,
    unlinked_teachers: 0, total_lessons: 9, blamed_teachers: 0, check_room_teachers: 1,
    on_leave_teachers: 0, offsite_teachers: 0, short_lessons: 1, short_teachers: 1, min_lesson_minutes: 50,
    teachers_used: 2, teacher_percent: 50, partial_missed_lessons: 2,
    teacher_buckets: { full: 1, partial: 1, opened: 1, none: 1, on_leave: 0, unlinked: 0 },
    pending: { lessons: 7, monitor_lessons: 5, teachers: 3, as_of: '2026-10-09T11:46:00+05:00' },
  },
  attention: [], check_room: [], rooms: [],
  room_summary: { rooms: 1, ok: 1, suspect: 0, quiet: 0, suspect_lessons: 0 },
  source: { synced_at: null, lessons: 9, teachers: 4, unlinked_teachers: 0, rooms_without_monitor: 0 },
  daily: [], departments: [],
  teachers: [
    teacher('TOLIQ T.', 2, 2, 'full'), teacher('QISMAN Q.', 2, 4, 'partial'),
    teacher('KIRGAN K.', 0, 2, 'opened'), teacher('OCHMAGAN O.', 0, 1, 'none'),
  ],
  offsite: { count: 0, lessons: 0, used: 0, places_total: 0, places: [], teachers: [] },
  quality: { minutes: 0, worked: 0, viewed: 0, visit: 0, never: 4, no_subject: 0, profile_incomplete: 0, teachers: 4 },
  modules: [], created: {}, created_labels: {},
} as unknown as Report;

const STUDENTS = {
  from: '2026-10-09', to: '2026-10-09', students: [],
  totals: { contingent: 0, tested: 0, matched_to_contingent: 0, attempts: 0, avg_score: 0, coverage: 0, groups_active: 0, groups_total: 0 },
  groups: [],
} as unknown as ControlStudents;

vi.mock('./rectorApi', async (orig) => ({
  ...(await orig<typeof import('./rectorApi')>()),
  fetchControlReport: vi.fn(async () => REPORT),
  fetchControlStudents: vi.fn(async () => STUDENTS),
  fetchControlPeople: vi.fn(async () => ({ metric: '', label: '', total: 0, people: [] })),
}));

async function page() {
  render(<ControlReport filters={{ from: '2026-10-09', to: '2026-10-09' }} onUnauthorized={vi.fn()} />);
  return screen.findByText(/Darsi bor o‘qituvchilar — nechtasi/);
}

describe('O‘qituvchilar kesimi', () => {
  it('to‘rt toifa va o‘qituvchi foizi ko‘rinadi', async () => {
    const title = await page();
    const strip = title.parentElement?.textContent ?? '';
    expect(strip).toContain('Hamma darsini o‘tgan125%');
    expect(strip).toMatch(/Qisman: ba’zi darsini o‘tgan, qolganini o‘tmagan125%/);
    expect(strip).toContain('2 dars o‘tilmay qolgan');
    expect(strip).toMatch(/Dars vaqtida umuman ochmagan125%/);
    expect(screen.getByText('Darsini iMentor’da o‘tgan').parentElement?.textContent).toContain('2 50%');
  });

  it('tugamagan darslar hisobga olinmagani aytiladi', async () => {
    await page();
    const note = screen.getByText(/hali tugamagan/).textContent ?? '';
    expect(note).toContain('11:46');
    expect(note).toContain('5 ta monitorli dars (3 o‘qituvchi)');
  });

  it('qisman o‘tgan o‘qituvchida nechta darsi qolgani yozilgan va filtr ishlaydi', async () => {
    await page();
    expect(screen.getByText('2 darsini o‘tmagan')).toBeInTheDocument();
    expect(screen.getByText('yana 1 dars oldinda')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Qisman o‘tganlar/ }));
    const list = screen.getByText('Monitorli xonada dars o‘tadiganlar').closest('section');
    expect(list?.textContent).toContain('QISMAN Q.');
    expect(list?.textContent).not.toContain('TOLIQ T.');
  });
});
