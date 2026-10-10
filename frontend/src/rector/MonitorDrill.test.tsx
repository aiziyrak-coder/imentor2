import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MonitorDrill, { slotStatus, teacherUsageStatus } from './MonitorDrill';
import { moduleMinutes, teacherStatus } from './RectorSections';
import type { MonitorReport, MonitorSlot, TeacherRow } from './rectorApi';

const slot = (over: Partial<MonitorSlot>): MonitorSlot => ({
  monitor_id: 'MON-029', department: 'Mikro', building: '', room: '106', room_full: '106-xona',
  date: '2026-09-14', weekday: 'Dushanba', para: '1-para', start_time: '08:00', end_time: '09:20',
  teacher_name: 'Boretskaya Alisa', teacher_key: '998906308266', subject: 'Mikro', group: 'DI',
  lesson_type: 'amaliy', status: 'Band', planned: true, used: false, student_count: 0, ...over,
});

const report: MonitorReport = {
  from: '2026-09-14', to: '2026-09-18', schedule_imported: true,
  source: { inventory: '', checked_on: '' },
  totals: { monitors: 1, planned_slots: 3, used_slots: 1, free_slots: 27, teachers: 2, usage_percent: 33.3 },
  departments: ['Mikro'], imports: [], monitors: [],
  teachers: [
    { teacher_key: 'b', teacher_name: 'Xomidova Moxichehra', department: 'Mikro', planned_slots: 2, used_slots: 0, students: 0, usage_percent: 0, linked: true },
    { teacher_key: 'a', teacher_name: 'Boretskaya Alisa', department: 'Mikro', planned_slots: 1, used_slots: 1, students: 20, usage_percent: 100, linked: true },
  ],
  slots: [slot({ used: true, teacher_name: 'Boretskaya Alisa' }), slot({ teacher_name: 'Xomidova Moxichehra', para: '2-para' })],
};

describe('MonitorDrill', () => {
  it('lists teachers by surname with traffic-light colours', () => {
    render(<MonitorDrill kind="teachers" report={report} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    const names = within(dialog).getAllByText(/Boretskaya Alisa|Xomidova Moxichehra/).map((n) => n.textContent);
    expect(names[0]).toBe('Boretskaya Alisa');
    expect(teacherUsageStatus(report.teachers[0])).toBe('bad');
    expect(teacherUsageStatus(report.teachers[1])).toBe('good');
  });

  it('shows only used slots for the used card and closes on Escape', () => {
    const onClose = vi.fn();
    render(<MonitorDrill kind="used" report={report} onClose={onClose} />);
    expect(screen.queryByText('Xomidova Moxichehra')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('slot status: used green, missed red, future grey', () => {
    expect(slotStatus(slot({ used: true }), '2026-09-17').status).toBe('good');
    expect(slotStatus(slot({}), '2026-09-17').status).toBe('bad');
    expect(slotStatus(slot({ date: '2026-09-18' }), '2026-09-17').status).toBe('none');
  });
});

describe('teacher module minutes', () => {
  it('groups pages into modules', () => {
    const mm = moduleMinutes([
      { page: 'lectures', minutes: 12, seconds: 0, opens: 1 },
      { page: 'my-tests', minutes: 3, seconds: 0, opens: 1 },
      { page: 'tests', minutes: 4, seconds: 0, opens: 1 },
      { page: 'profile', minutes: 2, seconds: 0, opens: 1 },
    ]);
    expect(mm.lectures).toBe(12);
    expect(mm.tests).toBe(7);
    expect(mm.other).toBe(2);
  });

  it('status: not active red, only logged in yellow, worked green', () => {
    const base = { is_active: true, lessons_total: 0, created_total: 0 } as TeacherRow;
    expect(teacherStatus({ ...base, is_active: false })).toBe('bad');
    expect(teacherStatus(base)).toBe('warn');
    expect(teacherStatus({ ...base, lessons_total: 1 })).toBe('good');
  });
});
