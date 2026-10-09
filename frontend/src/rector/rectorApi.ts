/**
 * Rektor hisoboti — API mijozi.
 *
 * Rektor iMentor foydalanuvchisi emas: token faqat parol bilan olinadi va
 * faqat `/rector/*` marshrutlariga yaraydi. Shuning uchun u alohida kalitda
 * saqlanadi va oddiy seansga umuman aralashmaydi.
 */

import { httpJson } from '../api/httpClient';

const TOKEN_KEY = 'imentor-rector-token-v1';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

export function loadRectorToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* xotira yopiq bo'lsa ham joriy seans ishlaydi */
  }
}

export function clearRectorToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* muhim emas */
  }
}

function authHeader(): Record<string, string> {
  const t = loadRectorToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function rectorLogin(password: string, username = ''): Promise<void> {
  const r = await httpJson<{ access: string }>(`${apiBaseUrl()}/v1/rector/login/`, {
    method: 'POST',
    body: { username: username.trim(), password },
  });
  if (!r?.access) throw new Error('Token kelmadi.');
  storeToken(r.access);
}

/* ==================== Turlar ==================== */

export type PageStat = { page: string; minutes: number; seconds: number; opens: number };

export type TeacherRow = {
  schedule_linked?: boolean;
  /** Monitor jadvali bo'yicha oraliqdagi rejadagi paralar; null — jadvalda yo'q. */
  scheduled_lessons?: number | null;
  schedule_departments?: string[];
  owner_key: string;
  display_name: string;
  department: string;
  job_title: string;
  role: string;
  last_login: string | null;
  minutes: number;
  active_days: number;
  pages: PageStat[];
  videos_viewed: number;
  handouts_viewed: number;
  cases_created: number;
  tests_created: number;
  handouts_created: number;
  videos_created: number;
  presentations_created: number;
  live_sessions: number;
  online_lessons: number;
  students_taught: number;
  student_attempts: number;
  avg_student_score: number | null;
  created_total: number;
  lessons_total: number;
  is_active: boolean;
};

export type StudentRow = {
  student_id: string;
  display_name: string;
  attempts: number;
  subjects: number;
  score_sum: number;
  score_total: number;
  avg_percent: number | null;
  band: string;
  minutes: number;
  last_at: string | null;
};

type StudentBucket = {
  key: string;
  name: string;
  attempts: number;
  score: number;
  total: number;
  minutes: number;
  percent: number | null;
  band: string;
  last_at: string | null;
};

export type StudentDetail = {
  student_id: string;
  display_name: string;
  /** false — talaba ID'siz kirgan, ism-familiya bo'yicha ajratilgan. */
  has_id: boolean;
  from: string;
  to: string;
  attempts_count: number;
  score_sum: number;
  score_total: number;
  avg_percent: number | null;
  band: string;
  minutes: number;
  first_at: string | null;
  last_at: string | null;
  rank: number;
  rank_total: number;
  best_percent: number;
  worst_percent: number;
  subjects: StudentBucket[];
  teachers: StudentBucket[];
  days: StudentBucket[];
  attempts: Array<{
    id: number;
    submitted_at: string;
    subject_code: string;
    subject_name: string;
    topic: string;
    variant: string;
    teacher_key: string;
    teacher_name: string;
    score: number;
    total: number;
    percent: number | null;
    band: string;
    minutes: number;
  }>;
  online: { lessons: number; minutes: number; tests: number; avg_percent: number | null };
};

export type LessonRow = {
  kind: 'live_test' | 'online_lesson';
  kind_label: string;
  id: string;
  session_key: string;
  teacher_key: string;
  teacher_name: string;
  department: string;
  subject_code: string;
  subject_name: string;
  topic: string;
  group_name: string;
  held_at: string | null;
  students: number;
  avg_score: number | null;
  is_closed: boolean;
};

export type Overview = {
  from: string;
  to: string;
  teachers: {
    total: number;
    active: number;
    inactive: number;
    minutes: number;
    avg_minutes: number;
    cases_created: number;
    tests_created: number;
    handouts_created: number;
    videos_created: number;
    presentations_created: number;
    live_sessions: number;
    online_lessons: number;
  };
  students: {
    total: number;
    attempts: number;
    avg_percent: number | null;
    bands: Array<{ key: string; label: string; count: number }>;
  };
  online: {
    attendance_students: number;
    attendance_visits: number;
    attendance_minutes: number;
    online_tests_submitted: number;
    online_avg_percent: number | null;
    malaka_listeners: number;
    malaka_attempts: number;
    malaka_avg_percent: number | null;
  };
  days: Array<{ date: string; tests: number; lessons: number }>;
};



export type MonitorSlot = {
  monitor_id: string;
  department: string;
  building: string;
  room: string;
  room_full: string;
  date: string;
  weekday: string;
  para: string;
  start_time: string;
  end_time: string;
  teacher_name: string;
  teacher_key: string;
  subject: string;
  group: string;
  lesson_type: string;
  status: string;
  planned: boolean;
  used: boolean;
  student_count: number;
  /** Reja manbai: 'hemis' — HEMIS'dan (har kuni yangilanadi), 'excel' — kafedra fayli. */
  source?: 'hemis' | 'excel' | '';
};

export type MonitorRow = {
  monitor_id: string;
  department: string;
  building: string;
  room: string;
  room_full: string;
  inventory_row: number | null;
  planned_slots: number;
  used_slots: number;
  free_slots: number;
  usage_percent: number | null;
  teacher_count: number;
  students: number;
  /** Jadval bor, lekin shu kundan kuchga kiradi (tanlangan oraliqdan keyin bo'lishi mumkin). */
  schedule_from?: string | null;
};

export type MonitorTeacherRow = {
  teacher_key: string;
  teacher_name: string;
  department: string;
  planned_slots: number;
  used_slots: number;
  students: number;
  usage_percent: number | null;
  /** iMentor hisobiga bog'langanmi (bog'lanmasa foydalanish o'lchanmaydi). */
  linked?: boolean;
};

/** Kafedra bo'yicha yuklangan jadval holati. */
export type MonitorImportRow = {
  department: string;
  rows: number;
  teachers: number;
  unresolved_teachers: string[];
  imported_at: string | null;
  source_file: string;
};

export type MonitorImportResult = {
  imported_rows: number;
  departments: { department: string; rows: number; monitors: number; teachers: number; unresolved_teachers: string[] }[];
  unmatched_rooms: string[];
  forbidden_departments: string[];
};

export type MonitorReport = {
  from: string;
  to: string;
  schedule_imported: boolean;
  source: { inventory: string; checked_on: string };
  totals: {
    monitors: number;
    planned_slots: number;
    used_slots: number;
    free_slots: number;
    teachers: number;
    usage_percent: number | null;
  };
  departments: string[];
  imports: MonitorImportRow[];
  monitors: MonitorRow[];
  teachers: MonitorTeacherRow[];
  slots: MonitorSlot[];
};

export type FilterOptions = {
  departments: string[];
  subjects: Array<{ code: string; name: string }>;
  groups: string[];
  academic_years: string[];
  bands: Array<{ key: string; label: string }>;
};

export type TeacherDetail = TeacherRow & {
  from: string;
  to: string;
  total_minutes: number;
  days: Array<{
    date: string;
    minutes: number;
    pages: PageStat[];
    videos_viewed: number;
    handouts_viewed: number;
    cases_created: number;
    tests_created: number;
    live_sessions: number;
  }>;
  lessons: LessonRow[];
  /** O'qituvchining monitor jadvali (faqat rejadagi slotlar). */
  monitor?: {
    planned_slots: number;
    used_slots: number;
    usage_percent: number | null;
    slots: MonitorSlot[];
  };
};

export type DepartmentRow = {
  id: number;
  name: string;
  code: string;
  is_active: boolean;
  teachers: number;
  teachers_active: number;
  syllabuses: number;
  syllabuses_without_topics: number;
  topics: number;
  topics_covered: number;
  topics_empty: number;
  coverage: Record<string, number>;
  coverage_percent: Record<string, number>;
  ready_percent: number;
  missing_kinds: string[];
  has_syllabus: boolean;
  empty_syllabuses: Array<{ id: number; name: string }>;
};

export type DepartmentsResponse = {
  from: string;
  to: string;
  count: number;
  kinds: Array<{ key: string; label: string }>;
  results: DepartmentRow[];
};

export type GapsResponse = {
  departments_without_syllabus: Array<{ id: number; name: string; is_active: boolean }>;
  syllabuses_without_topics: Array<{ id: number; name: string; department: string }>;
  topics_without_material: Array<{
    syllabus_id: number;
    subject_name: string;
    department: string;
    topic_code: string;
    topic_title: string;
  }>;
  syllabuses_missing_kinds: Array<{
    syllabus_id: number;
    subject_name: string;
    department: string;
    topics: number;
    empty_topics: number;
    missing_kinds: string[];
  }>;
  totals: {
    departments: number;
    departments_without_syllabus: number;
    syllabuses: number;
    syllabuses_without_topics: number;
    syllabuses_missing_kinds: number;
    topics_without_material: number;
  };
};

export type TrendBucket = 'day' | 'week' | 'month' | 'quarter';

export type TrendResponse = {
  bucket: TrendBucket;
  bucket_label: string;
  from: string;
  to: string;
  rows: Array<{
    period: string;
    minutes: number;
    people: number;
    lessons: number;
    created: number;
    attempts: number;
    avg_percent: number | null;
  }>;
};

export type MetricColumn = { key: string; label: string; align?: 'left' | 'right' };

export type MetricRow = Record<string, string | number | null>;

/** Bitta raqamning ortidagi ro'yxat va uning ta'rifi. */
export type MetricDetail = {
  metric: string;
  title: string;
  explain: string;
  method: string;
  source: string;
  value: string;
  from: string;
  to: string;
  department: string;
  total: number;
  shown: number;
  columns: MetricColumn[];
  rows: MetricRow[];
};

/* ---------- Admin panelidan ko'chirilgan hisobotlar ---------- */

export type AttendanceLive = {
  checked_at: string;
  total: number;
  present: number;
  absent: number;
  percent: number | null;
  rows: Array<{
    owner_key: string;
    display_name: string;
    department: string;
    building_name: string;
    slot_start: string;
    slot_end: string;
    title: string;
    present: boolean;
    ping_age_min: number | null;
  }>;
  departments: Array<{
    department: string;
    total: number;
    present: number;
    absent: number;
    percent: number | null;
  }>;
};

export type AttendanceAlerts = {
  from: string;
  to: string;
  total: number;
  staff_affected: number;
  days: Array<{ date: string; alerts: number }>;
  departments: Array<{ department: string; alerts: number }>;
  teachers: Array<{
    owner_key: string;
    display_name: string;
    department: string;
    alerts: number;
    last_at: string | null;
    buildings: string[];
  }>;
  recent: Array<{
    display_name: string;
    department: string;
    building_name: string;
    slot: string;
    distance_m: number | null;
    radius_m: number | null;
    alert_date: string;
    created_at: string;
  }>;
};

export type RiskPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export type RiskReport = {
  period: RiskPeriod;
  from: string;
  to: string;
  total: number;
  tiers: { inactive: number; low: number; sufficient: number; active: number };
  flags: Record<string, number>;
  geofence_avg: number | null;
  geofence_tracked: number;
  departments: Array<{
    department: string;
    teachers: number;
    inactive: number;
    low: number;
    no_cases: number;
    no_tests: number;
    alerts: number;
    geofence_pct: number | null;
    at_risk_pct: number | null;
  }>;
  rows: Array<{
    owner_key: string;
    display_name: string;
    department: string;
    active_minutes_period: number;
    active_minutes_month: number;
    active_minutes_30d: number;
    tier: string;
    last_login: string | null;
    cases_created: number;
    tests_created: number;
    live_sessions_count: number;
    in_geofence_pct: number;
    alerts_count: number;
    pings_count: number;
    flags: string[];
  }>;
};

export type SubjectsReport = {
  from: string;
  to: string;
  pass_percent: number;
  subjects: number;
  attempts: number;
  pass_rate: number | null;
  results: Array<{
    subject_code: string;
    subject_name: string;
    department: string;
    attempts: number;
    students: number;
    sessions: number;
    teachers: number;
    avg_percent: number | null;
    pass_rate: number | null;
    failed: number;
  }>;
};

export type OnlineGroupsReport = {
  from: string;
  to: string;
  results: Array<{
    group_id: number;
    group_name: string;
    program: string;
    program_label: string;
    size: number;
    size_is_roster: boolean;
    lessons_held: number;
    students_attended: number;
    presences: number;
    attendance_pct: number | null;
    minutes: number;
    tests: number;
    avg_percent: number | null;
  }>;
};

export type ContentBank = {
  catalog: {
    totals: Record<string, number>;
    by_subject: Array<Record<string, unknown>>;
    by_author: Array<Record<string, unknown>>;
    recent: Array<Record<string, unknown>>;
  };
  syllabus: {
    departments_count: number;
    subjects_count: number;
    variants_count: number;
    topics_count: number;
    by_department: Array<{ name: string; code: string; subjects_count: number }>;
  };
};

/** AI (OpenAI) sarfi — funksiya va model bo'yicha. */
export type AiUsageReport = {
  from: string;
  to: string;
  calls: number;
  tokens: number;
  cached_pct: number | null;
  cost_usd: number;
  prices_note: string;
  results: Array<{
    kind: string;
    model: string;
    calls: number;
    prompt_tokens: number;
    cached_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cached_pct: number | null;
    avg_tokens: number;
    cost_usd: number;
  }>;
  days: Array<{ date: string; calls: number; tokens: number }>;
};

/* ==================== So'rovlar ==================== */

export type ReportFilters = {
  from: string;
  to: string;
  department?: string;
  subject_code?: string;
  q?: string;
  band?: string;
  teacher?: string;
  only_active?: boolean;
  /**
   * Real-time yangilash uchun hisoblagich. Serverga YUBORILMAYDI — har
   * so'rov query'ni aniq maydonlardan yig'adi. U faqat bo'limlarga
   * "qaytadan so'ra" degan signal beradi.
   */
  refreshKey?: number;
};

/** Bo'sh qiymatlarni tashlab, query satrini yig'adi. */
function query(filters: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    q.set(key, String(value));
  }
  return q.toString();
}

