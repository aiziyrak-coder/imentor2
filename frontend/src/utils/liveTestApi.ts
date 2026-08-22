import { httpJson, HttpError } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';
import type { TestQuestion } from '../services/aiService';

/** Talaba uchun — javob kaliti va tushuntirishsiz savollar. */
export type StudentTestQuestion = Pick<TestQuestion, 'question' | 'options' | 'references'>;

export type LiveTestSessionPayload = {
  topic: string;
  questions: TestQuestion[];
  createdAt: number;
  isClosed?: boolean;
  closedAtMs?: number | null;
  /** Fan kesimida talaba natijalari/admin statistikasi uchun. */
  subjectCode?: string;
};

export type StudentLiveTestSessionPayload = Omit<LiveTestSessionPayload, 'questions'> & {
  questions: StudentTestQuestion[];
};

export function stripQuestionsForStudent(questions: TestQuestion[]): StudentTestQuestion[] {
  return questions.map((q) => {
    const item: StudentTestQuestion = {
      question: q.question,
      options: q.options,
    };
    if (q.references?.length) item.references = q.references;
    return item;
  });
}

export type LiveTestSubmissionRow = {
  firstName: string;
  lastName: string;
  answers: number[];
  submittedAt: number;
};

export type LiveTestFinalizeResult = {
  isClosed: boolean;
  closedAtMs: number | null;
  autoSubmitted: number;
  submissions: LiveTestSubmissionRow[];
};

const PARTICIPANT_KEY_PREFIX = 'imentor-live-test-participant-';

/** Talaba QR rejimi (`?mode=student&sid=` / `id=`) — login OnlineTest orqali. */
export function isPublicStudentTestUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const p = new URLSearchParams(window.location.search);
  const sid = (p.get('sid') || p.get('id') || '').trim();
  return p.get('mode') === 'student' && sid.length > 0;
}

export function getLiveTestParticipantKey(sessionKey: string): string {
  const storageKey = `${PARTICIPANT_KEY_PREFIX}${sessionKey}`;
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const created = `lp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(storageKey, created);
    return created;
  } catch {
    return `lp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

function mapSubmissionRows(
  rows: Array<{
    first_name: string;
    last_name: string;
    answers: number[];
    submitted_at: string;
  }>
): LiveTestSubmissionRow[] {
  return rows.map((r) => ({
    firstName: r.first_name,
    lastName: r.last_name,
    answers: Array.isArray(r.answers) ? r.answers : [],
    submittedAt: Date.parse(r.submitted_at),
  }));
}

/** O‘qituvchi: sessiyani serverga yozadi (talaba QR boshqa qurilmada ochishi uchun). */
export async function createLiveTestSessionOnServer(
  payload: LiveTestSessionPayload
): Promise<string> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const data = await httpJson<{ ok: boolean; session_key: string }>(`${apiBaseUrl()}/v1/live-tests/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      topic: payload.topic,
      questions: payload.questions,
      created_at_ms: payload.createdAt,
      subject_code: payload.subjectCode || '',
    },
    timeoutMs: 60000,
  });
  const sessionKey = data.session_key?.trim();
  if (!sessionKey) throw new Error('missing-session-key');
  return sessionKey;
}

/** O‘qituvchi: mavjud sessiyani serverga yangilaydi. */
export async function upsertLiveTestSessionOnServer(
  sessionKey: string,
  payload: LiveTestSessionPayload
): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  await httpJson(`${apiBaseUrl()}/v1/live-tests/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      session_key: sessionKey,
      topic: payload.topic,
      questions: payload.questions,
      created_at_ms: payload.createdAt,
      subject_code: payload.subjectCode || '',
    },
    timeoutMs: 60000,
  });
}

/** Serverda sessiya yo‘q bo‘lsa (yangi server / DB ko‘chirish) — qayta yozadi. */
export async function syncLiveTestSessionToServer(
  sessionKey: string,
  payload: LiveTestSessionPayload
): Promise<boolean> {
  try {
    await upsertLiveTestSessionOnServer(sessionKey, payload);
    return true;
  } catch {
    return false;
  }
}

