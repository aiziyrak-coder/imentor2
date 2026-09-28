import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MonitorExplorer from './MonitorExplorer';
import type { MonitorReport, MonitorRow, MonitorSlot } from './rectorApi';

const mon = (id: string, planned: number, used: number, room: string): MonitorRow => ({
  monitor_id: id, department: 'Mikro', building: '', room, room_full: room, inventory_row: null,
  planned_slots: planned, used_slots: used, free_slots: 30 - planned,
  usage_percent: planned ? Math.round((used * 100) / planned) : null, teacher_count: planned ? 1 : 0, students: 0,
});

const slot = (id: string, over: Partial<MonitorSlot>): MonitorSlot => ({
  monitor_id: id, department: 'Mikro', building: '', room: '', room_full: '', date: '2026-09-14', weekday: 'Dushanba',
  para: '1-para', start_time: '08:00', end_time: '09:20', teacher_name: '', teacher_key: '', subject: '', group: '',
  lesson_type: '', status: 'Bo‘sh', planned: false, used: false, student_count: 0, ...over,
});

const report = {
  from: '2026-09-14', to: '2026-09-18', schedule_imported: true, source: { inventory: '', checked_on: '' },
  totals: { monitors: 3, planned_slots: 2, used_slots: 1, free_slots: 0, teachers: 1, usage_percent: 50 },
  departments: [], imports: [], teachers: [],
  monitors: [mon('MON-1', 1, 1, '101-xona'), mon('MON-2', 1, 0, '102-xona'), mon('MON-3', 0, 0, '103-xona')],
  slots: [
    slot('MON-1', { planned: true, used: true, teacher_name: 'Boretskaya Alisa', subject: 'Mikrobiologiya' }),
    slot('MON-2', { planned: true, teacher_name: 'Rasulov Ulug‘bek', subject: 'Immunologiya' }),
  ],
} as MonitorReport;

describe('MonitorExplorer', () => {
  it('shows scheduled monitors as cards and hides unscheduled ones in a collapsed list', () => {
    render(<MonitorExplorer report={report} today="2026-09-17" />);
    expect(screen.getByText('101-xona')).toBeTruthy();
    expect(screen.queryByText('103-xona')).toBeNull();
    fireEvent.click(screen.getByText('Bandlik jadvali yuklanmagan monitorlar'));
    expect(screen.getByText('103-xona')).toBeTruthy();
  });

  it('filters by status chip and searches by teacher', () => {
    render(<MonitorExplorer report={report} today="2026-09-17" />);
    fireEvent.click(screen.getByText('Past'));
    expect(screen.queryByText('101-xona')).toBeNull();
    expect(screen.getByText('102-xona')).toBeTruthy();
    fireEvent.click(screen.getByText('Hammasi'));
    fireEvent.change(screen.getByPlaceholderText(/Monitor ID/), { target: { value: 'boretskaya' } });
    expect(screen.getByText('101-xona')).toBeTruthy();
    expect(screen.queryByText('102-xona')).toBeNull();
  });

  it('opens the weekly schedule of a monitor', () => {
    render(<MonitorExplorer report={report} today="2026-09-17" />);
    fireEvent.click(screen.getByText('102-xona'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getAllByText('Rasulov Ulug‘bek').length).toBeGreaterThan(0);
    expect(screen.getByText('Ishlatilmadi', { selector: 'span' })).toBeTruthy();
  });
});

describe('MonitorExplorer upcoming schedules', () => {
  it('separates monitors whose schedule starts later from ones with no schedule', () => {
    const later = { ...mon('MON-4', 0, 0, '104-xona'), schedule_from: '2026-09-21' };
    render(<MonitorExplorer report={{ ...report, monitors: [...report.monitors, later] }} today="2026-09-17" />);
    fireEvent.click(screen.getByText('Jadvali keyinroq kuchga kiradigan monitorlar'));
    expect(screen.getByText('104-xona')).toBeTruthy();
    expect(screen.getByText('21.09 dan')).toBeTruthy();
    expect(screen.queryByText('103-xona')).toBeNull();
  });
});