function get<T>(path: string): Promise<T> {
  // `retryOnUnauthorized: false` MUHIM (2026-09-26): rektor seansi tugaganda
  // umumiy httpClient shu brauzerdagi O'QITUVCHI tokenini yangilab qayta
  // urinardi — u rektor huquqiga ega emas, natijada parol oynasi o'rniga
  // "HTTP 403" chiqib qolardi.
  return httpJson<T>(`${apiBaseUrl()}/v1/rector${path}`, { headers: authHeader(), retryOnUnauthorized: false });
}

export function fetchFilters(): Promise<FilterOptions> {
  return get('/filters/');
}



/** Kafedra to'ldirgan Excel qatorlari (brauzerda o'qilgan) serverga yuboriladi. */
export function importMonitorSchedule(fileName: string, rows: string[][]): Promise<MonitorImportResult> {
  return httpJson<MonitorImportResult>(`${apiBaseUrl()}/v1/rector/monitor-schedule/import/`, {
    method: 'POST',
    headers: authHeader(),
    retryOnUnauthorized: false,
    body: { file_name: fileName, rows },
    timeoutMs: 120000,
  });
}

export function fetchMonitorReport(f: ReportFilters & { monitor_id?: string }): Promise<MonitorReport> {
  return get(
    `/monitor-report/?${query({
      from: f.from,
      to: f.to,
      department: f.department,
      monitor_id: f.monitor_id,
      q: f.q,
    })}`,
  );
}