/** Talaba: login talab qilinmaydi (javob kaliti yashirilgan). */
export async function fetchLiveTestSessionFromServer(
  sessionKey: string
): Promise<StudentLiveTestSessionPayload | null> {
  try {
    const data = await httpJson<{
      topic: string;
      questions: TestQuestion[];
      created_at_ms: number;
      is_closed?: boolean;
      closed_at_ms?: number | null;
    }>(`${apiBaseUrl()}/v1/live-tests/${encodeURIComponent(sessionKey)}/`, {
      timeoutMs: 30000,
    });
    if (!data?.questions?.length) return null;
    return {
      topic: data.topic,
      questions: stripQuestionsForStudent(data.questions),
      createdAt: data.created_at_ms,
      isClosed: Boolean(data.is_closed),
      closedAtMs: data.closed_at_ms ?? null,
    };
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

/** Talaba: draft javoblarni serverga saqlaydi (JWT majburiy). */
export async function upsertLiveTestDraftOnServer(
  sessionKey: string,
  body: {
    participantKey: string;
    firstName: string;
    lastName: string;
    answers: number[];
  }
): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  await httpJson(`${apiBaseUrl()}/v1/live-tests/${encodeURIComponent(sessionKey)}/drafts/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      participant_key: body.participantKey,
      first_name: body.firstName,
      last_name: body.lastName,
      answers: body.answers,
    },
    timeoutMs: 15000,
  });
}

/** Talaba: javoblarni serverga yuboradi (JWT majburiy). */
export async function submitLiveTestOnServer(
  sessionKey: string,
  body: {
    participantKey?: string;
    firstName: string;
    lastName: string;
    answers: number[];
    started_at_ms?: number;
    duration_sec?: number;
  }
): Promise<void> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  await httpJson(`${apiBaseUrl()}/v1/live-tests/${encodeURIComponent(sessionKey)}/submissions/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      participant_key: body.participantKey || '',
      first_name: body.firstName,
      last_name: body.lastName,
      answers: body.answers,
      started_at_ms: body.started_at_ms,
      duration_sec: body.duration_sec,
    },
    timeoutMs: 30000,
  });
}

export type StudentMySubmissionRow = {
  id: number;
  sessionKey: string;
  topic: string;
  subjectCode: string;
  subjectName: string;
  /** Fan biriktirilgan kafedra (bo'sh bo'lishi mumkin). */
  department: string;
  firstName: string;
  lastName: string;
  answers: number[];
  score: number;
  total: number;
  submittedAt: number;
  isClosed: boolean;
};

/** Talaba: o'zi topshirgan dars testlari — fan kesimida, ball bilan. */
export async function fetchMyLiveTestSubmissions(): Promise<StudentMySubmissionRow[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  const rows = await httpJson<
    Array<{
      id: number;
      session_key: string;
      topic: string;
      subject_code?: string;
      subject_name?: string;
      department?: string;
      first_name: string;
      last_name: string;
      answers: number[];
      score?: number;
      total?: number;
      submitted_at: string;
      is_closed: boolean;
    }>
  >(`${apiBaseUrl()}/v1/live-tests/my-submissions/`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 20000,
  });
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    id: r.id,
    sessionKey: r.session_key,
    topic: r.topic || '',
    subjectCode: r.subject_code || '',
    subjectName: r.subject_name || '',
    department: r.department || '',
    firstName: r.first_name,
    lastName: r.last_name,
    answers: Array.isArray(r.answers) ? r.answers : [],
    score: r.score ?? 0,
    total: r.total ?? 0,
    submittedAt: Date.parse(r.submitted_at),
    isClosed: Boolean(r.is_closed),
  }));
}

