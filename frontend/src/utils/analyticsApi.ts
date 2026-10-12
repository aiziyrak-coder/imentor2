import { HttpError, httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';
import { getCurrentLocalUser } from './localStaffAuth';

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

type ActivityEvent = {
  event_type: string;
  duration_sec?: number;
  meta?: Record<string, unknown>;
  /** Hodisa haqiqatan bo'lgan payt. Navbatdan kechikib yuborilganda server
   *  vaqtni SHU paytga yozadi — aks holda darsdagi daqiqalar keyingi vaqtga
   *  tushib, dars "o'tilmagan" bo'lib chiqardi. */
  client_ts_ms?: number;
};

/** Faollik yuborilish holati — banner shu hodisani tinglaydi. */
export type TelemetryStatus = { ok: boolean; reason?: 'auth' | 'network' };

function newQid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function emitStatus(status: TelemetryStatus): void {
  window.dispatchEvent(new CustomEvent<TelemetryStatus>('imentor:telemetry-status', { detail: status }));
}

/* ── Yuborilmagan vaqt navbati ───────────────────────────────────────────
   Internet uzilsa yoki server javob bermasa, shu daqiqalardagi ish ilgari
   butunlay yo'qolardi: hisoblagich yuborishdan OLDIN nolga tushirilardi.
   Rektor hisobotida "dars o'tildimi" aynan shu qaydlarga qaraydi.
   Endi yuborilmagani brauzerda saqlanadi va keyingi muvaffaqiyatli
   yuborishda asl vaqti bilan jo'natiladi.

   Navbat FOYDALANUVCHI bo'yicha: sinf doskasida bir kompyuterda bir necha
   o'qituvchi ishlaydi — birining vaqti ikkinchisiga yozilib ketmasin. */
const QUEUE_PREFIX = 'imentor-activity-queue-v1:';
/** Eskirgani yuborilmaydi (server ham 24 soatdan eskisini qabul qilmaydi). */
const QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const QUEUE_MAX_ITEMS = 600;
const BATCH = 50;

type Queued = { page: string; event: ActivityEvent };

function queueKey(): string | null {
  const uid = getCurrentLocalUser()?.uid;
  return uid ? QUEUE_PREFIX + uid : null;
}

function readQueue(key: string): Queued[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(raw)) return [];
    const cutoff = Date.now() - QUEUE_MAX_AGE_MS;
    return raw.filter(
      (q): q is Queued =>
        q && typeof q.page === 'string' && q.event && (q.event.client_ts_ms ?? 0) >= cutoff,
    );
  } catch {
    return [];
  }
}

function writeQueue(key: string, items: Queued[]): void {
  try {
    if (items.length) localStorage.setItem(key, JSON.stringify(items.slice(-QUEUE_MAX_ITEMS)));
    else localStorage.removeItem(key);
  } catch {
    /* xotira to'la yoki yopiq — navbatsiz davom etamiz */
  }
}

function enqueue(events: ActivityEvent[], page: string): void {
  const key = queueKey();
  // Faqat vaqt qaydlari saqlanadi: "bo'limni ochdi" kechikib kelsa ma'nosiz.
  const keep = events.filter((e) => e.event_type === 'heartbeat' && (e.duration_sec ?? 0) > 0);
  if (!key || !keep.length) return;
  writeQueue(key, [...readQueue(key), ...keep.map((event) => ({ page, event }))]);
}

/** Navbatdagilarni yuboradi (sahifa bo'yicha guruhlab). Xato bo'lsa qolgani navbatda qoladi. */
async function drainQueue(url: string, token: string): Promise<void> {
  const key = queueKey();
  if (!key) return;
  let items = readQueue(key);
  while (items.length) {
    const page = items[0].page;
    const chunk = items.filter((q) => q.page === page).slice(0, BATCH);
    await httpJson(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { events: chunk.map((q) => q.event), page, sent_at_ms: Date.now() },
      timeoutMs: 12000,
    });
    const sent = new Set(chunk);
    items = items.filter((q) => !sent.has(q));
    writeQueue(key, items);
  }
}

export async function postActivityEvents(
  events: ActivityEvent[],
  page: string,
  options?: { beacon?: boolean },
): Promise<void> {
  if (events.length === 0) return;
  const stamped = events.map((e) => ({
    ...e,
    client_ts_ms: e.client_ts_ms ?? Date.now(),
    // Noyob belgi: navbatdan qayta yuborilsa server ikki marta sanamaydi.
    meta: { ...(e.meta || {}), qid: (e.meta?.qid as string) || newQid() },
  }));
  const token = await getBackendAccessToken();
  if (!token) {
    enqueue(stamped, page);
    emitStatus({ ok: false, reason: 'auth' });
    return;
  }
  const url = `${apiBaseUrl()}/v1/analytics/events/`;

  /* Sahifa yopilayotganda oddiy so'rov bekor qilinadi va oxirgi bo'lakdagi
     vaqt yo'qoladi. `keepalive` esa so'rovni sahifadan uzib qo'yadi —
     brauzer uni varaq yopilgandan keyin ham oxirigacha yuboradi.
     `navigator.sendBeacon` ishlatilmadi: u sarlavha qo'sha olmaydi, ya'ni
     token URL ga chiqib, server loglariga yozilib qolardi. */
  if (options?.beacon) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ events: stamped, page, sent_at_ms: Date.now() }),
        keepalive: true,
      });
      if (!res.ok) enqueue(stamped, page);
    } catch {
      // Keyingi ochilishda navbatdan yuboriladi.
      enqueue(stamped, page);
    }
    return;
  }

  try {
    await httpJson(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { events: stamped, page, sent_at_ms: Date.now() },
      timeoutMs: 12000,
    });
  } catch (err) {
    enqueue(stamped, page);
    const auth = err instanceof HttpError && (err.status === 401 || err.status === 403);
    emitStatus({ ok: false, reason: auth ? 'auth' : 'network' });
    return;
  }
  emitStatus({ ok: true });
  // Ulanish bor — avval yuborilmay qolganlarini ham jo'natamiz.
  await drainQueue(url, token).catch(() => undefined);
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
