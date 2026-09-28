/**
 * Malaka oshirish — API mijozi.
 *
 * Umumiy online marshrutlar (fanlar, mavzular, materiallar) malaka fanlarida
 * ham ishlaydi: server fanning dasturiga qarab qoidani o'zi tanlaydi. Bu
 * yerda malakaga xos marshrutlar va javob turlari.
 */

import { httpJson } from '../api/httpClient';
import { authHeader } from './onlineAuth';

/** Fan darajasidagi testlar shu maxsus "mavzu" kodlarida saqlanadi. */
export const ENTRY_CODE = '__entry__';
export const EXIT_CODE = '__exit__';

export type SubjectTestCode = 'entry' | 'exit';
export type AttemptKind = 'test' | 'practical' | 'entry' | 'exit';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

function call<T>(path: string, init?: { method?: Method; body?: unknown }): Promise<T> {
  return httpJson<T>(`${apiBaseUrl()}/v1${path}`, {
    method: init?.method || 'GET',
    body: init?.body as never,
    headers: authHeader(),
  });
}

/* ==================== Umumiy turlar ==================== */

/** Bitta test bo'yicha urinishlar. Eng yaxshi natija hisoblanadi. */
export type AttemptSummary = {
  kind: AttemptKind;
  max_attempts: number;
  used: number;
  left: number;
  finished: boolean;
  best_percent: number | null;
  best_score: number | null;
  best_total: number | null;
  last_score: number | null;
  last_total: number | null;
  last_submitted_at: string | null;
};

export type SubjectTestStatus = AttemptSummary & {
  available: boolean;
  title: string;
  question_count: number;
};

/** `correct_index` va `explanation` faqat urinishlar tugagach keladi. */
export type TestQuestionView = {
  question: string;
  options: string[];
  correct_index?: number;
  explanation?: string;
};

export type TestView = {
  attempts: AttemptSummary;
  question_count: number;
  questions: TestQuestionView[];
  my_answers?: number[];
};

/** Mavzu natijasi: mavzuda bor test turlarining o'rtachasi — hammasi topshirilgach. */
export type TopicResult = {
  test: AttemptSummary | null;
  practical: AttemptSummary | null;
  grade: number | null;
};

/* ==================== Tinglovchi ==================== */

export type MalakaSubject = {
  syllabus_id: number;
  subject_name: string;
  department_name: string;
  variant_label: string;
  program: 'malaka';
  topic_count: number;
  open_count: number;
  done_count: number;
  graded_count: number;
  average_grade: number | null;
  entry: SubjectTestStatus;
  exit: SubjectTestStatus;
};

export type MalakaMaterialKind = 'lecture' | 'presentation' | 'video' | 'practical' | 'test';

export type MalakaTopic = TopicResult & {
  topic_code: string;
  title: string;
  type: string;
  is_open: boolean;
  /** Nega yopiq: kirish testi topshirilmagan yoki o'qituvchi material joylamagan. */
  locked_reason: 'entry' | 'empty' | null;
  has: Partial<Record<MalakaMaterialKind, boolean>>;
  viewed: Record<string, boolean>;
};

export type MalakaMaterial = {
  id: number;
  kind: MalakaMaterialKind;
  title: string;
  language: string;
  file: string;
  file_name: string;
  external_url: string;
  text?: string;
} & Partial<TestView>;

export type MalakaTopicDetail = {
  topic_code: string;
  title: string;
  subject_name: string;
  materials: MalakaMaterial[];
  viewed: Record<string, boolean>;
  result: TopicResult;
};

export type SubjectTestDetail = TestView & {
  code: SubjectTestCode;
  title: string;
  subject_name: string;
};

export type AttemptResult = TestView & { score: number; total: number; percent: number };

export async function fetchMalakaSubjects(): Promise<MalakaSubject[]> {
  const rows = await call<MalakaSubject[]>('/online/student/subjects/');
  return rows.filter((r) => r.program === 'malaka');
}

export function fetchMalakaTopics(syllabusId: number): Promise<MalakaTopic[]> {
  const q = new URLSearchParams({ syllabus_id: String(syllabusId), variant_label: '' });
  return call(`/online/student/topics/?${q}`);
}

