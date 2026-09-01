/**
 * Online ta'lim moduli API mijozi.
 *
 * Modul mavjud iMentor'dan butunlay alohida: alohida jadvallar, alohida
 * `/v1/online/...` marshrutlari. Shu sababli bu fayl ham alohida turadi va
 * mavjud API yordamchilariga tegmaydi.
 */

import { httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

function url(path: string): string {
  return `${apiBaseUrl()}/v1/online${path}`;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function call<T>(
  path: string,
  init?: { method?: HttpMethod; body?: unknown },
): Promise<T> {
  return httpJson<T>(url(path), {
    method: init?.method || 'GET',
    body: init?.body as never,
    headers: { Authorization: `Bearer ${getBackendAccessToken() || ''}` },
  });
}

/* ---------------- turlar ---------------- */

export type OnlineTopic = {
  code: string;
  title: string;
  type?: string;
  hours?: number;
};

export type OnlineVariant = {
  label: string;
  file_name: string;
  topics: OnlineTopic[];
};

export type OnlineSyllabusBrief = {
  id: number;
  subject_name: string;
  subject_code: string;
  department_name: string;
  instruction_language: string;
  topic_count: number;
  variant_labels: string[];
  is_active: boolean;
};

export type OnlineSyllabusFull = OnlineSyllabusBrief & {
  description: string;
  file_name: string;
  topics: OnlineTopic[];
  variants: OnlineVariant[];
  sort_order: number;
};

export type OnlineCourseLink = {
  id: number;
  syllabus_id: number;
  subject_name: string;
  variant_label: string;
};

export type OnlineTeacher = {
  id: number;
  owner_key: string;
  full_name: string;
  is_active: boolean;
  courses: OnlineCourseLink[];
};

export type OnlineGroup = {
  id: number;
  name: string;
  is_active: boolean;
  courses: OnlineCourseLink[];
};

export type OnlineOverview = {
  syllabuses: number;
  teachers: number;
  groups: number;
  materials: number;
  lessons: number;
  opened_topics: number;
  tests_submitted: number;
};

export type OnlineLessonRow = {
  id: number;
  subject_name: string;
  variant_label: string;
  topic_code: string;
  topic_title: string;
  group_name: string;
  teacher_owner_key: string;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  is_opened: boolean;
  attendance_count: number;
};

export type OnlineProgressRow = {
  student_id: string;
  student_name: string;
  group_name: string;
  subject_name: string;
  variant_label: string;
  topic_code: string;
  topic_title: string;
  test_score: number;
  test_total: number;
  test_submitted_at: string | null;
  updated_at: string;
};

export type OnlineAttendanceRow = {
  student_id: string;
  student_name: string;
  joined_at: string;
  left_at: string | null;
  total_seconds: number;
  source: string;
};

/* ---------------- admin: sillabus ---------------- */

export function fetchOnlineSyllabuses(): Promise<OnlineSyllabusBrief[]> {
  return call('/admin/syllabuses/');
}

export function fetchOnlineSyllabus(id: number): Promise<OnlineSyllabusFull> {
  return call(`/admin/syllabuses/${id}/`);
}

export function createOnlineSyllabus(body: {
  subject_name: string;
  department_name?: string;
  description?: string;
  instruction_language?: string;
  file_name?: string;
  topics?: OnlineTopic[];
  variants?: OnlineVariant[];
}): Promise<OnlineSyllabusFull> {
  return call('/admin/syllabuses/', { method: 'POST', body });
}

export function updateOnlineSyllabus(
  id: number,
  body: Record<string, unknown>,
): Promise<OnlineSyllabusFull> {
  return call(`/admin/syllabuses/${id}/`, { method: 'PATCH', body });
}

export function deleteOnlineSyllabus(id: number): Promise<void> {
  return call(`/admin/syllabuses/${id}/`, { method: 'DELETE' });
}

/* ---------------- admin: o'qituvchi ---------------- */

export function fetchOnlineTeachers(): Promise<OnlineTeacher[]> {
  return call('/admin/teachers/');
}

export function addOnlineTeacher(ownerKey: string, fullName = ''): Promise<OnlineTeacher> {
  return call('/admin/teachers/', {
    method: 'POST',
    body: { owner_key: ownerKey, full_name: fullName, is_active: true },
  });
}

export function removeOnlineTeacher(id: number): Promise<void> {
  return call(`/admin/teachers/${id}/`, { method: 'DELETE' });
}

export function assignTeacherCourse(
  teacherId: number,
  syllabusId: number,
  variantLabel = '',
): Promise<{ id: number; created: boolean }> {
  return call('/admin/teacher-courses/', {
    method: 'POST',
    body: { teacher_id: teacherId, syllabus_id: syllabusId, variant_label: variantLabel },
  });
}

export function unassignTeacherCourse(id: number): Promise<void> {
  return call(`/admin/teacher-courses/${id}/`, { method: 'DELETE' });
}

/* ---------------- admin: guruh ---------------- */

export function fetchOnlineGroups(): Promise<OnlineGroup[]> {
  return call('/admin/groups/');
}

export function addOnlineGroup(name: string): Promise<OnlineGroup> {
  return call('/admin/groups/', { method: 'POST', body: { name, is_active: true } });
}

export function removeOnlineGroup(id: number): Promise<void> {
  return call(`/admin/groups/${id}/`, { method: 'DELETE' });
}

export function assignGroupCourse(
  groupId: number,
  syllabusId: number,
  variantLabel = '',
): Promise<{ id: number; created: boolean }> {
  return call('/admin/group-courses/', {
    method: 'POST',
    body: { group_id: groupId, syllabus_id: syllabusId, variant_label: variantLabel },
  });
}

export function unassignGroupCourse(id: number): Promise<void> {
  return call(`/admin/group-courses/${id}/`, { method: 'DELETE' });
}

/* ---------------- admin: hisobotlar ---------------- */

export function fetchOnlineOverview(): Promise<OnlineOverview> {
  return call('/admin/overview/');
}

export function fetchOnlineLessons(limit = 100): Promise<OnlineLessonRow[]> {
  return call(`/admin/lessons/?limit=${limit}`);
}

export function fetchOnlineProgress(params: {
  syllabusId?: number;
  groupName?: string;
} = {}): Promise<OnlineProgressRow[]> {
  const q = new URLSearchParams();
  if (params.syllabusId) q.set('syllabus_id', String(params.syllabusId));
  if (params.groupName) q.set('group_name', params.groupName);
  const qs = q.toString();
  return call(`/admin/progress/${qs ? `?${qs}` : ''}`);
}

export function fetchOnlineAttendance(lessonId: number): Promise<OnlineAttendanceRow[]> {
  return call(`/admin/attendance/${lessonId}/`);
}

export type OnlineReportRow = {
  student_id: string;
  student_name: string;
  group_name: string;
  topics_touched: number;
  tests_taken: number;
  score_sum: number;
  score_max: number;
  avg_pct: number | null;
  lessons_attended: number;
  minutes_total: number;
  attendance_pct: number | null;
};

export type OnlineReport = {
  rows: OnlineReportRow[];
  lessons_total: number;
  topics_opened: number;
};

export function fetchOnlineReport(params: {
  syllabusId?: number;
  groupName?: string;
} = {}): Promise<OnlineReport> {
  const q = new URLSearchParams();
  if (params.syllabusId) q.set('syllabus_id', String(params.syllabusId));
  if (params.groupName) q.set('group_name', params.groupName);
  const qs = q.toString();
  return call(`/admin/report/${qs ? `?${qs}` : ''}`);
}