/** O‘qituvchi: draftlarni avtomatik topshirish va sessiyani yopish. */
export async function finalizeLiveTestSessionOnServer(sessionKey: string): Promise<LiveTestFinalizeResult> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  const data = await httpJson<{
    is_closed: boolean;
    closed_at_ms?: number | null;
    auto_submitted: number;
    submissions: Array<{
      first_name: string;
      last_name: string;
      answers: number[];
      submitted_at: string;
    }>;
  }>(`${apiBaseUrl()}/v1/live-tests/${encodeURIComponent(sessionKey)}/finalize/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30000,
  });
  return {
    isClosed: Boolean(data.is_closed),
    closedAtMs: data.closed_at_ms ?? null,
    autoSubmitted: data.auto_submitted ?? 0,
    submissions: mapSubmissionRows(Array.isArray(data.submissions) ? data.submissions : []),
  };
}

/** O‘qituvchi: realtime ro‘yxat (JWT). Sessiya serverda yo‘q bo‘lsa [] (404 konsol shovqinini oldini oladi). */
export async function fetchLiveTestSubmissionsFromServer(sessionKey: string): Promise<LiveTestSubmissionRow[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  try {
    const rows = await httpJson<
      Array<{
        first_name: string;
        last_name: string;
        answers: number[];
        submitted_at: string;
      }>
    >(`${apiBaseUrl()}/v1/live-tests/${encodeURIComponent(sessionKey)}/submissions/`, {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 20000,
    });
    if (!Array.isArray(rows)) return [];
    return mapSubmissionRows(rows);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return [];
    throw e;
  }
}

export type AdminLiveTestStatRow = {
  subjectCode: string;
  subjectName: string;
  department: string;
  submissionCount: number;
  studentCount: number;
  avgScorePct: number | null;
};

/** Admin: fan (va kafedra) kesimida — kim qancha jonli test yechgani. */
export async function fetchAdminLiveTestStats(): Promise<AdminLiveTestStatRow[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  const data = await httpJson<{
    results: Array<{
      subject_code: string;
      subject_name: string;
      department: string;
      submission_count: number;
      student_count: number;
      avg_score_pct: number | null;
    }>;
  }>(`${apiBaseUrl()}/v1/admin/live-test-stats/`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30000,
  });
  const results = Array.isArray(data.results) ? data.results : [];
  return results.map((r) => ({
    subjectCode: r.subject_code,
    subjectName: r.subject_name,
    department: r.department,
    submissionCount: r.submission_count,
    studentCount: r.student_count,
    avgScorePct: r.avg_score_pct,
  }));
}

export type AdminLiveTestSubmissionRow = {
  id: number;
  sessionKey: string;
  topic: string;
  subjectCode: string;
  subjectName: string;
  studentId: string;
  firstName: string;
  lastName: string;
  score: number;
  total: number;
  submittedAt: number;
};

/** Admin: har bir talabaning jonli test (QR) topshirig'i — sahifalangan, fan/sessiya bo'yicha filtrlanadi. */
export async function fetchAdminLiveTestSubmissions(params?: {
  subjectCode?: string;
  sessionKey?: string;
  studentId?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ results: AdminLiveTestSubmissionRow[]; count: number; page: number; pageSize: number }> {
  const token = await getBackendAccessToken();
  if (!token) return { results: [], count: 0, page: 1, pageSize: 50 };
  const query = new URLSearchParams();
  if (params?.subjectCode) query.set('subject_code', params.subjectCode);
  if (params?.sessionKey) query.set('session_key', params.sessionKey);
  if (params?.studentId) query.set('student_id', params.studentId);
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('page_size', String(params.pageSize));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const data = await httpJson<{
    count: number;
    page: number;
    page_size: number;
    results: Array<{
      id: number;
      session_key: string;
      topic: string;
      subject_code: string;
      subject_name: string;
      student_id: string;
      first_name: string;
      last_name: string;
      score: number;
      total: number;
      submitted_at: string;
    }>;
  }>(`${apiBaseUrl()}/v1/admin/live-test-submissions/${suffix}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30000,
  });
  const results = Array.isArray(data.results) ? data.results : [];
  return {
    count: data.count ?? 0,
    page: data.page ?? 1,
    pageSize: data.page_size ?? 50,
    results: results.map((r) => ({
      id: r.id,
      sessionKey: r.session_key,
      topic: r.topic || '',
      subjectCode: r.subject_code || '',
      subjectName: r.subject_name || '',
      studentId: r.student_id || '',
      firstName: r.first_name,
      lastName: r.last_name,
      score: r.score,
      total: r.total,
      submittedAt: Date.parse(r.submitted_at),
    })),
  };
}