export function fetchMalakaTopic(syllabusId: number, topicCode: string): Promise<MalakaTopicDetail> {
  const q = new URLSearchParams({
    syllabus_id: String(syllabusId),
    variant_label: '',
    topic_code: topicCode,
  });
  return call(`/online/student/topic/?${q}`);
}

export function fetchSubjectTest(
  syllabusId: number,
  code: SubjectTestCode,
): Promise<SubjectTestDetail> {
  const q = new URLSearchParams({ syllabus_id: String(syllabusId), code });
  return call(`/malaka/student/subject-test/?${q}`);
}

export function submitAttempt(body: {
  syllabus_id: number;
  topic_code: string;
  kind: AttemptKind;
  answers: number[];
}): Promise<AttemptResult> {
  return call('/malaka/student/attempt/', { method: 'POST', body });
}

/* ==================== O'qituvchi ==================== */

export type TopicBrief = { code: string; title: string; type: string };

export function createTopic(syllabusId: number, title: string): Promise<TopicBrief> {
  return call('/malaka/teacher/topics/', {
    method: 'POST',
    body: { syllabus_id: syllabusId, title },
  });
}

export function renameTopic(syllabusId: number, code: string, title: string): Promise<TopicBrief> {
  return call(`/malaka/teacher/topics/${encodeURIComponent(code)}/`, {
    method: 'PATCH',
    body: { syllabus_id: syllabusId, title },
  });
}

export function deleteTopic(syllabusId: number, code: string): Promise<void> {
  return call(`/malaka/teacher/topics/${encodeURIComponent(code)}/?syllabus_id=${syllabusId}`, {
    method: 'DELETE',
  });
}

export function moveTopic(
  syllabusId: number,
  code: string,
  direction: 'up' | 'down',
): Promise<TopicBrief[]> {
  return call(`/malaka/teacher/topics/${encodeURIComponent(code)}/move/`, {
    method: 'POST',
    body: { syllabus_id: syllabusId, direction },
  });
}

export type ImportedQuestion = {
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  /** `ai` — faylda to'g'ri javob ko'rsatilmagan, AI o'zi tanlagan. */
  answer_source?: 'document' | 'ai';
};

export type ImportResult = {
  questions: ImportedQuestion[];
  ai_decided: number;
  truncated: boolean;
  chunks: number;
  failed_chunks: number;
  source: string;
  chars: number;
};

/** Fayl yoki matndan savollarni ajratadi — saqlamaydi, ko'rib chiqish uchun qaytaradi. */
export async function importTest(
  syllabusId: number,
  input: { file?: File; text?: string },
): Promise<ImportResult> {
  const form = new FormData();
  form.append('syllabus_id', String(syllabusId));
  if (input.file) form.append('file', input.file);
  if (input.text) form.append('text', input.text);

  const res = await fetch(`${apiBaseUrl()}/v1/malaka/teacher/test-import/`, {
    method: 'POST',
    headers: authHeader(),
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = '';
    try {
      detail = (JSON.parse(text) as { detail?: string }).detail || '';
    } catch {
      /* JSON emas — masalan nginx sahifasi */
    }
    throw new Error(
      detail || `Server javob bermadi (${res.status}). Birozdan keyin qayta urinib ko‘ring.`,
    );
  }
  return JSON.parse(text) as ImportResult;
}

export type ProgressTopic = TopicResult & {
  topic_code: string;
  topic_title: string;
  viewed: Record<string, boolean>;
};

export type ProgressStudent = {
  student_id: string;
  student_name: string;
  group_name: string;
  entry: AttemptSummary;
  exit: AttemptSummary;
  topics: ProgressTopic[];
  graded_count: number;
  average_grade: number | null;
  /** Oxirgi faollik; `null` — portalga hali kirmagan. */
  last_seen: string | null;
};

export type ProgressReport = {
  subject_name: string;
  topic_count: number;
  has_entry: boolean;
  entry_published: boolean;
  has_exit: boolean;
  exit_published: boolean;
  groups: Array<{ id: number; name: string; count: number }>;
  students: ProgressStudent[];
};

export function fetchMalakaProgress(syllabusId: number, groupId?: number): Promise<ProgressReport> {
  const q = new URLSearchParams({ syllabus_id: String(syllabusId) });
  if (groupId) q.set('group_id', String(groupId));
  return call(`/malaka/teacher/progress/?${q}`);
}
