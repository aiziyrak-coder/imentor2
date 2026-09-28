import { httpJson } from '../api/httpClient';
import { loadRectorToken, type TeacherRow } from './rectorApi';
import { STATUS_LABELS } from './ReportStatus';
import { BOARD_LABELS } from './InteractiveBoard';

export type IntelligenceFilters = {
  board: 'all' | 'available' | 'unavailable' | 'unknown';
  date_from: string;
  date_to: string;
  department: string;
  q: string;
  match_mode: 'contains' | 'exact';
  activity: 'all' | 'active' | 'inactive';
  criterion: 'usage' | 'materials' | 'lessons' | 'results';
  status: 'all' | 'red' | 'yellow' | 'green' | 'none';
  green_minutes_per_day: number;
  focus: string;
  min_minutes: number | null;
  max_minutes: number | null;
  min_score: number | null;
  max_score: number | null;
  results: 'all' | 'has' | 'none';
  sort:
    | 'name'
    | 'name_desc'
    | 'department'
    | 'attention'
    | 'minutes_desc'
    | 'minutes_asc'
    | 'lessons'
    | 'lessons_asc'
    | 'materials'
    | 'materials_asc'
    | 'score'
    | 'score_desc'
    | 'days'
    | 'days_asc'
    | 'students'
    | 'students_asc';
  compare: boolean;
};
export const FILTER_DEFAULTS = {
  board: 'all',
  q: '',
  match_mode: 'contains',
  activity: 'all',
  criterion: 'usage',
  status: 'all',
  green_minutes_per_day: 10,
  focus: '',
  min_minutes: null,
  max_minutes: null,
  min_score: null,
  max_score: null,
  results: 'all',
  sort: 'name',
  compare: true,
} as const;
export type LocalFilters = Omit<IntelligenceFilters, 'date_from' | 'date_to' | 'department'>;
export type IntelligenceRow = TeacherRow & {
  board?: BoardInfo;
  status?: 'red' | 'yellow' | 'green' | 'none';
  statuses?: Record<string, 'red' | 'yellow' | 'green' | 'none'>;
  first_name?: string;
  last_name?: string;
  signals: string[];
  attention_count: number;
  small_sample: boolean;
  previous: Record<string, number | null> | null;
  delta: {
    minutes: number;
    created_total: number;
    lessons_total: number;
    student_attempts: number;
  } | null;
};
export type IntelligenceReport = {
  board_inventory?: { source_url: string; checked_on: string };
  status_counts?: Record<'red' | 'yellow' | 'green' | 'none', number>;
  from: string;
  to: string;
  previous_from: string | null;
  previous_to: string | null;
  generated_at: string;
  total: number;
  count: number;
  rows: IntelligenceRow[];
  summary: {
    teachers: number;
    active: number;
    minutes: number;
    materials: number;
    lessons: number;
    attempts: number;
    signals: Record<string, number>;
  };
  filters: IntelligenceFilters;
  signal_labels: Record<string, string>;
};
export type IntelligenceAnalysis = {
  report?: IntelligenceReport;
  summary: string;
  analyzed_count: number;
  matched_count: number;
  from: string;
  to: string;
  generated_at: string;
  owner_keys: string[];
  priorities: Array<{
    owner_key: string;
    display_name: string;
    department: string;
    action: string;
    verification: string;
    equipment_reason?: string;
    evidence: Array<{ key: string; label: string; value: number | null }>;
  }>;
};
export type BoardInfo = {
  status: 'available' | 'unavailable' | 'unknown';
  reason: string;
  department: string | null;
  rooms: string[];
  unavailable_rooms: string[];
  inventory_row: number | null;
  source_url: string;
  checked_on: string;
};

function base() {
  return (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
}
function options() {
  return { headers: { Authorization: `Bearer ${loadRectorToken()}` }, retryOnUnauthorized: false };
}
export function fetchIntelligence(filters: IntelligenceFilters): Promise<IntelligenceReport> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== null && v !== '') params.set(k, String(v));
  });
  return httpJson(`${base()}/v1/rector/intelligence/?${params}`, {
    ...options(),
    timeoutMs: 60000,
  });
}
export function analyzeIntelligence(
  filters: IntelligenceFilters,
  question: string,
  owner_keys: string[],
): Promise<IntelligenceAnalysis> {
  return httpJson(`${base()}/v1/rector/intelligence/analyze/`, {
    ...options(),
    method: 'POST',
    body: { ...filters, question, owner_keys },
    timeoutMs: 100000,
  });
}

/** A CSV cell must never become an Excel formula, even for imported names. */
export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function intelligenceCsv(report: IntelligenceReport, rows = report.rows): string {
  const header = [
    'Familiya, ism',
    'Login',
    'Kafedra',
    'Davr boshi',
    'Davr oxiri',
    'Daqiqa',
    'Faol kun',
    'Material',
    'Keys',
    'Test',
    'Tarqatma',
    'Video',
    'Taqdimot',
    'Dars',
    'Talaba',
    'Urinish',
    'O‘rtacha natija (%)',
    'Oldingi davrdan daqiqa farqi',
    'Belgilar',
    'Mezon',
    'Holat',
    'Interaktiv doska',
    'Dars bahosi asosi',
    'Doskali auditoriyalar',
    'Doska ma’lumot manbasi',
    'Doska ma’lumot sanasi',
  ];
  return (
    '\ufeff' +
    [
      header,
      ...rows.map((r) => [
        r.display_name,
        r.owner_key,
        r.department,
        report.from,
        report.to,
        r.minutes,
        r.active_days,
        r.created_total,
        r.cases_created,
        r.tests_created,
        r.handouts_created,
        r.videos_created,
        r.presentations_created,
        r.lessons_total,
        r.students_taught,
        r.student_attempts,
        r.avg_student_score,
        r.delta?.minutes ?? '',
        r.signals.map((s) => report.signal_labels[s]).join('; '),
        report.filters.criterion,
        STATUS_LABELS[r.status || 'none'],
        BOARD_LABELS[r.board?.status || 'unknown'],
        r.board?.reason,
        r.board?.rooms.join('; '),
        r.board?.source_url,
        r.board?.checked_on,
      ]),
    ]
      .map((row) => row.map(csvCell).join(';'))
      .join('\r\n')
  );
}
export function downloadIntelligenceCsv(report: IntelligenceReport, rows = report.rows): void {
  const url = URL.createObjectURL(
    new Blob([intelligenceCsv(report, rows)], { type: 'text/csv;charset=utf-8' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `rektor-${rows.length === 1 ? rows[0].owner_key : 'filtrlangan'}-${report.from}_${report.to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
