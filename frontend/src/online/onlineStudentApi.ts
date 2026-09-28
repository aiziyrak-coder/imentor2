/** Online portal — talaba API mijozi. */

import { httpJson } from '../api/httpClient';
import { authHeader } from './onlineAuth';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

function call<T>(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  return httpJson<T>(`${apiBaseUrl()}/v1/online${path}`, {
    method: init?.method || 'GET',
    body: init?.body as never,
    headers: authHeader(),
  });
}

export type StudentSubject = {
  syllabus_id: number;
  subject_name: string;
  department_name: string;
  variant_label: string;
  topic_count: number;
  open_count: number;
  done_count: number;
  /** Test ham, masala ham topshirilgan mavzular soni. */
  graded_count: number;
  /** Shu mavzular bo'yicha o'rtacha baho (100 ballik). */
  average_grade: number | null;
};

/**
 * Mavzu bahosi: test va vaziyatli masalaning o'rtachasi, 100 ballik.
 * `grade` faqat IKKALASI topshirilgach to'ladi.
 */
export type TopicGrade = {
  test_percent: number | null;
  case_percent: number | null;
  grade: number | null;
  test_done: boolean;
  case_done: boolean;
};

export type StudentTopic = {
  topic_code: string;
  title: string;
  type: string;
  is_open: boolean;
  opened_at: string | null;
  has: Record<string, boolean>;
  test_score: number | null;
  test_total: number | null;
  test_submitted_at: string | null;
} & TopicGrade;

export type StudentMaterial = {
  /** Video va tarqatma bir mavzuda bir nechta bo'ladi — `kind` yagona kalit emas. */
  id: number;
  kind: 'lecture' | 'presentation' | 'video' | 'handout' | 'case' | 'test';
  title: string;
  language: string;
  file: string;
  file_name: string;
  external_url: string;
  text?: string;
  /** `correct_index` va `explanation` FAQAT test topshirilgandan keyin keladi. */
  questions?: Array<{
    question: string;
    options: string[];
    correct_index?: number;
    explanation?: string;
  }>;
  /** Talabaning o'z javoblari — tahlil uchun, topshirgandan keyin. */
  my_answers?: number[];

  /* --- Vaziyatli masala --- */
  /** Javob yuborilganmi. Yuborilmaguncha `solution` va `review` kelmaydi. */
  submitted?: boolean;
  /** O'qituvchining etalon yechimi — FAQAT javob yuborilgandan keyin. */
  solution?: string;
  /** Talabaning o'z javobi. */
  my_answer?: string;
  review?: CaseReview;
};

export type CaseReview = {
  verdict: 'correct' | 'partial' | 'incorrect';
  score: number;
  feedback: string;
  strengths: string[];
  missed: string[];
  ideal: string;
};

export type StudentTopicDetail = {
  topic_code: string;
  title: string;
  subject_name: string;
  opened_at: string | null;
  materials: StudentMaterial[];
  test_submitted: boolean;
  test_score: number | null;
  test_total: number | null;
  /** Qaysi materialni allaqachon ochgani: lecture / presentation / video / handout. */
  viewed: Record<string, boolean>;
  grade: TopicGrade;
};

export type LiveLesson = {
  id: number;
  room_name: string;
  subject_name: string;
  topic_code: string;
  topic_title: string;
  started_at: string;
} | null;

export function fetchSubjects(): Promise<StudentSubject[]> {
  return call('/student/subjects/');
}

export function fetchTopics(syllabusId: number, variantLabel: string): Promise<StudentTopic[]> {
  const q = new URLSearchParams({
    syllabus_id: String(syllabusId),
    variant_label: variantLabel,
  });
  return call(`/student/topics/?${q}`);
}

export function fetchTopicDetail(
  syllabusId: number,
  variantLabel: string,
  topicCode: string,
): Promise<StudentTopicDetail> {
  const q = new URLSearchParams({
    syllabus_id: String(syllabusId),
    variant_label: variantLabel,
    topic_code: topicCode,
  });
  return call(`/student/topic/?${q}`);
}

export function markViewed(
  syllabusId: number,
  variantLabel: string,
  topicCode: string,
  kind: 'lecture' | 'presentation' | 'video' | 'handout',
): Promise<unknown> {
  return call('/student/view/', {
    method: 'POST',
    body: {
      syllabus_id: syllabusId,
      variant_label: variantLabel,
      topic_code: topicCode,
      kind,
    },
  });
}

export function submitTest(
  syllabusId: number,
  variantLabel: string,
  topicCode: string,
  answers: number[],
): Promise<{ score: number; total: number; submitted_at: string }> {
  return call('/student/test/', {
    method: 'POST',
    body: {
      syllabus_id: syllabusId,
      variant_label: variantLabel,
      topic_code: topicCode,
      answers,
    },
  });
}

export function fetchLiveLesson(): Promise<LiveLesson> {
  return call('/student/live-lesson/');
}

export type MyAttendance = {
  lesson_id: number;
  subject_name: string;
  topic_code: string;
  topic_title: string;
  started_at: string;
  ended_at: string | null;
  was_present: boolean;
  minutes: number;
};

export function fetchMyAttendance(): Promise<MyAttendance[]> {
  return call('/student/attendance/');
}

/** Vaziyatli masalaga javob yuboradi; AI tahlili shu yerda qaytadi. */
export function submitCase(
  syllabusId: number,
  variantLabel: string,
  topicCode: string,
  answer: string,
): Promise<{ submitted_at: string; review: CaseReview; solution: string }> {
  return call('/student/case/', {
    method: 'POST',
    body: {
      syllabus_id: syllabusId,
      variant_label: variantLabel,
      topic_code: topicCode,
      answer,
    },
  });
}
