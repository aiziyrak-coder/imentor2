/** Online portal — o'qituvchi API mijozi. */

import { httpJson } from '../api/httpClient';
import { authHeader } from './onlineAuth';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

function call<T>(path: string, init?: { method?: Method; body?: unknown }): Promise<T> {
  return httpJson<T>(`${apiBaseUrl()}/v1/online${path}`, {
    method: init?.method || 'GET',
    body: init?.body as never,
    headers: authHeader(),
  });
}

export const MATERIAL_KINDS = [
  'lecture',
  'presentation',
  'video',
  'handout',
  'case',
  'test',
] as const;

export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const KIND_LABEL: Record<MaterialKind, string> = {
  lecture: "Ma'ruza matni",
  presentation: 'Taqdimot',
  video: 'Video dars',
  handout: 'Tarqatma material',
  case: 'Vaziyatli masala',
  test: '10 ta test',
};

export type TeacherCourse = {
  syllabus_id: number;
  subject_name: string;
  /** RAG uchun: server shu kod orqali fanning kafedrasini topadi. */
  subject_code: string;
  department_name: string;
  variant_label: string;
  topic_count: number;
  instruction_language: string;
};

export type TeacherMe = {
  is_online_teacher: boolean;
  full_name?: string;
  courses: TeacherCourse[];
};

export type TeacherTopic = {
  code: string;
  title: string;
  type: string;
  has: Record<MaterialKind, boolean>;
  ready: number;
};

export type Material = {
  id: number;
  syllabus_id: number;
  variant_label: string;
  topic_code: string;
  kind: MaterialKind;
  title: string;
  language: string;
  payload: Record<string, unknown>;
  file: string;
  file_name: string;
  file_size: number;
  external_url: string;
  author_name: string;
  created_at: string;
  updated_at: string;
};

export function fetchTeacherMe(): Promise<TeacherMe> {
  return call('/teacher/me/');
}

export function fetchTeacherTopics(
  syllabusId: number,
  variantLabel: string,
): Promise<TeacherTopic[]> {
  const q = new URLSearchParams({
    syllabus_id: String(syllabusId),
    variant_label: variantLabel,
  });
  return call(`/teacher/topics/?${q}`);
}

export function fetchMaterials(
  syllabusId: number,
  variantLabel: string,
  topicCode: string,
): Promise<Material[]> {
  const q = new URLSearchParams({
    syllabus_id: String(syllabusId),
    variant_label: variantLabel,
    topic_code: topicCode,
  });
  return call(`/teacher/materials/?${q}`);
}

export function saveMaterial(body: {
  syllabus_id: number;
  variant_label: string;
  topic_code: string;
  kind: MaterialKind;
  title?: string;
  language?: string;
  payload?: Record<string, unknown>;
  external_url?: string;
}): Promise<Material> {
  return call('/teacher/materials/', { method: 'POST', body });
}

export function deleteMaterial(id: number): Promise<void> {
  return call(`/teacher/materials/${id}/`, { method: 'DELETE' });
}

/** Fayl yuklash — `multipart/form-data`, shuning uchun `fetch` to'g'ridan-to'g'ri. */
export async function uploadMaterial(
  file: File,
  meta: {
    syllabus_id: number;
    variant_label: string;
    topic_code: string;
    kind: 'handout' | 'presentation';
    title?: string;
    language?: string;
  },
): Promise<Material> {
  const form = new FormData();
  form.append('file', file);
  form.append('syllabus_id', String(meta.syllabus_id));
  form.append('variant_label', meta.variant_label);
  form.append('topic_code', meta.topic_code);
  form.append('kind', meta.kind);
  form.append('title', meta.title || '');
  form.append('language', meta.language || 'uz');

  const res = await fetch(`${apiBaseUrl()}/v1/online/teacher/materials/upload/`, {
    method: 'POST',
    headers: authHeader(),
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      detail = (JSON.parse(text) as { detail?: string }).detail || text;
    } catch {
      /* matn shaklida qoldiramiz */
    }
    throw new Error(detail || `Yuklash xatosi (${res.status})`);
  }
  return JSON.parse(text) as Material;
}
