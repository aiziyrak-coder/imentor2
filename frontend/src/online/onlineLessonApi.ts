/** Online portal — video dars va davomat API mijozi. */

import { httpJson } from '../api/httpClient';
import { authHeader } from './onlineAuth';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

type Method = 'GET' | 'POST' | 'DELETE';

function call<T>(path: string, init?: { method?: Method; body?: unknown }): Promise<T> {
  return httpJson<T>(`${apiBaseUrl()}/v1/online${path}`, {
    method: init?.method || 'GET',
    body: init?.body as never,
    headers: authHeader(),
  });
}

export type Lesson = {
  id: number;
  syllabus_id: number;
  subject_name: string;
  variant_label: string;
  topic_code: string;
  topic_title: string;
  group_id: number;
  group_name: string;
  title: string;
  room_name: string;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  is_opened: boolean;
  opened_at: string | null;
  attendance_count: number;
};

export type Attendance = {
  student_id: string;
  student_name: string;
  joined_at: string;
  left_at: string | null;
  total_seconds: number;
  source: string;
};

export type OnlineConfig = { jitsi_domain: string };

export function fetchOnlineConfig(): Promise<OnlineConfig> {
  return httpJson<OnlineConfig>(`${apiBaseUrl()}/v1/online/config/`, { method: 'GET' });
}

export function fetchLessons(syllabusId?: number): Promise<Lesson[]> {
  const q = syllabusId ? `?syllabus_id=${syllabusId}` : '';
  return call(`/teacher/lessons/${q}`);
}

export function createLesson(body: {
  syllabus_id: number;
  variant_label: string;
  topic_code: string;
  group_id: number;
  title?: string;
  scheduled_at?: string | null;
}): Promise<Lesson> {
  return call('/teacher/lessons/', { method: 'POST', body });
}

export function startLesson(id: number): Promise<Lesson> {
  return call(`/teacher/lessons/${id}/start/`, { method: 'POST' });
}

export function endLesson(id: number): Promise<Lesson> {
  return call(`/teacher/lessons/${id}/end/`, { method: 'POST' });
}

export function openTopic(id: number): Promise<Lesson> {
  return call(`/teacher/lessons/${id}/open/`, { method: 'POST' });
}

export function closeTopic(id: number): Promise<Lesson> {
  return call(`/teacher/lessons/${id}/close/`, { method: 'POST' });
}

export function fetchAttendance(id: number): Promise<Attendance[]> {
  return call(`/teacher/lessons/${id}/attendance/`);
}

export function markAttendance(
  id: number,
  studentId: string,
  present: boolean,
  studentName = '',
): Promise<{ student_id: string; present: boolean }> {
  return call(`/teacher/lessons/${id}/attendance/`, {
    method: 'POST',
    body: { student_id: studentId, student_name: studentName, present },
  });
}

/** Talaba xonaga kirdi/chiqdi — davomat uchun. */
export function reportAttendance(roomName: string, event: 'join' | 'leave'): Promise<unknown> {
  return call('/student/attendance/', {
    method: 'POST',
    body: { room_name: roomName, event },
  });
}

/** Guruhlar ro'yxati — dars yaratishda kerak (admin marshruti emas). */
export function fetchMyGroups(): Promise<Array<{ id: number; name: string }>> {
  return call('/teacher/groups/');
}