export function fetchOverview(f: ReportFilters): Promise<Overview> {
  return get(`/overview/?${query({ from: f.from, to: f.to, department: f.department })}`);
}

export function fetchTeachers(
  f: ReportFilters,
): Promise<{ count: number; results: TeacherRow[] }> {
  return get(
    `/teachers/?${query({
      from: f.from,
      to: f.to,
      department: f.department,
      q: f.q,
      only_active: f.only_active,
    })}`,
  );
}

export function fetchTeacherDetail(ownerKey: string, f: ReportFilters): Promise<TeacherDetail> {
  return get(`/teachers/${encodeURIComponent(ownerKey)}/?${query({ from: f.from, to: f.to })}`);
}

export function fetchStudents(f: ReportFilters): Promise<{ count: number; results: StudentRow[] }> {
  return get(
    `/students/?${query({
      from: f.from,
      to: f.to,
      subject_code: f.subject_code,
      q: f.q,
      band: f.band,
    })}`,
  );
}

export function fetchStudentDetail(studentKey: string, f: ReportFilters): Promise<StudentDetail> {
  return get(`/students/${encodeURIComponent(studentKey)}/?${query({ from: f.from, to: f.to })}`);
}

export function fetchLessons(f: ReportFilters): Promise<{ count: number; results: LessonRow[] }> {
  return get(
    `/lessons/?${query({
      from: f.from,
      to: f.to,
      teacher: f.teacher,
      subject_code: f.subject_code,
    })}`,
  );
}

