import { get } from './rectorApi';

/**
 * Monitorli xonalar: bitta kun, har bir dars bo'yicha alohida javob.
 *
 * Alohida fayl: `rectorApi.ts` ni bir vaqtda ikki ish o'zgartirmasin.
 */

export type MonitorDayLesson = {
  lesson_id: number;
  time: string;
  para: string;
  monitor_id: string;
  room: string;
  hemis_room: string;
  building: string;
  teacher_key: string;
  teacher_name: string;
  department: string;
  faculty: string;
  subject: string;
  lesson_type: string;
  groups: string[];
  minutes: number;
  required_minutes: number;
  students: number;
  decision: 'full' | 'proved' | 'short' | 'blamed' | 'check_room' | 'dead_room' | 'pending' | 'unlinked' | 'on_leave';
  reason: string;
  topic: string;
  topic_id?: string;
  syllabus: string;
  index: number | null;
  total: number;
  note: string;
  pages: { page: string; seconds: number; opens: number }[];
  first_event: string | null;
  last_event: string | null;
  event_count: number;
};

export type MonitorDayTeacher = {
  teacher_key: string;
  teacher_name: string;
  department: string;
  faculty: string;
  lessons: MonitorDayLesson[];
  full: number;
  short: number;
  none: number;
  minutes: number;
};

export type MonitorDayRoom = {
  monitor_id: string;
  room: string;
  department: string;
  lessons: number;
  full: number;
  minutes: number;
  state: 'alive' | 'touched' | 'quiet' | 'dead';
};

export type BrokenRoom = {
  monitor_id: string;
  room: string;
  department: string;
  /** Oxirgi `days` kun ichida shu xonadagi darslar soni. */
  lessons: number;
  teachers: number;
  days: number;
  /** Bugun shu xonada nechta dars foizdan chiqarildi. */
  today: number;
};

export type MonitorDayReport = {
  day: string;
  now: string;
  required_minutes: number;
  headline: {
    lessons: number;
    full: number;
    percent: number | null;
    short: number;
    blamed: number;
    check_room: number;
    pending: number;
    unlinked: number;
    on_leave: number;
    dead_room: number;
    teachers: number;
    rooms: number;
    quiet_rooms: number;
    no_syllabus: number;
  };
  filters: {
    faculties: string[];
    departments: string[];
    monitors: { monitor_id: string; room: string }[];
    applied: { faculty: string; department: string; monitor_id: string; teacher: string };
  };
  rooms: MonitorDayRoom[];
  broken_rooms: BrokenRoom[];
  teachers: MonitorDayTeacher[];
  lessons: MonitorDayLesson[];
};

export type MonitorDayFilters = {
  day: string;
  faculty?: string;
  department?: string;
  monitor?: string;
  teacher?: string;
};

export function fetchMonitorDay(f: MonitorDayFilters): Promise<MonitorDayReport> {
  const params = new URLSearchParams();
  params.set('day', f.day);
  if (f.faculty) params.set('faculty', f.faculty);
  if (f.department) params.set('department', f.department);
  if (f.monitor) params.set('monitor', f.monitor);
  if (f.teacher) params.set('teacher', f.teacher);
  return get(`/monitor-day/?${params.toString()}`);
}
