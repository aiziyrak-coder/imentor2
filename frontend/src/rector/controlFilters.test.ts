import { describe, expect, it } from 'vitest';
import { matches, sortRows, minutesText, type Flag } from './ControlReport';
import type { ControlTeacher } from './rectorApi';

/** Nazorat panelidagi aqlli filtr — rektor bir bosishda kerakli ro'yxatni oladi. */

function teacher(over: Partial<ControlTeacher> = {}): ControlTeacher {
  return {
    teacher_key: 'u1',
    teacher_name: 'AZIZOV A. A.',
    employee_id: '461',
    linked: true,
    department: 'Fiziologiya',
    monitor_lessons: 10,
    monitor_used: 5,
    monitor_percent: 50,
    band: 'warn',
    other_lessons: 2,
    other_used: 0,
    lessons: 12,
    students: 30,
    days: 4,
    rooms: ['204'],
    last_used: '2026-09-24',
    minutes: 60,
    active_days: 3,
    created: { tests: 2 },
    created_total: 2,
    top_module: 'Test',
    depth: 'worked',
    profile_percent: 100,
    profile_missing: [],
    subjects_linked: 2,
    material_percent: 70,
    material_topics: 20,
    material_empty: 6,
    proven_lessons: 8,
    excuse: 'none',
    ...over,
  };
}

const flags: Array<[Flag, Partial<ControlTeacher>]> = [
  ['idle', { monitor_used: 0 }],
  ['nothing', { created_total: 0 }],
  ['nosubject', { subjects_linked: 0 }],
  ['profile', { profile_percent: 60 }],
  ['nomaterial', { material_empty: 3 }],
];

describe('matches', () => {
  it.each(flags)('%s keeps the teacher it names and drops a clean one', (flag, over) => {
    expect(matches(teacher(over), flag)).toBe(true);
    expect(matches(teacher({ material_empty: 0 }), flag)).toBe(false);
  });

  it('never blames a teacher without an iMentor account', () => {
    const t = teacher({ linked: false, created_total: 0, subjects_linked: 0, profile_percent: 0 });
    expect(matches(t, 'nothing')).toBe(false);
    expect(matches(t, 'nosubject')).toBe(false);
    expect(matches(t, 'profile')).toBe(false);
    expect(matches(t, 'all')).toBe(true);
  });
});

describe('sortRows', () => {
  const rows = [
    teacher({ teacher_key: 'a', teacher_name: 'B', monitor_percent: 90, minutes: 10, created_total: 5, lessons: 3 }),
    teacher({ teacher_key: 'b', teacher_name: 'A', monitor_percent: 10, minutes: 90, created_total: 0, lessons: 9 }),
  ];

  it('puts the weakest first for every sort the rector can pick', () => {
    expect(sortRows(rows, 'percent')[0].teacher_key).toBe('b');
    expect(sortRows(rows, 'minutes')[0].teacher_key).toBe('a');
    expect(sortRows(rows, 'created')[0].teacher_key).toBe('b');
    expect(sortRows(rows, 'lessons')[0].teacher_key).toBe('b');
    expect(sortRows(rows, 'name')[0].teacher_name).toBe('A');
  });

  it('leaves the given array untouched', () => {
    const before = rows.map((r) => r.teacher_key);
    sortRows(rows, 'name');
    expect(rows.map((r) => r.teacher_key)).toEqual(before);
  });
});

describe('minutesText', () => {
  it('reads as time, not as a raw number', () => {
    expect(minutesText(0)).toBe('0 daq');
    expect(minutesText(45)).toBe('45 daq');
    expect(minutesText(125)).toBe('2 s 5 daq');
    expect(minutesText(120)).toBe('2 soat');
  });
});
