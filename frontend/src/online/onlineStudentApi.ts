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
  variant_label: string;
  topic_count: number;
  open_count: number;
  done_count: number;
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
};

export type StudentMaterial = {
  kind: 'lecture' | 'presentation' | 'video' | 'handout' | 'case' | 'test';
  title: string;
  language: string;
  file: string;
  file_name: string;
  external_url: string;
  text?: string;
  questions?: Array<{ question: string; options: string[] }>;
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