export function fetchDepartments(f: ReportFilters): Promise<DepartmentsResponse> {
  return get(`/departments/?${query({ from: f.from, to: f.to })}`);
}

export function fetchGaps(limit = 60): Promise<GapsResponse> {
  return get(`/gaps/?limit=${limit}`);
}

export function fetchTrend(f: ReportFilters, bucket: TrendBucket): Promise<TrendResponse> {
  return get(`/trend/?${query({ from: f.from, to: f.to, bucket })}`);
}

export function fetchMetricDetail(
  metric: string,
  f: ReportFilters,
  limit?: number,
): Promise<MetricDetail> {
  return get(
    `/detail/?${query({ metric, from: f.from, to: f.to, department: f.department, limit })}`,
  );
}

export function fetchAttendanceLive(): Promise<AttendanceLive> {
  return get('/attendance/live/');
}

export function fetchAttendanceAlerts(f: { from: string; to: string }): Promise<AttendanceAlerts> {
  return get(`/attendance/alerts/?${query({ from: f.from, to: f.to })}`);
}

export function fetchRisk(period: RiskPeriod, anchor: string, department: string): Promise<RiskReport> {
  return get(`/risk/?${query({ period, anchor, department })}`);
}

export function fetchSubjects(f: { from: string; to: string }): Promise<SubjectsReport> {
  return get(`/subjects/?${query({ from: f.from, to: f.to })}`);
}

