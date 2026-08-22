import { httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export type TeacherReportRow = {
  owner_key: string;
  display_name: string;
  department: string;
  active_minutes_period: number;
  active_minutes_month: number;
  active_minutes_30d: number;
  tier: 'inactive' | 'low' | 'sufficient' | 'active';
  last_login: string | null;
  cases_created: number;
  tests_created: number;
  live_sessions_count: number;
  in_geofence_pct: number;
  alerts_count: number;
  pings_count: number;
  flags: string[];
};

export type ReportSummary = {
  period: string;
  from: string;
  to: string;
  teachers_total: number;
  tier_counts: Record<string, number>;
  student_attempts: number;
  avg_score_pct: number;
  teachers_without_cases: number;
  teachers_without_tests: number;
  teachers_inactive: number;
};

export async function postActivityEvents(
  events: Array<{ event_type: string; duration_sec?: number; meta?: Record<string, unknown> }>,
  page: string,
): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token || events.length === 0) return;
  await httpJson(`${apiBaseUrl()}/v1/analytics/events/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: { events, page },
    timeoutMs: 12000,
  }).catch(() => undefined);
}

export async function postLiveTestAnticheatEvents(
  sessionKey: string,
  participantKey: string,
  events: Array<{
    event_type: string;
    question_index?: number;
    option_index?: number;
    client_ts_ms?: number;
  }>,
): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token || !sessionKey || events.length === 0) return;
  await httpJson(`${apiBaseUrl()}/v1/analytics/live-test-events/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: { session_key: sessionKey, participant_key: participantKey, events },
    timeoutMs: 15000,
  }).catch(() => undefined);
}

export type ReportFacets = {
  departments: Array<{ name: string; count: number }>;
  tiers: Record<string, number>;
  flags: Record<string, number>;
};

export type TeacherReportParams = {
  period: ReportPeriod;
  from?: string;
  filterParams?: Record<string, string>;
};

export async function fetchTeacherReport(
  period: ReportPeriod,
  from?: string,
  filterParams?: Record<string, string>,
): Promise<{
  period: string;
  from: string;
  to: string;
  teachers: TeacherReportRow[];
  total: number;
  filtered_total: number;
  facets: ReportFacets;
}> {
  const token = await getBackendAccessToken();
  const q = new URLSearchParams({ period });
  if (from) q.set('from', from);
  if (filterParams) {
    for (const [k, v] of Object.entries(filterParams)) {
      if (v) q.set(k, v);
    }
  }
  return httpJson(`${apiBaseUrl()}/v1/admin/reports/teachers/?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 60000,
  });
}

export async function fetchReportSummary(period: ReportPeriod, from?: string): Promise<ReportSummary> {
  const token = await getBackendAccessToken();
  const q = new URLSearchParams({ period });
  if (from) q.set('from', from);
  return httpJson(`${apiBaseUrl()}/v1/admin/reports/summary/?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 60000,
  });
}

export async function fetchAiNarrative(period: ReportPeriod, language: string): Promise<{ narrative: string; summary: ReportSummary }> {
  const token = await getBackendAccessToken();
  return httpJson(`${apiBaseUrl()}/v1/admin/reports/ai-narrative/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: { period, language },
    timeoutMs: 120000,
  });
}

export async function fetchStudentTestArchive(studentId: string, academicYear?: string): Promise<{
  found: boolean;
  student_id: string;
  first_name?: string;
  last_name?: string;
  attempts: Array<{
    id: number;
    subject_code: string;
    topic: string;
    score: number;
    total: number;
    submitted_at: string;
    academic_year: string;
    questions: Array<{
      index: number;
      question: string;
      options: string[];
      selected_index: number | null;
      correct_index: number | null;
      is_correct: boolean;
    }>;
    timeline: Array<{
      event_type: string;
      question_index: number | null;
      option_index: number | null;
      occurred_at: string;
    }>;
  }>;
}> {
  const token = await getBackendAccessToken();
  const q = new URLSearchParams({ student_id: studentId });
  if (academicYear) q.set('academic_year', academicYear);
  return httpJson(`${apiBaseUrl()}/v1/admin/student-test-archive/?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 60000,
  });
}

export function teacherReportCsvUrl(
  period: ReportPeriod,
  from?: string,
  filterParams?: Record<string, string>,
): string {
  const q = new URLSearchParams({ period });
  if (from) q.set('from', from);
  if (filterParams) {
    for (const [k, v] of Object.entries(filterParams)) {
      if (v) q.set(k, v);
    }
  }
  return `${apiBaseUrl()}/v1/admin/reports/teachers/export.csv?${q}`;
}

export type StudentArchiveSearchHit = {
  student_id: string;
  first_name: string;
  last_name: string;
  attempts_count: number;
  last_submitted_at: string;
};

export async function searchStudentTestArchive(
  q: string,
  academicYear?: string,
): Promise<{ q: string; results: StudentArchiveSearchHit[] }> {
  const token = await getBackendAccessToken();
  const params = new URLSearchParams({ q });
  if (academicYear) params.set('academic_year', academicYear);
  return httpJson(`${apiBaseUrl()}/v1/admin/student-test-archive/search/?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30000,
  });
}

export async function runDailyRollup(date?: string): Promise<void> {
  const token = await getBackendAccessToken();
  const q = date ? `?date=${encodeURIComponent(date)}` : '';
  await httpJson(`${apiBaseUrl()}/v1/admin/reports/rollup/run/${q}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 120000,
  });
}
