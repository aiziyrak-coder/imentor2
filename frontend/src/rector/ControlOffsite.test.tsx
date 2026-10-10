/**
 * Monitorsiz joyda dars o'tadiganlar alohida bo'limda (2026-10-06).
 *
 * Rektor shikoyati: hisobotda hamma aralash turibdi, monitorli xonada dars
 * o'tadiganlarning o'zi kerak, qolgani alohida chiqsin.
 *
 * Namuna shu faylning ichida: `src/harness/` serverga yuborilmaydi, undan
 * import qilgan test build'ni yiqitadi.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ControlReport as Report, ControlStudents, ControlTeacher } from './rectorApi';
import ControlReport from './ControlReport';

function teacher(name: string, monitorLessons: number, otherLessons: number): ControlTeacher {
  return {
    teacher_key: name, teacher_name: name, employee_id: '1', linked: true,
    department: 'Yuqumli kasalliklar', monitor_lessons: monitorLessons, monitor_used: 0,
    monitor_percent: monitorLessons ? 0 : null, band: 'none',
    other_lessons: otherLessons, other_used: 0, lessons: monitorLessons + otherLessons,
    students: 0, days: 1, rooms: [], last_used: null, proven_lessons: 0, excuse: 'none',
    minutes: 0, active_days: 0,
    created: { tests: 0, cases: 0, lectures: 0, presentations: 0, handouts: 0, videos: 0, live_sessions: 0 },
    created_total: 0, top_module: '', depth: 'none', profile_percent: 100, profile_missing: [],
    subjects_linked: 1, material_percent: 100, material_topics: 1, material_empty: 0,
  } as ControlTeacher;
}

const REPORT = {
  from: '2026-09-21', to: '2026-09-26',
  headline: {
    monitor_lessons: 10, monitor_used: 3, monitor_percent: 30, band: 'bad',
    watched_teachers: 1, idle_teachers: 0, other_lessons: 46, other_used: 3, other_percent: 7,
    unlinked_teachers: 0, total_lessons: 56, blamed_teachers: 0, check_room_teachers: 0,
    on_leave_teachers: 0, offsite_teachers: 2,
  },
  attention: [], check_room: [], rooms: [],
  room_summary: { rooms: 1, ok: 1, suspect: 0, quiet: 0, suspect_lessons: 0 },
  source: { synced_at: null, lessons: 56, teachers: 3, unlinked_teachers: 0, rooms_without_monitor: 0 },
  daily: [], departments: [],
  teachers: [teacher('NAZAROVA Y. X.', 10, 0)],
  offsite: {
    count: 2, lessons: 46, used: 3, places_total: 37,
    places: [
      { place: 'Online — Online (Masofaviy)', lessons: 28, used: 2, teachers: 1, percent: 7 },
      { place: 'Yuqumli kasalliklar shifoxonasi — D202', lessons: 18, used: 1, teachers: 1, percent: 6 },
    ],
    teachers: [teacher('YULDASHEV A. A.', 0, 28), teacher('SOBIROV D. N.', 0, 18)],
  },
  quality: {
    minutes: 0, worked: 0, viewed: 0, visit: 0, never: 3, no_subject: 0,
    profile_incomplete: 0, teachers: 3,
  },
  modules: [], created: {}, created_labels: {},
} as unknown as Report;

const STUDENTS = {
  from: '2026-09-21', to: '2026-09-26', students: [],
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
  render(<ControlReport filters={{ from: '2026-09-21', to: '2026-09-26' }} onUnauthorized={vi.fn()} />);
  return screen.findByText('Monitorsiz joyda dars o‘tadiganlar');
}

describe('Monitorsiz joy bo‘limi', () => {
  it('asosiy ro‘yxat sarlavhasi monitorli xona ekanini aytadi', async () => {
    await page();
    expect(screen.getByText('Monitorli xonada dars o‘tadiganlar')).toBeInTheDocument();
  });

  it('necha o‘qituvchi va necha dars ekani ko‘rinadi', async () => {
    const head = await page();
    expect(head.parentElement?.textContent).toContain('2 o‘qituvchi');
    expect(head.parentElement?.textContent).toContain('46 dars');
  });

  it('bu darslar asosiy foizga kirmasligi yozilgan', async () => {
    await page();
    expect(screen.getByText(/yuqoridagi foizga KIRMAYDI/)).toBeInTheDocument();
  });

  it('ochilganda qayerda dars o‘tilayotgani chiqadi', async () => {
    const head = await page();
    expect(screen.queryByText(/Online \(Masofaviy\)/)).toBeNull();
    fireEvent.click(head);
    expect(screen.getByText(/Online \(Masofaviy\)/)).toBeInTheDocument();
    expect(screen.getByText('Qayerda dars o‘tilmoqda')).toBeInTheDocument();
  });

  it('ochilganda o‘qituvchilar ham chiqadi', async () => {
    const head = await page();
    fireEvent.click(head);
    expect(screen.getByText('YULDASHEV A. A.')).toBeInTheDocument();
    expect(screen.getByText('SOBIROV D. N.')).toBeInTheDocument();
  });

  it('bu o‘qituvchilar asosiy ro‘yxatda YO‘Q', async () => {
    await page();
    const main = screen.getByText('Monitorli xonada dars o‘tadiganlar').closest('section');
    expect(main?.textContent).not.toContain('YULDASHEV A. A.');
  });
});