export function fetchOnlineGroups(f: { from: string; to: string }): Promise<OnlineGroupsReport> {
  return get(`/online-groups/?${query({ from: f.from, to: f.to })}`);
}

export function fetchContentBank(): Promise<ContentBank> {
  return get('/content-bank/');
}

export function fetchAiUsage(f: { from: string; to: string }): Promise<AiUsageReport> {
  return get(`/ai-usage/?${query({ from: f.from, to: f.to })}`);
}

/** O'qituvchilar jadvalini CSV qilib yuklab olish (token sarlavhada ketadi). */
export async function downloadTeachersCsv(f: ReportFilters): Promise<void> {
  const url = `${apiBaseUrl()}/v1/rector/teachers/export.csv?${query({
    from: f.from,
    to: f.to,
    department: f.department,
  })}`;
  const res = await fetch(url, { headers: authHeader() });
  if (!res.ok) throw new Error(`Yuklab olishda xato (${res.status}).`);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `rektor-oqituvchilar-${f.from}_${f.to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

/* ==================== Dars jadvali bo'yicha nazorat (2026-09-25) ==================== */

export type LessonTeacherRow = {
  teacher_key: string;
  teacher_name: string;
  employee_id: string;
  linked: boolean;
  department: string;
  lessons: number;
  used_lessons: number;
  with_monitor: number;
  students: number;
  subject_count: number;
  group_count: number;
  days: number;
  used_days: number;
  usage_percent: number;
  last_used: string | null;
};

export type LessonTeachersReport = {
  from: string;
  to: string;
  totals: {
    teachers: number;
    linked_teachers: number;
    lessons: number;
    used_lessons: number;
    usage_percent: number;
    never_used: number;
    with_monitor: number;
  };
  results: LessonTeacherRow[];
};

export type LessonDepartmentRow = {
  department: string;
  lessons: number;
  used_lessons: number;
  usage_percent: number;
  teachers: number;
  active_teachers: number;
};

export type ScheduledLessonRow = {
  id: number;
  date: string;
  weekday: string;
  para: string;
  start_time: string;
  end_time: string;
  teacher_name: string;
  teacher_key: string;
  department: string;
  subject: string;
  group: string;
  lesson_type: string;
  room: string;
  building: string;
  monitor_id: string;
  used: boolean;
  /** Dars hali tugamagan — baholanmaydi. */
  pending?: boolean;
  students: number;
  // Dalil: qator qaysi HEMIS yozuvidan va qaysi inventar xonasidan kelgan.
  hemis_id: string;
  auditorium_code: string;
  monitor_room: string;
  monitor_department: string;
  synced_at: string | null;
  hemis_status?: string;
  hemis_missing_at?: string | null;
  evidence?: {
    status: string; room_presence: string; note: string; seconds: number;
    reported_seconds?: number; overlap_seconds?: number;
    first_event?: string | null; last_event?: string | null;
    pages: Array<{ page: string; seconds: number; opens: number }>;
    events: Array<{ id: number; at: string; action: string; page: string; seconds: number }>;
  };
};

export function fetchLessonTeachers(f: ReportFilters): Promise<LessonTeachersReport> {
  return get(`/lessons/teachers/?${query({ from: f.from, to: f.to, department: f.department, q: f.q })}`);
}

export function fetchLessonDepartments(
  f: ReportFilters,
): Promise<{ from: string; to: string; results: LessonDepartmentRow[] }> {
  return get(`/lessons/departments/?${query({ from: f.from, to: f.to })}`);
}

export function fetchScheduledLessons(
  f: ReportFilters & { only_missed?: boolean },
): Promise<{ count: number; results: ScheduledLessonRow[] }> {
  return get(
    `/lessons/?${query({
      from: f.from,
      to: f.to,
      teacher: f.teacher,
      department: f.department,
      only_missed: f.only_missed ? '1' : '',
    })}`,
  );
}

/* ==================== Nazorat paneli (2026-09-25) ==================== */

export type ControlTeacher = {
  teacher_key: string;
  teacher_name: string;
  employee_id: string;
  linked: boolean;
  department: string;
  monitor_lessons: number;
  monitor_used: number;
  monitor_percent: number | null;
  band: 'good' | 'warn' | 'bad' | 'none';
  other_lessons: number;
  other_used: number;
  lessons: number;
  students: number;
  days: number;
  rooms: string[];
  last_used: string | null;
  // Ikkinchi qatlam: darsda ochgani emas, iMentor'da NIMA qilgani.
  minutes: number;
  active_days: number;
  created: Record<string, number>;
  created_total: number;
  top_module: string;
  depth: 'worked' | 'viewed' | 'visit' | 'none';
  profile_percent: number | null;
  profile_missing: string[];
  subjects_linked: number;
  material_percent: number | null;
  material_topics: number;
  material_empty: number;
  // Nechta darsi ishlayotgani isbotlangan xonada bo'lgan; bahona shu bilan hal bo'ladi.
  proven_lessons: number;
  excuse: 'none' | 'check_room';
  /** Davrdagi holati — har o'qituvchi faqat bitta toifada. */
  state?: 'full' | 'partial' | 'opened' | 'none' | 'on_leave' | 'unlinked' | 'offsite';
  /** Monitorli darslaridan o'tilmay qolgani. */
  monitor_missed?: number;
  /** Bugun hali tugamagan (baholanmagan) monitorli darslari. */
  pending_lessons?: number;
};

export type ControlRoom = {
  monitor_id: string;
  room: string;
  department: string;
  hemis_rooms: string[];
  building: string;
  lessons: number;
  used: number;
  percent: number;
  teachers: number;
  used_teachers: number;
  departments: string[];
  last_used: string | null;
  status: 'ok' | 'suspect' | 'quiet';
  status_label: string;
};

export type ControlAttention = {
  teacher_key: string;
  teacher_name: string;
  employee_id: string;
  department: string;
  monitor_lessons: number;
  days: number;
  rooms: string[];
  other_used: number;
  other_lessons: number;
  proven_lessons: number;
  excuse: 'none' | 'check_room';
};

export type ControlModule = { page: string; label: string; minutes: number; opens: number; people: number };

export type ControlReport = {
  from: string;
  to: string;
  headline: {
    monitor_lessons: number;
    monitor_used: number;
    monitor_percent: number;
    band: 'good' | 'warn' | 'bad' | 'none';
    watched_teachers: number;
    idle_teachers: number;
    other_lessons: number;
    other_used: number;
    other_percent: number;
    unlinked_teachers: number;
    total_lessons: number;
    blamed_teachers: number;
    check_room_teachers: number;
    /** Monitorli xonada darsi umuman yo'q — asosiy foizga kirmaydi. */
    offsite_teachers: number;
    /** Kirgan, lekin darsni iMentor'da o'tmagan (chegaradan past). */
    short_lessons: number;
    short_teachers: number;
    /** Dars "o'tilgan" deyish uchun kerak bo'lgan eng kam daqiqa. */
    min_lesson_minutes: number;
    /** Monitorli darslar ishlangan vaqt bo'yicha (yig'indisi = monitor_lessons).
     *  full — chegaradan o'tgan; near — NEAR..chegara; brief — 1..NEAR; none — ochilmagan. */
    work_buckets?: { full: number; near: number; brief: number; none: number };
    short_near_teachers?: number;
    short_brief_teachers?: number;
    /** "Yaqin" toifasining pastki chegarasi (daqiqa). */
    near_minutes?: number;
    /** Kamida bitta darsini iMentor'da o'tgan o'qituvchilar va ularning ulushi. */
    teachers_used?: number;
    teacher_percent?: number;
    /** O'qituvchilar toifalari (yig'indisi = watched_teachers). */
    teacher_buckets?: { full: number; partial: number; opened: number; none: number; on_leave: number; unlinked: number };
    partial_missed_lessons?: number;
    /** Hali tugamagan darslar — hech bir raqamga kirmagan. */
    pending?: { lessons: number; monitor_lessons: number; teachers: number; as_of: string | null };
  };
  attention: ControlAttention[];
  check_room: ControlAttention[];
  rooms: ControlRoom[];
  room_summary: { rooms: number; ok: number; suspect: number; quiet: number; suspect_lessons: number };
  source: {
    synced_at: string | null;
    lessons: number;
    teachers: number;
    unlinked_teachers: number;
    rooms_without_monitor: number;
  };
  daily: Array<{ date: string; weekday: string; lessons: number; used: number; percent: number }>;
  departments: Array<{
    department: string;
    monitor_lessons: number;
    monitor_used: number;
    percent: number;
    band: 'good' | 'warn' | 'bad' | 'none';
    teachers: number;
    active_teachers: number;
    other_lessons: number;
  }>;
  /** FAQAT monitorli xonada darsi borlar. */
  teachers: ControlTeacher[];
  /** Klinika bazasida yoki masofadan dars o'tadiganlar — alohida. */
  offsite: {
    teachers: ControlTeacher[];
    count: number;
    lessons: number;
    used: number;
    places: Array<{ place: string; lessons: number; used: number; teachers: number; percent: number }>;
    places_total: number;
  };
  quality: {
    minutes: number;
    worked: number;
    viewed: number;
    visit: number;
    never: number;
    no_subject: number;
    profile_incomplete: number;
    teachers: number;
  };
  modules: ControlModule[];
  created: Record<string, number>;
  created_labels: Record<string, string>;
};

export type ControlStudentRow = {
  student_key: string;
  name: string;
  group: string;
  course: number | null;
  faculty: string;
  in_contingent: boolean;
  attempts: number;
  avg_score: number;
};

export type ControlStudents = {
  from: string;
  to: string;
  students: ControlStudentRow[];
  totals: {
    contingent: number;
    tested: number;
    matched_to_contingent: number;
    attempts: number;
    avg_score: number;
    coverage: number;
    groups_active: number;
    groups_total: number;
  };
  groups: Array<{
    group: string;
    tested_students: number;
    group_size: number;
    coverage: number;
    attempts: number;
    avg_score: number;
  }>;
};

/** Institutning hamma tizimi bitta javobda. */
export type PlatformsReport = {
  from: string;
  to: string;
  platforms: Array<{
    key: string;
    label: string;
    link: string;
    /** `true` — raqamlar shu so'rovda hisoblandi; `false` — soatlik nusxadan. */
    live: boolean;
    /** `false` — oxirgi yig'ish o'tmagan: raqamlar eski. */
    ok: boolean;
    note: string;
    collected_at: string | null;
    cards: Array<{ metric: string; title: string; value: number | string; hint: string }>;
  }>;
  /** Hali ulanmagan tizimlar — sababi bilan. */
  missing: Array<{ key: string; label: string; note: string }>;
};

export function fetchPlatforms(f: ReportFilters): Promise<PlatformsReport> {
  return get(`/platforms/?${query({ from: f.from, to: f.to })}`);
}

/** Bosh sahifa uchun: faqat nomlar — raqamlar hisoblanmaydi, shuning uchun tez. */
export function fetchPlatformNames(f: ReportFilters): Promise<PlatformsReport> {
  return get(`/platforms/?${query({ from: f.from, to: f.to, names: '1' })}`);
}

export function fetchControlReport(f: ReportFilters): Promise<ControlReport> {
  return get(`/control/?${query({ from: f.from, to: f.to, department: f.department, q: f.q })}`);
}

/** Sahifadagi bitta raqam ortidagi odam. */
export type ControlPerson = {
  key: string;
  kind: 'teacher' | 'student' | 'group';
  name: string;
  subtitle: string;
  value: number;
  value_label: string;
  note: string;
};

export type ControlPeople = {
  metric: string;
  title: string;
  kind: 'teacher' | 'student' | 'group';
  total: number;
  people: ControlPerson[];
};

/** Raqam bosilganda — uning ortidagi ro'yxat. */
export function fetchControlPeople(
  f: ReportFilters,
  metric: string,
): Promise<ControlPeople> {
  return get(`/control/people/?${query({ from: f.from, to: f.to, department: f.department, metric })}`);
}

export function fetchControlStudents(f: ReportFilters): Promise<ControlStudents> {
  return get(`/control/students/?${query({ from: f.from, to: f.to })}`);
}

export type ControlTeacherDetail = {
  teacher_key: string;
  profile: {
    display_name: string;
    job_title: string;
    department: string;
    last_login: string | null;
    /** Tanlangan davr ichidagi oxirgi faol kun (davrdan tashqarisi hisobga olinmaydi). */
    last_active: string | null;
  };
  summary: ControlTeacher | null;
  materials: {
    handouts: number;
    videos: number;
    presentations: number;
    live_sessions: number;
    students_taught: number;
    student_attempts: number;
  };
  subjects: Array<{ subject: string; lessons: number; used: number; monitor: number; percent: number }>;
  rooms: ControlRoom[];
  engagement: {
    minutes: number;
    active_days: number;
    depth: 'worked' | 'viewed' | 'visit' | 'none';
    depth_label: string;
    modules: Array<{ page: string; label: string; minutes: number; opens: number }>;
    created: Record<string, number>;
    created_total: number;
    created_labels: Record<string, string>;
    viewed: { videos: number; handouts: number };
    days: Array<{ date: string; minutes: number; tests: number; cases: number; live_sessions: number }>;
  };
  profile_check: { percent: number; missing: string[]; have: Record<string, boolean>; subjects: number };
  subject_materials: {
    percent: number;
    topics: number;
    empty: number;
    handout: number;
    presentation: number;
    video: number;
    rows: Array<{
      syllabus_id: number;
      subject: string;
      variant: string;
      topics: number;
      empty: number;
      percent: number;
      handout: number;
      presentation: number;
      video: number;
    }>;
  };
  lessons: ScheduledLessonRow[];
};

export type ControlStudentDetail = {
  contingent: {
    student_id: string;
    full_name: string;
    group_name: string;
    course: number | null;
    faculty: string;
    direction: string;
    education_form: string;
    education_language: string;
    status: string;
  } | null;
  [key: string]: unknown;
};

export function fetchControlTeacher(key: string, f: ReportFilters): Promise<ControlTeacherDetail> {
  return get(`/control/teacher/${encodeURIComponent(key)}/?${query({ from: f.from, to: f.to })}`);
}

export function fetchControlStudent(key: string, f: ReportFilters): Promise<ControlStudentDetail> {
  return get(`/control/student/${encodeURIComponent(key)}/?${query({ from: f.from, to: f.to })}`);
}