export type AdminLiveTestSessionRow = {
  sessionKey: string;
  topic: string;
  createdAtMs: number;
  isClosed: boolean;
  submissionCount: number;
};

/** Admin: fan ichidagi har bir jonli test (mavzu + sana) — nechta talaba yechgani bilan. */
export async function fetchAdminLiveTestSessions(subjectCode: string): Promise<AdminLiveTestSessionRow[]> {
  const token = await getBackendAccessToken();
  if (!token) return [];
  const query = new URLSearchParams();
  if (subjectCode) query.set('subject_code', subjectCode);
  const data = await httpJson<{
    results: Array<{
      session_key: string;
      topic: string;
      created_at_ms: number;
      is_closed: boolean;
      submission_count: number;
    }>;
  }>(`${apiBaseUrl()}/v1/admin/live-test-sessions/?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30000,
  });
  const results = Array.isArray(data.results) ? data.results : [];
  return results.map((r) => ({
    sessionKey: r.session_key,
    topic: r.topic || '',
    createdAtMs: r.created_at_ms,
    isClosed: Boolean(r.is_closed),
    submissionCount: r.submission_count,
  }));
}

export type StudentReportSessionRow = {
  sessionKey: string;
  topic: string;
  createdAtMs: number;
  isClosed: boolean;
  questionCount: number;
  participantCount: number;
  /** Talaba shu darsning testini topshirganmi. */
  taken: boolean;
  score: number | null;
  total: number;
  submittedAt: number | null;
};

export type StudentReportSubjectRow = {
  subjectCode: string;
  subjectName: string;
  totalSessions: number;
  takenSessions: number;
  avgScorePct: number | null;
  sessions: StudentReportSessionRow[];
};

export type StudentLiveTestReport = {
  found: boolean;
  studentId: string;
  firstName: string;
  lastName: string;
  subjects: StudentReportSubjectRow[];
};

/**
 * Admin: bitta talabaning to'liq hisoboti — fanlar, ular ichida har bir dars
 * testi (yechgan/yechmagan va ball bilan).
 */
export async function fetchStudentLiveTestReport(studentId: string): Promise<StudentLiveTestReport> {
  const token = await getBackendAccessToken();
  const empty: StudentLiveTestReport = {
    found: false,
    studentId,
    firstName: '',
    lastName: '',
    subjects: [],
  };
  if (!token || !studentId.trim()) return empty;
  const data = await httpJson<{
    found: boolean;
    student_id: string;
    first_name: string;
    last_name: string;
    subjects: Array<{
      subject_code: string;
      subject_name: string;
      total_sessions: number;
      taken_sessions: number;
      avg_score_pct: number | null;
      sessions: Array<{
        session_key: string;
        topic: string;
        created_at_ms: number;
        is_closed: boolean;
        question_count: number;
        participant_count: number;
        taken: boolean;
        score: number | null;
        total: number;
        submitted_at: string | null;
      }>;
    }>;
  }>(`${apiBaseUrl()}/v1/admin/student-live-test-report/?student_id=${encodeURIComponent(studentId.trim())}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30000,
  });
  return {
    found: Boolean(data.found),
    studentId: data.student_id || studentId,
    firstName: data.first_name || '',
    lastName: data.last_name || '',
    subjects: (Array.isArray(data.subjects) ? data.subjects : []).map((s) => ({
      subjectCode: s.subject_code,
      subjectName: s.subject_name || '',
      totalSessions: s.total_sessions ?? 0,
      takenSessions: s.taken_sessions ?? 0,
      avgScorePct: s.avg_score_pct,
      sessions: (Array.isArray(s.sessions) ? s.sessions : []).map((r) => ({
        sessionKey: r.session_key,
        topic: r.topic || '',
        createdAtMs: r.created_at_ms,
        isClosed: Boolean(r.is_closed),
        questionCount: r.question_count ?? 0,
        participantCount: r.participant_count ?? 0,
        taken: Boolean(r.taken),
        score: r.score,
        total: r.total ?? 0,
        submittedAt: r.submitted_at ? Date.parse(r.submitted_at) : null,
      })),
    })),
  };
}
